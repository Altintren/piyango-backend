import Result from '../models/Result.js';
import { fetchDrawList, fetchDrawDetails } from './scraper.js';

export async function updateResults() {
  const allDraws = await fetchDrawList();

  const existingValues = new Set(await Result.distinct('value'));
  const newDraws = allDraws.filter(d => !existingValues.has(d.value));

  console.log(`Toplam: ${allDraws.length} çekiliş | Yeni: ${newDraws.length}`);

  let added = 0;
  let failed = 0;

  for (const draw of newDraws) {
    try {
      const { numbers, joker, superstar } = await fetchDrawDetails(draw.value);

      // upsert: aynı value zaten varsa hiçbir şey değişmez
      await Result.findOneAndUpdate(
        { value: draw.value },
        { $setOnInsert: { value: draw.value, drawDate: draw.drawDate, numbers, joker, superstar } },
        { upsert: true, new: false }
      );

      added++;
      console.log(`Kaydedildi: ${draw.value} (${draw.drawDate.toLocaleDateString('tr-TR')})`);
    } catch (err) {
      failed++;
      console.error(`Hata [value=${draw.value}]: ${err.message}`);
    }
  }

  return { total: allDraws.length, added, failed };
}
