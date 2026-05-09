import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.fotomac.com.tr/sayisal-loto-sonuclari';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { data } = await axios.get(url, { timeout: 15000 });
      return data;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await sleep(1500 * (attempt + 1));
    }
  }
}

// Tüm çekiliş listesini döndürür: [{ id: Number, date: String }]
export async function fetchDrawList() {
  const html = await fetchWithRetry(`${BASE_URL}/`);
  const $ = cheerio.load(html);

  const draws = [];
  $('#historylistselect option').each((_, el) => {
    const raw  = $(el).attr('value');
    const date = $(el).text().trim();
    const id   = Number(raw);

    if (!raw || isNaN(id) || id <= 0) return;
    draws.push({ id, date });
  });

  if (draws.length === 0) throw new Error('Hiç çekiliş option bulunamadı.');
  return draws;
}

// Tek çekiliş detayını döndürür
export async function fetchDrawDetails(drawId) {
  await sleep(800);
  const html = await fetchWithRetry(`${BASE_URL}/${drawId}`);
  const $ = cheerio.load(html);

  const allNums = [];
  $('.lottery-wins-numbers span').each((_, el) => {
    const n = Number($(el).text().trim());
    if (Number.isInteger(n) && n >= 1 && n <= 99) allNums.push(n);
  });

  if (allNums.length < 6) {
    throw new Error(`Geçersiz numara sayısı: ${allNums.length} (drawId: ${drawId})`);
  }

  return {
    numbers:   allNums.slice(0, 6),
    joker:     allNums.length >= 7 ? allNums[6] : null,
    superstar: allNums.length >= 8 ? allNums[7] : null,
  };
}
