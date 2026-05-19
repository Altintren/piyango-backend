import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.fotomac.com.tr/sayisal-loto-sonuclari';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': 'https://www.fotomac.com.tr/',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { data } = await axios.get(url, { timeout: 15000, headers: HEADERS });
      return data;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await sleep(1500 * (attempt + 1));
    }
  }
}

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

  const prizeTable = [];
  $('.lottery-wins-money-item').each((_, el) => {
    const spans = $(el).find('span');
    if (spans.length < 2) return;

    const categoryRaw  = $(spans[0]).clone().find('strong').remove().end().text().trim();
    const category     = categoryRaw.replace(/\s+/g, ' ').replace(/:$/, '').trim();
    const winnersText  = $(spans[0]).find('strong').text().trim().replace(/\./g, '');
    const winnersCount = isNaN(Number(winnersText)) ? 0 : Number(winnersText);
    const prizeAmount  = $(spans[1]).find('strong').text().trim();

    if (category && prizeAmount) {
      prizeTable.push({ category, winnersCount, prizeAmount });
    }
  });

  return {
    numbers:    allNums.slice(0, 6),
    joker:      allNums.length >= 7 ? allNums[6] : null,
    superstar:  allNums.length >= 8 ? allNums[7] : null,
    prizeTable,
  };
}
