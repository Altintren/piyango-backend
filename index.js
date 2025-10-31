import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import cors from "cors";
import cron from "node-cron";

dotenv.config();

const app = express();
app.use(cors());
const PORT = process.env.PORT || 10000;
const mongoURI = process.env.MONGODB_URI;

// ✅ MongoDB bağlantısı
mongoose
  .connect(mongoURI, { dbName: "lotodb" })
  .then(() => console.log("✅ MongoDB bağlantısı başarılı"))
  .catch((err) => console.error("❌ MongoDB bağlantı hatası:", err));

const resultSchema = new mongoose.Schema({
  week: Number,
  numbers: [Number],
  joker: Number,
  superstar: Number,
  dateFetched: Date,
});
const Result = mongoose.model("Result", resultSchema);

// ✅ Fotomaç’taki çekiliş ID ve tarih listesini getirir
async function fetchDrawList() {
  const url = "https://www.fotomac.com.tr/sayisal-loto-sonuclari/";
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const draws = [];
  $("#historylistselect option").each((_, el) => {
    const value = $(el).attr("value");
    const dateText = $(el).text().trim();
    if (value && !isNaN(Number(value))) {
      draws.push({ id: Number(value), date: dateText });
    }
  });

  if (draws.length === 0) throw new Error("Hiç çekiliş linki bulunamadı.");
  return draws;
}

// ✅ Belirli bir çekiliş sayfasından sonuçları çeker
async function fetchDrawDetails(drawId) {
  const url = `https://www.fotomac.com.tr/sayisal-loto-sonuclari/${drawId}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const numbers = [];
  $(".lottery-wins-numbers span").each((_, el) => {
    const text = $(el).text().trim();
    if (text) numbers.push(Number(text));
  });

  let joker = null;
  let superstar = null;

  const jokerEl = $(".lottery-wins-numbers span.joker").text().trim();
  if (jokerEl) joker = Number(jokerEl);

  const superstarEl = $(".lottery-wins-numbers span.superstar").text().trim();
  if (superstarEl) superstar = Number(superstarEl);

  return { numbers: numbers.slice(0, 6), joker, superstar };
}

// ✅ Güncelleme işlemi
async function updateResults() {
  console.log("🚀 Veri güncelleme başlatıldı...");

  const allDraws = await fetchDrawList();

  // DB’deki en yüksek haftayı bul
  const lastRecord = await Result.findOne().sort({ week: -1 });
  const lastWeek = lastRecord ? lastRecord.week : 0;

  // Yeni çekilişleri filtrele
  const newDraws = allDraws.filter((_, index) => index + 1 > lastWeek);

  console.log(`📅 Toplam ${allDraws.length} çekiliş bulundu.`);
  console.log(`🔁 ${newDraws.length} yeni çekiliş eklenecek...`);

  let addedCount = 0;

  for (let i = 0; i < newDraws.length; i++) {
    const draw = newDraws[i];
    try {
      const result = await fetchDrawDetails(draw.id);
      const weekNumber = lastWeek + i + 1;

      const newResult = new Result({
        week: weekNumber,
        numbers: result.numbers,
        joker: result.joker,
        superstar: result.superstar,
        dateFetched: new Date(),
      });

      await newResult.save();
      addedCount++;
      console.log(`📥 ${weekNumber}. hafta (${draw.date}) kaydedildi.`);
    } catch (err) {
      console.log(`⚠️ ${draw.id} (${draw.date}) hatası: ${err.message}`);
    }
  }

  console.log(`🎯 Güncelleme tamamlandı. ${addedCount} yeni kayıt eklendi.`);
}

// ✅ Manuel güncelleme endpoint’i
app.get("/update", async (req, res) => {
  console.log("🧭 Manuel güncelleme isteği alındı...");
  try {
    await updateResults();
    res.json({ success: true, message: "Veri güncellendi." });
  } catch (err) {
    console.error("❌ Güncelleme hatası:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ Tahmin motoru endpoint’i
app.get("/api/predictions", async (req, res) => {
  try {
    const results = await Result.find();

    if (results.length === 0) {
      return res.json({
        topNumbers: [],
        topJokers: [],
        topSuperstars: [],
        predictions: [[], [], []],
      });
    }

    // Frekans hesaplama
    const numCount = new Map();
    const jokerCount = new Map();
    const superstarCount = new Map();

    for (const r of results) {
      r.numbers.forEach((n) => numCount.set(n, (numCount.get(n) || 0) + 1));
      if (r.joker) jokerCount.set(r.joker, (jokerCount.get(r.joker) || 0) + 1);
      if (r.superstar)
        superstarCount.set(r.superstar, (superstarCount.get(r.superstar) || 0) + 1);
    }

    const sortMap = (map, limit) =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([num]) => num);

    const topNumbers = sortMap(numCount, 10);
    const topJokers = sortMap(jokerCount, 3);
    const topSuperstars = sortMap(superstarCount, 3);

    // 3 tahmin üret
    const predictions = Array.from({ length: 3 }, () => {
      const nums = [...topNumbers]
        .sort(() => 0.5 - Math.random())
        .slice(0, 6)
        .sort((a, b) => a - b);

      const joker =
        topJokers.length > 0
          ? topJokers[Math.floor(Math.random() * topJokers.length)]
          : null;

      const superstar =
        topSuperstars.length > 0
          ? topSuperstars[Math.floor(Math.random() * topSuperstars.length)]
          : null;

      return [...nums, joker, superstar].filter((x) => x !== null);
    });

    res.json({
      topNumbers,
      topJokers,
      topSuperstars,
      predictions,
    });
  } catch (err) {
    console.error("❌ Tahmin hatası:", err);
    res.status(500).json({ message: "Tahmin hesaplama hatası" });
  }
});

// ✅ Her pazartesi 04:00'te otomatik çalışır
cron.schedule("0 4 * * 1", async () => {
  console.log("⏰ Otomatik haftalık güncelleme çalışıyor...");
  await updateResults();
});

app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
