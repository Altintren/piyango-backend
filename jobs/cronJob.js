import cron from 'node-cron';
import { updateResults } from '../services/updateService.js';

export function startCronJobs() {
  // Sayısal Loto çekilişleri: Çarşamba ve Cumartesi 21:00 İstanbul
  cron.schedule('0 21 * * 3,6', async () => {
    console.log('Otomatik güncelleme başlatıldı...');
    try {
      const result = await updateResults();
      console.log(`Güncelleme tamamlandı: ${result.added} yeni kayıt, ${result.failed} hata`);
    } catch (err) {
      console.error('Cron hatası:', err);
    }
  }, { timezone: 'Europe/Istanbul' });

  console.log('Cron job aktif: Çarşamba + Cumartesi 21:00 (İstanbul)');
}
