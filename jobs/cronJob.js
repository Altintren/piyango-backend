import cron from 'node-cron';
import { updateResults } from '../controllers/lotteryController.js';

export function startCronJobs() {
  // Salı 04:00    — Pazartesi çekilişinin ardından
  // Perşembe 04:00 — Çarşamba çekilişinin ardından
  // Pazar 04:00   — Cumartesi çekilişinin ardından
  cron.schedule('0 4 * * 0,2,4', async () => {
    console.log('Otomatik güncelleme başlatıldı...');
    try {
      const result = await updateResults();
      console.log(`Güncelleme tamamlandı: ${result.added} yeni, ${result.skipped} atlandı`);
    } catch (err) {
      console.error('Cron hatası:', err.message);
    }
  }, { timezone: 'Europe/Istanbul' });

  console.log('Cron aktif: Pazar + Salı + Perşembe 04:00 (İstanbul)');
}
