import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import cron from "node-cron";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, { dbName: "lotodb" })
  .then(() => console.log("✅ MongoDB bağlantısı başarılı"))
  .catch(err => console.error("❌ MongoDB bağlantı hatası:", err));

const resultSchema = new mongoose.Schema({
  week: Number,
  numbers: [Number],
  joker: Number,
  superstar: Number,
  date: String,
  url: String
});
const Result = mongoose.model("Result", resultSchema);

const BASE_URL = "https://www.fotomac.com.tr/sayisal-loto-sonuclari";

// 📅 Tüm çekiliş ID ve tarihlerini alır
async function getAllDraws() {
  const { data } = await axios.get(BASE_URL);
  const $ = cheerio.load(data);
  const draws = [];

  $("#historylistselect option").each((_, el) => {
    const value = $(el).attr("value");
    const dateText = $(el).text().trim();
    if (value && dateText) {
      draws.push({
        id: value,
        date: dateText,
        url: `${BASE_URL}/${value}`,
      });
    }
  });

  if (draws.length === 0) throw new Error("Hiç çekiliş bulunamadı!");
  console.log(`📅 ${draws.length} çekiliş bulundu.`);
  return draws.reverse(); // Eskiden yeniye sıralar
}

// 🔢 Tek çekilişi parse eder
async function scrapeDraw(draw) {
  try {
    const { data } = await axios.get(draw.url);
    const $ = cheerio.load(data);

    const numbers = $(".lottery-wins-numbers span:not(.joker):not(.superstar)")
      .map((_, el) => parseInt($(el).text().trim()))
      .get();

    const joker = parseInt($(".lottery-wins-numbers span.joker").text().trim()) || null;
    const superstar = parseInt($(".lottery-wins-numbers span.superstar").text().trim()) || null;

    if (numbers.length < 6) {
      console.log(`⚠️ Eksik veri: ${draw.url}`);
      return null;
    }

    const weekMatch = $("title").text().match(/(\d+)\. hafta/i);
    const week = weekMatch ? parseInt(weekMatch[1]) : (await Result.countDocuments()) + 1;

    console.log(`📥 ${week}. hafta (${draw.date}) için ${numbers.length} sayı çekildi.`);
    return { week, numbers, joker, superstar, date: draw.date, url: draw.url };
  } catch (err) {
    console.log(`⚠️ ${draw.url} hata: ${err.response?.status || err.message}`);
    return null;
  }
}

// 🔁 Yeni çekilişleri ekler
async function updateResults() {
  console.log("🚀 Veri güncelleme başlatıldı...");
  const existing = await Result.find({}, { url: 1 });
  const existingUrls = new Set(existing.map(r => r.url));

  const draws = await getAllDraws();
  const newDraws = draws.filter(d => !existingUrls.has(d.url));
  console.log(`🔍 ${newDraws.length} yeni çekiliş bulundu.`);

  for (const draw of newDraws) {
    const result = await scrapeDraw(draw);
    if (result) await new Result(result).save();
  }

  console.log(`🎯 Güncelleme tamamlandı. ${newDraws.length} yeni kayıt eklendi.`);
  return newDraws.length;
}

// 🧭 Manuel tetikleme
app.get("/update", async (req, res) => {
  console.log("🧭 Manuel güncelleme isteği alındı...");
  try {
    const added = await updateResults();
    res.json({ success: true, added });
  } catch (err) {
    console.error("❌ Güncelleme hatası:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ⏰ Her gün sabah 04:00'te otomatik güncelleme
cron.schedule("0 4 * * *", async () => {
  console.log("⏰ Otomatik güncelleme zamanı geldi...");
  await updateResults();
});

app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
