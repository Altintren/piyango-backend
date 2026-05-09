import Result from '../models/Result.js';
import Prediction from '../models/Prediction.js';
import ModelWeights from '../models/ModelWeights.js';
import { fetchDrawList, fetchDrawDetails } from '../services/scraper.js';
import { trainFromScratch, learnFromNewDraw } from '../services/learner.js';
import { generateAndSavePrediction } from '../services/predictor.js';

let isUpdating = false;

export async function updateResults() {
  if (isUpdating) throw new Error('Güncelleme zaten devam ediyor.');
  isUpdating = true;

  try {
    const allDraws    = await fetchDrawList();
    const existingIds = new Set(await Result.distinct('drawId'));
    const newDraws    = allDraws
      .filter(d => !existingIds.has(d.id))
      .sort((a, b) => a.id - b.id); // kronolojik sıra (eskiden yeniye)

    console.log(`Toplam: ${allDraws.length} | Yeni: ${newDraws.length}`);

    let added   = 0;
    let skipped = 0;
    const savedResults = [];

    for (const draw of newDraws) {
      try {
        const details = await fetchDrawDetails(draw.id);
        const result  = await Result.create({
          drawId:   draw.id,
          drawDate: draw.date,
          numbers:  details.numbers,
          joker:    details.joker,
          superstar:details.superstar,
        });
        savedResults.push(result);
        added++;
        console.log(`Kaydedildi: ${draw.id} (${draw.date})`);
      } catch (err) {
        if (err.code === 11000) {
          skipped++;
        } else {
          console.error(`Hata [${draw.id}]: ${err.message}`);
          skipped++;
        }
      }
    }

    // Yeni çekiliş varsa öğren — sadece en son çekiliş üzerinden
    if (savedResults.length > 0) {
      const latestResult = savedResults[savedResults.length - 1];
      await learnFromNewDraw(latestResult);
    }

    return { added, skipped, total: allDraws.length };
  } finally {
    isUpdating = false;
  }
}

export async function getPredictions() {
  let pending = await Prediction.findOne({ status: 'pending' }).sort({ createdAt: -1 });

  if (!pending) {
    // İlk kurulum: eğit ve tahmin üret
    const hasWeights = await ModelWeights.countDocuments();
    if (hasWeights === 0) await trainFromScratch();
    pending = await generateAndSavePrediction();
  }

  return {
    predictionId:    pending._id,
    createdAt:       pending.createdAt,
    modelConfidence: pending.modelConfidence,
    predictions:     pending.predictions,
  };
}

export async function getPerformance() {
  const totalPredictions = await Prediction.countDocuments();
  const evaluated        = await Prediction.find({ status: 'evaluated' });

  const hitDistribution = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 };
  let totalNumbersHit   = 0;
  let evalResultCount   = 0;
  let bestEverHitScore  = 0;

  for (const pred of evaluated) {
    for (const r of (pred.evaluationResults || [])) {
      const key = String(r.numbersHit);
      hitDistribution[key] = (hitDistribution[key] || 0) + 1;
      totalNumbersHit += r.numbersHit;
      evalResultCount++;
    }
    if ((pred.bestHitScore || 0) > bestEverHitScore) bestEverHitScore = pred.bestHitScore;
  }

  const avgNumbersHit = evalResultCount > 0 ? totalNumbersHit / evalResultCount : 0;

  // Rastgele seçim beklentisi
  const allNums = new Set();
  const allResults = await Result.find({}, 'numbers');
  for (const r of allResults) for (const n of r.numbers) allNums.add(n);
  const poolSize = allNums.size;
  const randomBaselineExpected = poolSize > 0 ? (6 * 6) / poolSize : 0;

  return {
    totalPredictions,
    evaluatedPredictions:  evaluated.length,
    avgNumbersHit:         Math.round(avgNumbersHit * 1000) / 1000,
    bestEverHitScore,
    hitDistribution,
    randomBaselineExpected: Math.round(randomBaselineExpected * 100) / 100,
    improvementOverRandom:  Math.round((avgNumbersHit - randomBaselineExpected) * 1000) / 1000,
  };
}

export async function getStats() {
  const total  = await Result.countDocuments();
  const latest = await Result.findOne({}, 'drawId drawDate').sort({ drawId: -1 });
  const oldest = await Result.findOne({}, 'drawId drawDate').sort({ drawId:  1 });

  return {
    totalDraws: total,
    latestDraw: latest ? { drawId: latest.drawId, drawDate: latest.drawDate } : null,
    oldestDraw: oldest ? { drawId: oldest.drawId, drawDate: oldest.drawDate } : null,
  };
}
