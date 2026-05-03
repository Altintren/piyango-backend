import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import router from './routes/api.js';
import { startCronJobs } from './jobs/cronJob.js';

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

async function start() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable tanımlı değil.');
  }
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'lotodb' });
  console.log('MongoDB bağlantısı başarılı');

  app.use(router);

  app.listen(PORT, () => {
    console.log(`Server port ${PORT} üzerinde çalışıyor`);
    startCronJobs();
  });
}

start().catch(err => {
  console.error('Başlatma hatası:', err);
  process.exit(1);
});
