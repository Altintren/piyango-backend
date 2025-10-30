const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const cheerio = require("cheerio");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();
const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;
const mongoURI = process.env.MONGO_URI;

// =========================
// MongoDB Model
// =========================
const resultSchema = new mongoose.Schema({
  week: Number,
  numbers: [String],
  joker: String,
  superstar: String,
  dateFetched: { type: Date, default: Date.now },
});

const Result = mongoose.model("Result", resultSchema);

// =========================
// MongoDB Connection
// =========================
mongoose
  .connect(mongoURI, { dbName: "lotodb" })
  .then(() => console.log("✅ MongoDB bağlantısı başarılı"))
  .catch((err) => console.error("❌ MongoDB bağlantı hatası:", err));

// =========================
// Helper: Fotomaç'tan Linkleri Çek
// =========================
async function getAllDrawLinks() {
  const basePage = "https://www.fotomac.com.tr/sayisal-loto-sonuclari";
  const { data } = await axios.get(basePage);
  const $ = cheerio.load(data);

  let links = [];

  $("a").each((i, el) => {
    const href = $(el).attr("href");
    if (href && href.includes("/sayisal-loto-sonuclari/")) {
      const match = href.match(/sayisal-loto-sonuclari\/(\d+)/);
      if (match) {
        links.push({
          id: parseInt(match[1]),
          url: `https://www.fotomac.com.tr${href}`,
        });
      }
    }
  });

  // Tekrar edenleri kaldır ve ID'ye göre sırala
  links = [
    ...new Map(links.map((item) => [item.id, item])).values(),
  ].sort((a, b) => a.id - b.id);

  console.log(`🔗 ${links.length} çekiliş linki bulundu.`);
  return links;
}

// =========================
// Helper: Bir Sayfadan Verileri Çek
// =========================
async function scrapeDrawPage(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const nums = [];

    $(".lotonumbers .number").each((i, el) => {
      nums.push($(el).text().trim());
    });

    if (nums.length === 0) return null;

    // 6 - 7 - 8 sayı durumunu yönet
    const result = {
      numbers: nums.slice(0, 6),
      joker: nums[6] || null,
      superstar: nums[7] || null,
    };

    return result;
  } catch (err) {
    console.log(`⚠️ ${url} hata: ${err.message}`);
    return null;
  }
}

// =========================
// API: Manuel Veri Güncelleme (Hibrit Versiyon)
// =========================
app.get("/api/update-results", async (req, res) => {
  console.log("🧭 Manuel güncelleme isteği alındı...");

  try {
    console.log("🚀 Veri güncelleme başlatıldı...");

    const links = await getAllDrawLinks();
    if (!links.length) throw new Error("Hiç çekiliş linki bulunamadı.");

    // Mevcut son haftayı bul
    const last = await Result.findOne().sort({ week: -1 });
    const lastWeek = last ? last.week : 0;

    // Yeni linkleri filtrele
    const newLinks = links.filter((_, i) => i + 1 > lastWeek);

    console.log(
      `🔁 ${lastWeek + 1}. haftadan itibaren ${newLinks.length} yeni çekiliş işlenecek...`
    );

    let addedCount = 0;
    for (let i = 0; i < newLinks.length; i++) {
      const link = newLinks[i];
      const drawData = await scrapeDrawPage(link.url);

      if (drawData) {
        const result = new Result({
          week: lastWeek + 1 + i,
          numbers: drawData.numbers,
          joker: drawData.joker,
          superstar: drawData.superstar,
        });

        await result.save();
        addedCount++;
        console.log(
          `📥 ${result.week}. hafta (${drawData.numbers.length} sayı) kaydedildi.`
        );
      }
    }

    console.log(`🎯 Güncelleme tamamlandı. ${addedCount} yeni kayıt eklendi.`);
    res.json({ message: "Güncelleme tamamlandı", addedCount });
  } catch (err) {
    console.error("❌ Güncelleme hatası:", err);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// API: Tahmin Hesaplama
// =========================
app.get("/api/predictions", async (req, res) => {
  try {
    const results = await Result.find();

    const count = (arr) =>
      arr.reduce((acc, n) => {
        acc[n] = (acc[n] || 0) + 1;
        return acc;
      }, {});

    const allNumbers = results.flatMap((r) => r.numbers || []);
    const allJokers = results.map((r) => r.joker).filter(Boolean);
    const allSuperstars = results.map((r) => r.superstar).filter(Boolean);

    const topNumbers = Object.entries(count(allNumbers))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n]) => n);

    const topJokers = Object.entries(count(allJokers))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n]) => n);

    const topSuperstars = Object.entries(count(allSuperstars))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n]) => n);

    const predictions = Array.from({ length: 3 }, () => [
      ...topNumbers.slice(0, 6),
      topJokers[0],
      topSuperstars[0],
    ]);

    res.json({ topNumbers, topJokers, topSuperstars, predictions });
  } catch (err) {
    console.error("❌ Tahmin hatası:", err);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// Server Start
// =========================
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
