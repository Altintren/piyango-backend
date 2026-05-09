import cron from 'node-cron';
import { updateResults, checkForNewDraw } from '../controllers/lotteryController.js';

export function startCronJobs() {
  // Yedek tam güncelleme: Sal/Per/Paz 04:00 (çekiliş gecesinin ardından)
  cron.schedule('0 4 * * 0,2,4', async () => {
    console.log('Yedek tam güncelleme başlatıldı...');
    try {
      const result = await updateResults();
      console.log(`Güncelleme tamamlandı: ${result.added} yeni, ${result.skipped} atlandı`);
    } catch (err) {
      console.error('Cron hatası:', err.message);
    }
  }, { timezone: 'Europe/Istanbul' });

  // Saatlik hafif kontrol: çekiliş gecesi 22:00–23:00 (Pzt/Çar/Cmt)
  cron.schedule('0 22,23 * * 1,3,6', async () => {
    console.log('Saatlik çekiliş kontrolü (gece)...');
    try {
      await checkForNewDraw();
    } catch (err) {
      console.error('Saatlik kontrol hatası:', err.message);
    }
  }, { timezone: 'Europe/Istanbul' });

  // Saatlik hafif kontrol: gece yarısı–sabah 00:00–03:00 (Sal/Per/Paz)
  cron.schedule('0 0-3 * * 0,2,4', async () => {
    console.log('Saatlik çekiliş kontrolü (sabah)...');
    try {
      await checkForNewDraw();
    } catch (err) {
      console.error('Saatlik kontrol hatası:', err.message);
    }
  }, { timezone: 'Europe/Istanbul' });

  console.log('Cron aktif: Yedek (Paz/Sal/Per 04:00) + Saatlik kontrol (çekiliş geceleri 22:00–03:00)');
}
