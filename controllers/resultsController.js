import Result from '../models/Result.js';

export async function handleResults(req, res) {
  try {
    const results = await Result.find()
      .sort({ drawDate: -1 })
      .limit(100)
      .select('value drawDate numbers joker superstar');
    res.json(results);
  } catch (err) {
    console.error('Sonuçlar hatası:', err);
    res.status(500).json({ message: 'Sonuçlar alınamadı' });
  }
}
