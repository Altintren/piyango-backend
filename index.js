import express from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import cheerio from 'cheerio';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());

// =========================
// MongoDB Bağlantısı
// =========================
mongoose.connect(process.env.MONGO_URI, {
  dbName: 'lotodb'
})
  .then(() => console.log('✅ MongoDB bağlantısı başarılı'))
  .catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

const resultSchema = new mongoose.Schema({
  week: Number,
  numbers: [String],
  joker: String,
  superstar: String,
  dateFetched: Date
});

const Result = mongoose.model('Result', resultSchema);

// =========================
// API: MANUEL VERİ GÜNCELLEME (Artımlı ve dinamik versiyon)
// =========================
app.get('/api/update-results', async (req, res) => {
  console.log('🧭 Manuel güncelleme isteği alındı...');
  try {
    console.log('🚀 Veri güncelleme başlatıldı...');

    const baseUrl = 'https://www.fotomac.com.tr/superloto/cekilis-sonuclari/';

    // Mevcut en son haftayı veritabanından al
    const lastResult = await Result.findOne().sort({ week: -1 });
    const startWeek = lastResult ? lastResult.week + 1 : 1;

    // Toplam haftayı otomatik bul (Fotomaç sayfasındaki son çekiliş linkine bak)
    const mainPage = await axios.get(baseUrl);
    const $main = cheerio.load(mainPage.data);

    let totalWeeks = 0;
    $main('.superloto-results__list a').each((i, el) => {
      const href = $main(el).attr('href');
      const match = href?.match(/cekilis-sonuclari\/(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > totalWeeks) totalWeeks = num;
      }
    });

    console.log(`📅 Fotomaç'ta tespit edilen toplam hafta sayısı: ${totalWeeks}`);

    if (totalWeeks < startWeek) {
      console.log('✅ Yeni hafta bulunamadı, veritabanı güncel.');
      return res.json({ message: 'Veritabanı zaten güncel.' });
    }

    const newResults = [];

    for (let week = startWeek; week <= totalWeeks; week++) {
      const url = `${baseUrl}${week}`;
      try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const numbers = [];
        $('.superloto-results__numbers .number').each((i, el) => {
          const num = $(el).text().trim();
          if (num) numbers.push(num);
        });

        if (numbers.length < 6) {
          console.log(`⚠️ ${week}. hafta için yeterli veri bulunamadı (${numbers.length})`);
          continue;
        }

        let mainNumbers = [];
        let joker = null;
        let superstar = null;

        if (numbers.length === 6) {
          mainNumbers = numbers;
        } else if (numbers.length === 7) {
          mainNumbers = numbers.slice(0, 6);
          joker = numbers[6];
        } else if (numbers.length >= 8) {
          mainNumbers = numbers.slice(0, 6);
          joker = numbers[6];
          superstar = numbers[7];
        }

        const result = new Result({
          week,
          numbers: mainNumbers,
          joker,
          superstar,
          dateFetched: new Date()
        });

        await result.save();
        newResults.push(week);

        console.log(`📥 ${week}. hafta: ${mainNumbers.join(', ')}${joker ? ` + Joker ${joker}` : ''}${superstar ? ` + SüperStar ${superstar}` : ''}`);

      } catch (err) {
        console.log(`❌ ${week}. hafta alınamadı: ${err.message}`);
      }
    }

    if (newResults.length === 0) {
      console.log('✅ Güncel veri yok, hiçbir yeni hafta eklenmedi.');
      return res.json({ message: 'Yeni veri bulunamadı.' });
    }

    console.log(`✅ Güncelleme tamamlandı. ${newResults.length} yeni hafta eklendi.`);
    res.json({ message: `✅ ${newResults.length} yeni hafta eklendi.` });

  } catch (error) {
    console.error('❌ Güncelleme hatası:', error);
    res.status(500).json({ error: 'Veri güncelleme başarısız.' });
  }
});

// =========================
// API: TAHMİN ÜRET (geçici sade sürüm, Step10B'de geliştirilecek)
// =========================
app.get('/api/predictions', async (req, res) => {
  res.json({
    message: 'Tahmin motoru Step10B\'de güncellenecek.'
  });
});

// =========================
// SERVER BAŞLAT
// =========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
