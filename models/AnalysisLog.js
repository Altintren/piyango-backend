import mongoose from 'mongoose';

const analysisLogSchema = new mongoose.Schema({
  runAt:                { type: Date, default: Date.now },
  totalDrawsInDB:       Number,
  avgHitScore:          Number,
  avgNumbersHit:        Number,
  bestEverHitScore:     Number,
  topNumbersSnapshot:   [Number],
  topJokersSnapshot:    [Number],
  topSuperstarsSnapshot:[Number],
});

export default mongoose.model('AnalysisLog', analysisLogSchema);
