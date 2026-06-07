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
  if (day === 0)              return 1;
  if (day === 1 || day === 2) return 3;
  if (day >= 3 && day <= 5)  return 6;
  return 1;
}

function arrayAvg(arr) {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

// Son component performans loglarından dinamik ağırlık hesaplar.
// Rastgele baseline 0.5 — bir bileşenin ortalaması 0.5'in üstündeyse tahmin gücü var demektir.
function computeDynamicWeights(logs) {
  const DEFAULT = { baseFreq: 0.30, recentFreq: 0.40, dayFreq: 0.20, hitRate: 0.10 };
  const valid = logs.filter(l => l.componentPerformance?.baseFreq != null);
  if (valid.length < 5) return DEFAULT;

  const avgBase   = arrayAvg(valid.map(l => l.componentPerformance.baseFreq.avgPercentile));
  const avgRecent = arrayAvg(valid.map(l => l.componentPerformance.recentFreq.avgPercentile));
  const avgDay    = arrayAvg(valid.map(l => l.componentPerformance.dayFreq.avgPercentile));

  // Rastgele baseline (0.5) üzerindeki fazlalık = gerçek tahmin gücü
  const perfBase   = Math.max(avgBase   - 0.5, 0.001);
  const perfRecent = Math.max(avgRecent - 0.5, 0.001);
  const perfDay    = Math.max(avgDay    - 0.5, 0.001);

  const totalPerf  = perfBase + perfRecent + perfDay;
  const FREQ_TOTAL = 0.90;
  const clamp      = v => Math.max(0.05, Math.min(0.70, v));

  let wBase   = clamp((perfBase   / totalPerf) * FREQ_TOTAL);
  let wRecent = clamp((perfRecent / totalPerf) * FREQ_TOTAL);
  let wDay    = clamp((perfDay    / totalPerf) * FREQ_TOTAL);

  // Clamp sonrası toplamı yeniden normalize et
  const sum = wBase + wRecent + wDay;
  wBase   = (wBase   / sum) * FREQ_TOTAL;
  wRecent = (wRecent / sum) * FREQ_TOTAL;
  wDay    = (wDay    / sum) * FREQ_TOTAL;

  const r3 = v => Math.round(v * 1000) / 1000;
  return { baseFreq: r3(wBase), recentFreq: r3(wRecent), dayFreq: r3(wDay), hitRate: 0.10 };
}

export async function trainFromScratch() {
  const results = await Result.find().sort({ drawId: 1 });
  if (results.length === 0) return;

  const total       = results.length;
  const recentStart = Math.max(0, total - 50);
  const recent      = results.slice(recentStart);

  const existingWeights = await ModelWeights.find({}, 'number predictedCount accumulatedHitScore');
  const hitRateMap = new Map(
    existingWeights.map(w => [w.number, {
      predictedCount:      w.predictedCount      || 0,
      accumulatedHitScore: w.accumulatedHitScore  || 0,
    }])
  );

  // 6 ana sayı + joker (aynı havuzdan çekildiği için) frekans hesabına dahil
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

  // Son AnalysisLog'dan dinamik ağırlıkları oku
  const latestLog = await AnalysisLog.findOne(
    { dynamicWeights: { $exists: true } }, 'dynamicWeights'
  ).sort({ runAt: -1 });
  const W = latestLog?.dynamicWeights || { baseFreq: 0.30, recentFreq: 0.40, dayFreq: 0.20, hitRate: 0.10 };

  const targetDay    = String(getNextDrawDay());
  const recentWindow = Math.min(50, total);
  const MAX_SCORE    = 9.5;

  const bulkOps = [];
  for (const [number, totalApps] of totalFreq) {
    const recentApps = recentFreq.get(number) || 0;
    const dayWeights = dayFreqByNum.get(number) || {};

    const baseFreq   = totalApps / total;
    const recentRate = recentApps / recentWindow;
    const dayRate    = dayDrawCount[targetDay] > 0
      ? (dayWeights[targetDay] || 0) / dayDrawCount[targetDay]
      : 0;

    const existing = hitRateMap.get(number) || { predictedCount: 0, accumulatedHitScore: 0 };
    const hitRate  = existing.predictedCount > 0
      ? Math.min(existing.accumulatedHitScore / (existing.predictedCount * MAX_SCORE), 1)
      : 0;

    const score = (baseFreq * W.baseFreq) + (recentRate * W.recentFreq) + (dayRate * W.dayFreq) + (hitRate * W.hitRate);

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

  if (bulkOps.length > 0) await ModelWeights.bulkWrite(bulkOps);

  console.log(`Model eğitildi: ${bulkOps.length} sayı, ${total} çekiliş | Ağırlıklar: base=${W.baseFreq} recent=${W.recentFreq} day=${W.dayFreq} hit=${W.hitRate}`);
}

async function evaluatePrediction(prediction, actualDraw) {
  // Sadece ilk 6 ana sayı — eski verilerde joker/süperstar numbers[]'e karışmış olabilir
  const mainNumbers = (actualDraw.numbers || []).slice(0, 6);
  const actualSet   = new Set(mainNumbers);
  const prizeMap    = new Map((actualDraw.prizeTable || []).map(p => [p.category, p.prizeAmount]));

  // Joker, süperstar ile aynıysa geçersiz say (scraper parse hatası koruması)
  const drawnJoker = (actualDraw.joker != null && actualDraw.joker !== actualDraw.superstar)
    ? actualDraw.joker
    : null;

  const evaluationResults = prediction.predictions.map((pred, idx) => {
    const numbersHit = pred.numbers.filter(n => actualSet.has(n)).length;

    const jokerHit = pred.joker != null
      ? pred.joker === drawnJoker
      : (drawnJoker != null && pred.numbers.includes(drawnJoker));

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

  const hitTracker = new Map();
  for (let i = 0; i < prediction.predictions.length; i++) {
    const pred  = prediction.predictions[i];
    const score = evaluationResults[i].totalHitScore;
    for (const n of pred.numbers) {
      const cur = hitTracker.get(n) || { predicted: 0, accumulatedScore: 0 };
      cur.predicted        += 1;
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

// latestResult: çekiliş sonucu — component analizi için hangi sayıların çıktığını bilmek gerekiyor
async function createAnalysisLog(latestResult) {
  const drawCount = await Result.countDocuments();
  const evaluated = await Prediction.find({ status: 'evaluated' }, 'evaluationResults bestHitScore');

  const allHitScores  = evaluated.flatMap(p => (p.evaluationResults || []).map(e => e.totalHitScore));
  const allNumHits    = evaluated.flatMap(p => (p.evaluationResults || []).map(e => e.numbersHit));
  const avgHitScore   = allHitScores.length > 0 ? arrayAvg(allHitScores) : 0;
  const avgNumbersHit = allNumHits.length   > 0 ? arrayAvg(allNumHits)   : 0;
  const bestEver      = evaluated.length    > 0 ? Math.max(...evaluated.map(p => p.bestHitScore || 0)) : 0;

  const topWeights = await ModelWeights.find().sort({ score: -1 }).limit(10);
  const topNumbers = topWeights.map(w => w.number);

  const jokerFreq = new Map();
  const superFreq = new Map();
  const results   = await Result.find({}, 'joker superstar');
  for (const r of results) {
    if (r.joker     != null) jokerFreq.set(r.joker,     (jokerFreq.get(r.joker)     || 0) + 1);
    if (r.superstar != null) superFreq.set(r.superstar, (superFreq.get(r.superstar) || 0) + 1);
  }
  const topJokers = [...jokerFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  const topSupers = [...superFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);

  // ── Component performans analizi ──────────────────────────────────────────
  // Her bileşen için: çıkan sayılar o bileşenin sıralamasında ortalama kaçıncı yüzdelikte?
  // 1.0 = hepsi en üstte, 0.5 = rastgele beklenti, 0.0 = hepsi en altta
  let componentPerformance = null;
  let dynamicWeights       = { baseFreq: 0.30, recentFreq: 0.40, dayFreq: 0.20, hitRate: 0.10 };

  if (latestResult) {
    const allWeights = await ModelWeights.find(
      {}, 'number totalAppearances totalDraws recentAppearances dayWeights dayDrawCounts'
    );

    if (allWeights.length > 0) {
      const dayOfDraw = String(getDayOfWeek(latestResult.drawDate));
      const numCount  = allWeights.length;

      const compVals = allWeights.map(w => {
        const n         = w.totalDraws || 1;
        const rw        = Math.min(50, n);
        const dayCount  = (w.dayDrawCounts || {})[dayOfDraw] || 0;
        return {
          number:     w.number,
          baseFreq:   w.totalAppearances / n,
          recentFreq: rw > 0 ? w.recentAppearances / rw : 0,
          dayFreq:    dayCount > 0 ? ((w.dayWeights || {})[dayOfDraw] || 0) / dayCount : 0,
        };
      });

      // Her bileşen için büyükten küçüğe sırala → rank 0 en yüksek değer
      const byBase   = [...compVals].sort((a, b) => b.baseFreq   - a.baseFreq);
      const byRecent = [...compVals].sort((a, b) => b.recentFreq - a.recentFreq);
      const byDay    = [...compVals].sort((a, b) => b.dayFreq    - a.dayFreq);

      const rankBase   = new Map(byBase.map((v, i)   => [v.number, i]));
      const rankRecent = new Map(byRecent.map((v, i) => [v.number, i]));
      const rankDay    = new Map(byDay.map((v, i)    => [v.number, i]));

      // Percentile: rank 0 → 1.0 (en iyi), rank (n-1) → ~0.0
      const pct = (rankMap, num) => {
        const r = rankMap.get(num);
        return r != null ? 1 - r / numCount : 0.5;
      };

      // Çekiliş sonucu: 6 ana sayı + joker (aynı havuzdan)
      const drawnNums = latestResult.joker != null
        ? [...latestResult.numbers, latestResult.joker]
        : [...latestResult.numbers];

      componentPerformance = {
        baseFreq:   { avgPercentile: arrayAvg(drawnNums.map(n => pct(rankBase,   n))) },
        recentFreq: { avgPercentile: arrayAvg(drawnNums.map(n => pct(rankRecent, n))) },
        dayFreq:    { avgPercentile: arrayAvg(drawnNums.map(n => pct(rankDay,    n))) },
      };

      // Son 29 log + mevcut analiz = max 30 örnek üzerinden dinamik ağırlık hesapla
      const recentLogs = await AnalysisLog.find(
        { 'componentPerformance.baseFreq': { $exists: true } },
        'componentPerformance'
      ).sort({ runAt: -1 }).limit(29);

      dynamicWeights = computeDynamicWeights([...recentLogs, { componentPerformance }]);

      console.log(
        `Bileşen analizi | base: ${componentPerformance.baseFreq.avgPercentile.toFixed(3)} ` +
        `recent: ${componentPerformance.recentFreq.avgPercentile.toFixed(3)} ` +
        `day: ${componentPerformance.dayFreq.avgPercentile.toFixed(3)} ` +
        `→ Yeni ağırlıklar: ${JSON.stringify(dynamicWeights)}`
      );
    }
  }

  await AnalysisLog.create({
    totalDrawsInDB:        drawCount,
    avgHitScore,
    avgNumbersHit,
    bestEverHitScore:      bestEver,
    topNumbersSnapshot:    topNumbers,
    topJokersSnapshot:     topJokers,
    topSuperstarsSnapshot: topSupers,
    componentPerformance,
    dynamicWeights,
  });
}

// Geçmiş çekilişler için tek seferlik bileşen analizi.
// Zaten log varsa es geçer (idempotent).
export async function backfillAnalysisLogs() {
  const existingCount = await AnalysisLog.countDocuments({ 'componentPerformance.baseFreq': { $exists: true } });
  if (existingCount > 0) {
    return { skipped: true, reason: `${existingCount} bileşen logu zaten mevcut.` };
  }

  const draws = await Result.find({}, 'drawId drawDate numbers joker')
    .sort({ drawId: -1 })
    .limit(30);

  if (draws.length === 0) return { created: 0 };

  const allWeights = await ModelWeights.find(
    {}, 'number totalAppearances totalDraws recentAppearances dayWeights dayDrawCounts'
  );
  if (allWeights.length === 0) return { created: 0 };

  const numCount    = allWeights.length;
  const orderedDraws = [...draws].reverse(); // eskiden yeniye
  const batchLogs   = [];
  let created       = 0;

  for (const draw of orderedDraws) {
    const dayOfDraw = String(getDayOfWeek(draw.drawDate));

    const compVals = allWeights.map(w => {
      const n        = w.totalDraws || 1;
      const rw       = Math.min(50, n);
      const dayCount = (w.dayDrawCounts || {})[dayOfDraw] || 0;
      return {
        number:     w.number,
        baseFreq:   w.totalAppearances / n,
        recentFreq: rw > 0 ? w.recentAppearances / rw : 0,
        dayFreq:    dayCount > 0 ? ((w.dayWeights || {})[dayOfDraw] || 0) / dayCount : 0,
      };
    });

    const byBase   = [...compVals].sort((a, b) => b.baseFreq   - a.baseFreq);
    const byRecent = [...compVals].sort((a, b) => b.recentFreq - a.recentFreq);
    const byDay    = [...compVals].sort((a, b) => b.dayFreq    - a.dayFreq);

    const rankBase   = new Map(byBase.map((v, i)   => [v.number, i]));
    const rankRecent = new Map(byRecent.map((v, i) => [v.number, i]));
    const rankDay    = new Map(byDay.map((v, i)    => [v.number, i]));

    const pct = (rankMap, num) => {
      const r = rankMap.get(num);
      return r != null ? 1 - r / numCount : 0.5;
    };

    const drawnNums = draw.joker != null
      ? [...draw.numbers, draw.joker]
      : [...draw.numbers];

    const componentPerformance = {
      baseFreq:   { avgPercentile: arrayAvg(drawnNums.map(n => pct(rankBase,   n))) },
      recentFreq: { avgPercentile: arrayAvg(drawnNums.map(n => pct(rankRecent, n))) },
      dayFreq:    { avgPercentile: arrayAvg(drawnNums.map(n => pct(rankDay,    n))) },
    };

    const dynamicWeights = computeDynamicWeights([...batchLogs, { componentPerformance }]);

    await AnalysisLog.create({ componentPerformance, dynamicWeights });
    batchLogs.push({ componentPerformance });
    created++;
  }

  console.log(`Backfill tamamlandı: ${created} analiz logu oluşturuldu.`);
  return { created };
}

export async function learnFromNewDraw(newResult) {
  try {
    // 1. Bekleyen tahmini değerlendir
    const pending = await Prediction.findOne({ status: 'pending' }).sort({ createdAt: -1 });
    if (pending) await evaluatePrediction(pending, newResult);

    // 2. Bileşen analizi yap ve dinamik ağırlıkları kaydet (eğitim ÖNCE yapılmalı ki yeni ağırlıklar kullanılsın)
    await createAnalysisLog(newResult);

    // 3. Modeli yeniden eğit (yeni dinamik ağırlıklarla)
    await trainFromScratch();

    // 4. Yeni tahmin üret
    await generateAndSavePrediction();
  } catch (err) {
    console.error('learnFromNewDraw hatası:', err.message);
  }
}
