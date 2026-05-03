import { getPredictions } from '../services/predictor.js';

export async function handlePredictions(req, res) {
  try {
    const data = await getPredictions();
    res.json(data);
  } catch (err) {
    console.error('Tahmin hatası:', err);
    res.status(500).json({ message: 'Tahmin hesaplama hatası' });
  }
}
