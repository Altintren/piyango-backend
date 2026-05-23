import Result from '../models/Result.js';
import Prediction from '../models/Prediction.js';
import ModelWeights from '../models/ModelWeights.js';
import AnalysisLog from '../models/AnalysisLog.js';
import { generateAndSavePrediction } from './predictor.js';

// "GG.AA.YYYY" → haftanın günü (0=Pazar, 6=Cumartesi)
function getDayOfWeek(dateStr) {
  const [day, month, year] = dateStr.split('.').map(Number);
  return new Date(year, month - 1, day).getDay();
}

function determinePrizeCategory(numbersHit, jokerHit, superstarHit) {
  if (numbersHit === 6 && superstarHit)            return '6+SüperStar bilen kişi sayısı';
  if (numbersHit === 6)                             return '6 bilen kişi sayısı';
  if (numbersHit === 5 && jokerHit && superstarHit) return '5+1+SüperStar bilen kişi sayısı';
  if (numbersHit === 5 && jokerHit)                 return '5+1 bilen kişi sayısı';
  if (numbersHit === 5 && superstarHit)             return '5+SüperStar bilen kişi sayısı';
  if (numbersHit === 5)                             return '5 bilen kişi sayısı';
  if (numbersHit === 4 && superstarHit)             return '4+SüperStar bilen kişi sayısı';
  if (numbersHit === 4)                             return '4 bilen kişi sayısı';
  if (numbersHit === 3 && superstarHit)             return '3+SüperStar bilen kişi sayısı';
  if (numbersHit === 3)                             return '3 bilen kişi sayısı';
  if (numbersHit === 2 && superstarHit)             return '2+SüperStar bilen kişi sayısı';
  if (numbersHit === 2)                             return '2 bilen kişi sayısı';
  if (numbersHit === 1 && superstarHit)             return '1+SüperStar bilen kişi sayısı';
  if (superstarHit)                                 return '0+SüperStar bilen kişi sayısı';
  return null;
}

// Bir sonraki çekiliş günü (Pazartesi=1, Çarşamba=3, Cumartesi=6)
function getNextDrawDay() {
  const day = new Date().getDay();
  if (day === 0)              return 1; // Pazar     → Pazartesi
  if (day === 1 || day === 2) return 3; // Pzt/Sal   → Çarşamba
  if (day >= 3 && day <= 5)  return 6; // Çar/Per/Cum → Cumartesi
  return 1;                             // Cumartesi → Pazartesi
}

export async function trainFromScratch() {
  const results = await Result.find().sort({ drawId: 1 });
  if (results.length === 0) return;

  const total       = results.length;
  const recentStart = Math.max(0, total - 50);
  const recent      = results.slice(recentStart);

  // Mevcut ağırlıklı isabet skorlarını koru
  const existingWeights = await ModelWeights.find({}, 'number predictedCount accumulatedHitScore');
  const hitRateMap = new Map(
    existingWeights.map(w => [w.number, {
      predictedCount:      w.predictedCount      || 0,
      accumulatedHitScore: w.accumulatedHitScore  || 0,
    }])
  );

  // Tek geçişte frekans hesapla — 6 ana sayı + joker (aynı havuzdan çekildiği için)
  const totalFreq    = new Map();
  const recentFreq   = new Map();
  const dayFreqByNum = new Map();
  const dayDrawCount = {};

  for (const r of results) {
    const day = String(getDayOfWeek(r.drawDate));
    dayDrawCount[day] = (dayDrawCount[day] || 0) + 1;
    const drawNums = r.joker != null ? [...r.numbers, r.joker] : [...r.numbers];
    for (const n of drawNums) {
      totalFreq.set(n, (totalFreq.get(n) || 0) + 1);
      if (!dayFreqByNum.has(n)) dayFreqByNum.set(n, {});
      const dm = dayFreqByNum.get(n);
      dm[day] = (dm[day] || 0) + 1;
    }
  }

  for (const r of recent) {
    const drawNums = r.joker != null ? [...r.numbers, r.joker] : [...r.numbers];
    for (const n of drawNums) {
      recentFreq.set(n, (recentFreq.get(n) || 0) + 1);
    }
  }

  const targetDay    = String(getNextDrawDay());
  const recentWindow = Math.min(50, total);
  // Maksimum totalHitScore: 6 ana + 1.5 joker + 2.0 süperstar = 9.5
  const MAX_SCORE    = 9.5;

  const bulkOps = [];
  for (const [number, totalApps] of totalFreq) {
    const recentApps  = recentFreq.get(number) || 0;
    const dayWeights  = dayFreqByNum.get(number) || {};

    const baseFreq    = totalApps / total;
    const recentRate  = recentApps / recentWindow;
    const dayRate     = dayDrawCount[targetDay] > 0
      ? (dayWeights[targetDay] || 0) / dayDrawCount[targetDay]
      : 0;

    const existing = hitRateMap.get(number) || { predictedCount: 0, accumulatedHitScore: 0 };
    const hitRate  = existing.predictedCount > 0
      ? Math.min(existing.accumulatedHitScore / (existing.predictedCount * MAX_SCORE), 1)
      : 0;

    // score = baseFreq×0.30 + recentFreq×0.40 + dayFreq×0.20 + hitRate×0.10
    const score = (baseFreq * 0.30) + (recentRate * 0.40) + (dayRate * 0.20) + (hitRate * 0.10);

    bulkOps.push({
      updateOne: {
        filter: { number },
        update: {
          $set: {
            number,
            score,
            totalAppearances:  totalApps,
            totalDraws:        total,
            recentAppearances: recentApps,
            dayWeights,
            dayDrawCounts:     dayDrawCount,
          },
        },
        upsert: true,
      },
    });
  }

  if (bulkOps.length > 0) {
    await ModelWeights.bulkWrite(bulkOps);
  }

  console.log(`Model eğitildi: ${bulkOps.length} sayı, ${total} çekiliş üzerinden.`);
}

