import ModelWeights from '../models/ModelWeights.js';
import Prediction from '../models/Prediction.js';
import Result from '../models/Result.js';

function weightedPickIdx(pool) {
  const total = pool.reduce((s, w) => s + Math.max(w.score, 0.0001), 0);
  let rand = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    rand -= Math.max(pool[i].score, 0.0001);
    if (rand <= 0) return i;
  }
  return pool.length - 1;
}

function weightedSample(weights, n) {
  const pool   = [...weights];
  const result = [];
  while (result.length < n && pool.length > 0) {
    const idx = weightedPickIdx(pool);
    result.push(pool[idx].number);
    pool.splice(idx, 1);
  }
  return result;
}

function weightedPickFrom(freqMap) {
  const entries = [...freqMap.entries()];
  const total   = entries.reduce((s, [, v]) => s + v, 0);
  let rand = Math.random() * total;
  for (const [num, count] of entries) {
    rand -= count;
    if (rand <= 0) return num;
  }
  return entries[entries.length - 1][0];
}

function isBalanced(nums) {
  const odd  = nums.filter(n => n % 2 !== 0).length;
  const even = nums.length - odd;
  const sum  = nums.reduce((a, b) => a + b, 0);
  return odd >= 2 && even >= 2 && sum >= 80 && sum <= 180;
}

export async function generateAndSavePrediction() {
  const weights = await ModelWeights.find();
  if (weights.length === 0) throw new Error('ModelWeights boş. Önce trainFromScratch çalıştırılmalı.');

  const results = await Result.find({}, 'numbers superstar');

  // Daha önce gerçek çekilişte çıkmış kombinasyonları dışla
  const existingCombos = new Set(
    results.map(r => [...r.numbers].sort((a, b) => a - b).join(','))
  );

  // Süperstar frekansı (bağımsız tamburdan çekilir)
  const superFreq = new Map();
  for (const r of results) {
    if (r.superstar != null) superFreq.set(r.superstar, (superFreq.get(r.superstar) || 0) + 1);
  }

  const predictions = [];
  const usedCombos  = new Set();

  for (let p = 0; p < 3; p++) {
    let nums  = null;
    let found = false;

    for (let attempt = 0; attempt < 200; attempt++) {
      const candidate = weightedSample(weights, 6).sort((a, b) => a - b);
      const key = candidate.join(',');

      if (isBalanced(candidate) && !existingCombos.has(key) && !usedCombos.has(key)) {
        nums = candidate;
        usedCombos.add(key);
        found = true;
        break;
      }
    }

    if (!found) {
      // 200 denemede dengeli bulunamazsa, en azından mevcut çekilişlerden farklı ol
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = weightedSample(weights, 6).sort((a, b) => a - b);
        const key = candidate.join(',');
        if (!existingCombos.has(key) && !usedCombos.has(key)) {
          nums = candidate;
          usedCombos.add(key);
          break;
        }
      }
      if (!nums) {
        // Son çare: sadece mevcut çekilişlerden farklı ol
        for (let attempt = 0; attempt < 200; attempt++) {
          const candidate = weightedSample(weights, 6).sort((a, b) => a - b);
          if (!existingCombos.has(candidate.join(','))) {
            nums = candidate;
            break;
          }
        }
        if (!nums) nums = weightedSample(weights, 6).sort((a, b) => a - b);
      }
    }

    // Joker tahmin edilmez — çekiliş sonucu joker sayısı bizim 6 tahminimiz içinde mi diye kontrol edilir.
    // Süperstar: bağımsız tamburdan frekansa göre seçilir.
    const superstar = superFreq.size > 0 ? weightedPickFrom(superFreq) : null;

    predictions.push({ numbers: nums, joker: null, superstar });
  }

  // Model güveni: tahmin edilen sayıların ortalama skoru
  const scoreMap        = new Map(weights.map(w => [w.number, w.score]));
  const allPredNums     = predictions.flatMap(p => p.numbers);
  const modelConfidence = allPredNums.reduce((s, n) => s + (scoreMap.get(n) || 0), 0) / allPredNums.length;

  const prediction = await Prediction.create({
    status: 'pending',
    createdAt: new Date(),
    predictions,
    modelConfidence,
  });

  console.log(`Yeni tahmin oluşturuldu (güven: ${modelConfidence.toFixed(4)})`);
  return prediction;
}
