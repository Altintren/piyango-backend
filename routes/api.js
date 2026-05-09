import { Router } from 'express';
import {
  updateResults,
  getPredictions,
  getPerformance,
  getStats,
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

router.get('/api/update',      wrap(async () => { const r = await updateResults(); return { success: true, ...r }; }));
router.get('/api/predictions', wrap(getPredictions));
router.get('/api/performance', wrap(getPerformance));
router.get('/api/stats',       wrap(getStats));

export default router;
