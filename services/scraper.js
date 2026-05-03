import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.fotomac.com.tr/sayisal-loto-sonuclari';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// DD.MM.YYYY → Date
function parseDrawDate(str) {
  const parts = str.trim().split('.');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  if (!day || !month || !year) return null;
  return new Date(year, month - 1, day);
}

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      return data;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }
}

// Çekiliş listesini döndürür: [{ value, drawDate }]
export async function fetchDrawList() {
  const html = await fetchWithRetry(`${BASE_URL}/`);
  const $ = cheerio.load(html);

  const draws = [];
  $('#historylistselect option').each((_, el) => {
    const raw = $(el).attr('value');
    const dateText = $(el).text().trim();
    const value = Number(raw);

    if (!raw || isNaN(value) || value <= 0) return;

    const drawDate = parseDrawDate(dateText);
    if (!drawDate) return;

    draws.push({ value, drawDate });
  });

  if (draws.length === 0) throw new Error('Hiç çekiliş bulunamadı.');
  return draws;
}

// Belirli bir çekiliş sayfasından numaraları çeker
export async function fetchDrawDetails(value) {
  await sleep(500);
  const html = await fetchWithRetry(`${BASE_URL}/${value}`);
  const $ = cheerio.load(html);

  const allNums = [];
  $('.lottery-wins-numbers span').each((_, el) => {
    const n = Number($(el).text().trim());
    if (Number.isInteger(n) && n >= 1 && n <= 99) allNums.push(n);
  });

  if (allNums.length < 6) {
    throw new Error(`Geçersiz numara sayısı: ${allNums.length}`);
  }

  return {
    numbers:   allNums.slice(0, 6),
    joker:     allNums.length >= 7 ? allNums[6] : null,
    superstar: allNums.length >= 8 ? allNums[7] : null,
  };
}
