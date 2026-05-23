import mongoose from 'mongoose';

const componentStatSchema = new mongoose.Schema({
  avgPercentile: Number,  // 0–1: drawn numbers' avg rank in this component (0.5 = random baseline)
}, { _id: false });

const weightsSchema = new mongoose.Schema({
  baseFreq:   { type: Number, default: 0.30 },
  recentFreq: { type: Number, default: 0.40 },
  dayFreq:    { type: Number, default: 0.20 },
  hitRate:    { type: Number, default: 0.10 },
}, { _id: false });

const analysisLogSchema = new mongoose.Schema({
  runAt:                { type: Date, default: Date.now },
  totalDrawsInDB:       Number,
  avgHitScore:          Number,
  avgNumbersHit:        Number,
  bestEverHitScore:     Number,
  topNumbersSnapshot:   [Number],
  topJokersSnapshot:    [Number],
  topSuperstarsSnapshot:[Number],

  // Per-draw component analysis: how well each score component ranked the actual drawn numbers
  componentPerformance: {
    baseFreq:   componentStatSchema,
    recentFreq: componentStatSchema,
    dayFreq:    componentStatSchema,
  },

  // Dynamic weights computed from recent component performance history
  dynamicWeights: weightsSchema,
});

export default mongoose.model('AnalysisLog', analysisLogSchema);
