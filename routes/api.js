import { Router } from 'express';
import { handleUpdate } from '../controllers/updateController.js';
import { handlePredictions } from '../controllers/predictionController.js';

const router = Router();

router.get('/update', handleUpdate);
router.get('/api/predictions', handlePredictions);

export default router;
