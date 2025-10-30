// functions/index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Config ----------
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI environment variable is missing.');
}

const BASE_URL = 'https://www.fotomac.com.tr/sayisal-loto-sonuclari/';
const AXIOS_DEFAULTS = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; PiyangoBot/1.0; +https://example.com)',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  },
  timeout: 15000,
};

// ---------- Mongo setup ----------
mongoose
  .connect(MONGO_URI, { dbName: 'lotodb' })
  .then(() => console.log('✅ MongoDB bağlantısı başarılı'))
  .catch((err) => console.error('❌ MongoDB bağlantı hatası:', err));

const resultSchema = new mongoose.Schema({
  week: { type: Number, required: true, unique: true },
  numbers: [String],
  joker: { type: String, default: null },
  superstar: { type: String, default: null },
  dateFetched: { type: Date, default: Date.now },
});

const Result = mongoose.model('Result', resultSchema);

// ---------- Helper Functions ----------

// HTML sayfasından sayıları çek
function parseNumbersFromPage($) {
  const selectors = [
    '.lottery-wins-numbers span',
    '.superloto-results__numbers .number',
    '.results__numbers .number',
    '.result-numbers span',
    '.numbers-list span'
  ];

  for (const sel of selectors) {
    const numbers = $(sel).map((i, el) => $(el).text().trim()).get();
    if (numbers.length >= 6) return numbers;
  }

  // fallback (metindeki tüm sayıları topla)
  const text = $('body').text();
  const matches = text.match(/\b\d{1,2}\b/g);
  return matches ? matches.slice(0, 8) : [];
}

// Haftaların toplam sayısını otomatik bul
async function detectTotalWeeks() {
  console.log('🔎 Hafta sayısı tespit ediliyor...');
  let week = 1;
  let lastGood = 0;
  let consecutive404 = 0;
  const MAX_PROBES = 1000;

  while (consecutive404 < 3 && week <= MAX_PROBES) {
    try {
      const url = `${BASE_URL}${week}`;
      const resp = await axios.get(url, AXIOS_DEFAULTS);
      if (resp.status === 200) {
        lastGood = week;
        consecutive404 = 0;
      } else {
        consecutive404++;
      }
    } catch (err) {
      if (err.response && err.response.status === 404) consecutive404++;
      else console.warn(`⚠️ ${BASE_URL}${week} hata: ${err.message}`);
    }

    week++;
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`📅 Toplam ${lastGood} hafta bulundu.`);
  return lastGood;
}

// ---------- API: Sonuçları Güncelle ----------
app.get('/api/update-results', async (req, res) => {
  console.log('🧭 Manuel güncelleme isteği alındı...');
  try {
    const totalWeeks = await detectTotalWeeks();
    const lastResult = await Result.findOne().sort({ week: -1 });
    const startWeek = lastResult ? lastResult.week + 1 : 1;
    console.log(`🔁 ${startWeek}. haftadan itibaren güncellenecek...`);

    const addedWeeks = [];

    for (let week = startWeek; week <= totalWeeks; week++) {
      const url = `${BASE_URL}${week}`;
      console.log(`📡 ${url}`);

      try {
        const { data } = await axios.get(url, AXIOS_DEFAULTS);
        const $ = cheerio.load(data);
        const numbers = parseNumbersFromPage($);

        if (numbers.length < 6) {
          console.warn(`⚠️ ${week}. hafta yetersiz veri (${numbers.length})`);
          continue;
        }

        let main = numbers.slice(0, 6);
        let joker = null;
        let superstar = null;

        if (numbers.length === 7) joker = numbers[6];
        if (numbers.length >= 8) {
          joker = numbers[6];
          superstar = numbers[7];
        }

        const doc = new Result({
          week,
          numbers: main,
          joker,
          superstar,
          dateFetched: new Date()
        });

        await doc.save();
        console.log(`✅ ${week}. hafta kaydedildi: ${main.join(', ')}${joker ? ` + Joker ${joker}` : ''}${superstar ? ` + SüperStar ${superstar}` : ''}`);
        addedWeeks.push(week);

      } catch (err) {
        if (err.code === 11000) {
          console.log(`ℹ️ ${week}. hafta zaten kayıtlı`);
        } else if (err.response && err.response.status === 404) {
          console.warn(`⚠️ ${week}. hafta bulunamadı (404)`);
        } else {
          console.error(`❌ ${week}. hafta hata: ${err.message}`);
        }
      }

      await new Promise((r) => setTimeout(r, 200)); // siteye nazik davran
    }

    console.log(`🎯 Güncelleme tamamlandı. ${addedWeeks.length} yeni kayıt eklendi.`);
    res.json({ message: 'Güncelleme tamamlandı', addedWeeks });

  } catch (err) {
    console.error('❌ Güncelleme hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- API: Tahminler ----------
app.get('/api/predictions', async (req, res) => {
  try {
    const results = await Result.find();
    const numbersFreq = {}, jokerFreq = {}, superstarFreq = {};

    for (const r of results) {
      for (const n of r.numbers) numbersFreq[n] = (numbersFreq[n] || 0) + 1;
      if (r.joker) jokerFreq[r.joker] = (jokerFreq[r.joker] || 0) + 1;
      if (r.superstar) superstarFreq[r.superstar] = (superstarFreq[r.superstar] || 0) + 1;
    }

    const topNumbers = Object.entries(numbersFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n]) => n);
    const topJokers = Object.entries(jokerFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    const topSuperstars = Object.entries(superstarFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);

    const predictions = Array.from({ length: 3 }).map((_, i) => ({
      numbers: topNumbers.slice(i * 2, i * 2 + 6),
      joker: topJokers[i % topJokers.length] || null,
      superstar: topSuperstars[i % topSuperstars.length] || null
    }));

    res.json({ topNumbers, topJokers, topSuperstars, predictions });
  } catch (err) {
    console.error('❌ Tahmin hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Server ----------
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});
