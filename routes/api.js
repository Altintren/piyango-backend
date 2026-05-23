import { Router } from 'express';
import {
  updateResults,
  checkForNewDraw,
  getPredictions,
  getPerformance,
  getStats,
  getRecentResults,
  getUpdateStatus,
  getComponentAnalysis,
} from '../controllers/lotteryController.js';

const router = Router();

const wrap = fn => async (req, res) => {
  try {
    const data = await fn();
    res.json(data);
  } catch (err) {
    console.error(`[${req.path}] Hata:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

router.get('/api/update', (req, res) => {
  res.json({ success: true });
  updateResults().then(r => {
    console.log(`Güncelleme tamamlandı: ${r.added} yeni, ${r.skipped} atlandı`);
  }).catch(err => {
    console.error('Güncelleme hatası:', err.message);
  });
});
router.get('/api/update/status', (req, res) => res.json(getUpdateStatus()));
router.get('/api/check', (req, res) => {
  res.json({ success: true, message: 'Kontrol başlatıldı.' });
  checkForNewDraw().catch(err => console.error('Check hatası:', err.message));
});
router.get('/api/predictions',    wrap(getPredictions));
router.get('/api/performance',    wrap(getPerformance));
router.get('/api/stats',          wrap(getStats));
router.get('/api/results/recent',    wrap(getRecentResults));
router.get('/api/analysis',          wrap(getComponentAnalysis));

export default router;