async function evaluatePrediction(prediction, actualDraw) {
  const actualSet = new Set(actualDraw.numbers);
  const prizeMap  = new Map((actualDraw.prizeTable || []).map(p => [p.category, p.prizeAmount]));

  const evaluationResults = prediction.predictions.map((pred, idx) => {
    const numbersHit = pred.numbers.filter(n => actualSet.has(n)).length;

    // Geri uyumluluk: eski tahminlerde pred.joker açık olarak saklıydı.
    // Yeni tahminlerde joker yok — draw.joker'ın 6 tahmin sayısı içinde olup olmadığına bakılır.
    const jokerHit = pred.joker != null
      ? pred.joker === actualDraw.joker
      : (actualDraw.joker != null && pred.numbers.includes(actualDraw.joker));

    const superstarHit  = actualDraw.superstar != null && pred.superstar === actualDraw.superstar;
    const totalHitScore = numbersHit + (jokerHit ? 1.5 : 0) + (superstarHit ? 2.0 : 0);
    const prizeCategory = determinePrizeCategory(numbersHit, jokerHit, superstarHit);
    const prizeAmount   = prizeCategory ? (prizeMap.get(prizeCategory) ?? null) : null;
    return { predictionIndex: idx, numbersHit, jokerHit, superstarHit, totalHitScore, prizeCategory, prizeAmount };
  });

  const scores = evaluationResults.map(e => e.totalHitScore);

  await Prediction.findByIdAndUpdate(prediction._id, {
    status:                  'evaluated',
    evaluatedAgainstDrawId:  actualDraw.drawId,
    evaluatedAt:             new Date(),
    evaluationResults,
    bestHitScore:            Math.max(...scores),
    averageHitScore:         scores.reduce((a, b) => a + b, 0) / scores.length,
  });

  // Her tahmin edilen sayı için ağırlıklı isabet skoru biriktir
  const hitTracker = new Map();
  for (let i = 0; i < prediction.predictions.length; i++) {
    const pred  = prediction.predictions[i];
    const score = evaluationResults[i].totalHitScore;
    for (const n of pred.numbers) {
      const cur = hitTracker.get(n) || { predicted: 0, accumulatedScore: 0 };
      cur.predicted       += 1;
      cur.accumulatedScore += score;
      hitTracker.set(n, cur);
    }
  }

  const hitOps = [];
  for (const [number, { predicted, accumulatedScore }] of hitTracker) {
    hitOps.push({
      updateOne: {
        filter: { number },
        update: { $inc: { predictedCount: predicted, accumulatedHitScore: accumulatedScore } },
        upsert: true,
      },
    });
  }
  if (hitOps.length > 0) await ModelWeights.bulkWrite(hitOps);

  console.log(`Tahmin değerlendirildi. En iyi skor: ${Math.max(...scores)}`);
}

async function createAnalysisLog() {
  const total     = await Result.countDocuments();
  const evaluated = await Prediction.find({ status: 'evaluated' }, 'evaluationResults bestHitScore');

  const allHitScores  = evaluated.flatMap(p => (p.evaluationResults || []).map(e => e.totalHitScore));
  const allNumHits    = evaluated.flatMap(p => (p.evaluationResults || []).map(e => e.numbersHit));
  const avgHitScore   = allHitScores.length  > 0 ? allHitScores.reduce((a, b) => a + b, 0)  / allHitScores.length  : 0;
  const avgNumbersHit = allNumHits.length    > 0 ? allNumHits.reduce((a, b) => a + b, 0)    / allNumHits.length    : 0;
  const bestEver      = evaluated.length     > 0 ? Math.max(...evaluated.map(p => p.bestHitScore || 0)) : 0;

  const topWeights    = await ModelWeights.find().sort({ score: -1 }).limit(10);
  const topNumbers    = topWeights.map(w => w.number);

  // Joker ve süperstar frekansları
  const jokerFreq = new Map();
  const superFreq = new Map();
  const results   = await Result.find({}, 'joker superstar');
  for (const r of results) {
    if (r.joker     != null) jokerFreq.set(r.joker,     (jokerFreq.get(r.joker)     || 0) + 1);
    if (r.superstar != null) superFreq.set(r.superstar, (superFreq.get(r.superstar) || 0) + 1);
  }
  const topJokers = [...jokerFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  const topSupers = [...superFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);

  await AnalysisLog.create({
    totalDrawsInDB:        total,
    avgHitScore,
    avgNumbersHit,
    bestEverHitScore:      bestEver,
    topNumbersSnapshot:    topNumbers,
    topJokersSnapshot:     topJokers,
    topSuperstarsSnapshot: topSupers,
  });
}

export async function learnFromNewDraw(newResult) {
  try {
    // 1. Bekleyen tahmini değerlendir
    const pending = await Prediction.findOne({ status: 'pending' }).sort({ createdAt: -1 });
    if (pending) {
      await evaluatePrediction(pending, newResult);
    }

    // 2. Modeli yeniden eğit
    await trainFromScratch();

    // 3. Analiz logu yaz
    await createAnalysisLog();

    // 4. Yeni tahmin üret
    await generateAndSavePrediction();
  } catch (err) {
    console.error('learnFromNewDraw hatası:', err.message);
  }
}
