import Result from '../models/Result.js';

// Ağırlıklı havuzdan tek numara seçer
function weightedPick(countMap) {
  const entries = [...countMap.entries()];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let rand = Math.random() * total;
  for (const [num, weight] of entries) {
    rand -= weight;
    if (rand <= 0) return num;
  }
  return entries[entries.length - 1][0];
}

// Ağırlıklı havuzdan n adet tekrarsız seçer
function weightedSample(countMap, n) {
  const pool = new Map(countMap);
  const result = [];
  while (result.length < n && pool.size > 0) {
    const num = weightedPick(pool);
    result.push(num);
    pool.delete(num);
  }
  return result;
}

// Son 50 çekilişe 2x ağırlık verir
function buildNumWeights(results) {
  const recentIds = new Set(results.slice(-50).map(r => r._id.toString()));
  const weights = new Map();
  for (const r of results) {
    const w = recentIds.has(r._id.toString()) ? 2 : 1;
    for (const n of r.numbers) {
      weights.set(n, (weights.get(n) || 0) + w);
    }
  }
  return weights;
}

function isBalanced(nums, midpoint, sumMin, sumMax) {
  const odd = nums.filter(n => n % 2 !== 0).length;
  const low = nums.filter(n => n <= midpoint).length;
  const sum = nums.reduce((a, b) => a + b, 0);
  return odd >= 2 && odd <= 4 && low >= 2 && low <= 4 && sum >= sumMin && sum <= sumMax;
}

function generateNumbers(weightMap, midpoint, sumMin, sumMax) {
  for (let i = 0; i < 150; i++) {
    const nums = weightedSample(weightMap, 6).sort((a, b) => a - b);
    if (isBalanced(nums, midpoint, sumMin, sumMax)) return nums;
  }
  return weightedSample(weightMap, 6).sort((a, b) => a - b);
}

function topN(countMap, n) {
  return [...countMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([num]) => num);
}

export async function getPredictions() {
  const results = await Result.find().sort({ drawDate: 1 });

  if (results.length === 0) {
    return { topNumbers: [], topJokers: [], topSuperstars: [], predictions: [] };
  }

  const numWeights  = buildNumWeights(results);
  const numFreq     = new Map();
  const jokerFreq   = new Map();
  const superFreq   = new Map();

  for (const r of results) {
    for (const n of r.numbers) numFreq.set(n, (numFreq.get(n) || 0) + 1);
    if (r.joker    != null) jokerFreq.set(r.joker,    (jokerFreq.get(r.joker)       || 0) + 1);
    if (r.superstar != null) superFreq.set(r.superstar, (superFreq.get(r.superstar) || 0) + 1);
  }

  // Sayı aralığını veriden tespit et
  const allNums = results.flatMap(r => r.numbers);
  const maxNum  = Math.max(...allNums);
  const midpoint = Math.floor(maxNum / 2);
  // Tarihsel ortalama toplamın %60–140'ı
  const avgSum  = allNums.reduce((a, b) => a + b, 0) / results.length;
  const sumMin  = Math.floor(avgSum * 0.6);
  const sumMax  = Math.ceil(avgSum * 1.4);

  const hasJoker  = jokerFreq.size > 0;
  const hasSuper  = superFreq.size > 0;

  const predictions = Array.from({ length: 3 }, () => {
    const pred = { numbers: generateNumbers(numWeights, midpoint, sumMin, sumMax) };
    if (hasJoker) pred.joker     = weightedPick(jokerFreq);
    if (hasSuper) pred.superstar = weightedPick(superFreq);
    return pred;
  });

  return {
    topNumbers:    topN(numFreq,   10),
    topJokers:     topN(jokerFreq,  3),
    topSuperstars: topN(superFreq,  3),
    predictions,
  };
}
