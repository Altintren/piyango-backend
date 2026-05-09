import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import router from './routes/api.js';
import { startCronJobs } from './jobs/cronJob.js';

dotenv.config();

process.on('unhandledRejection', reason => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

const app  = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

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
  console.error('Başlatma hatası:', err.message);
  process.exit(1);
});
