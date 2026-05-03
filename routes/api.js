import { Router } from 'express';
import { handleUpdate } from '../controllers/updateController.js';
import { handlePredictions } from '../controllers/predictionController.js';
import { handleResults } from '../controllers/resultsController.js';

const router = Router();

router.get('/update', handleUpdate);
router.get('/api/predictions', handlePredictions);
router.get('/api/results', handleResults);

export default router;
