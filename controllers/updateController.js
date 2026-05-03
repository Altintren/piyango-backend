import { updateResults } from '../services/updateService.js';

let isUpdating = false;

export async function handleUpdate(req, res) {
  if (isUpdating) {
    return res.status(429).json({ success: false, message: 'Güncelleme zaten devam ediyor.' });
  }

  isUpdating = true;
  try {
    const result = await updateResults();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Güncelleme hatası:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    isUpdating = false;
  }
}
