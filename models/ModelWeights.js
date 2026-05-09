import mongoose from 'mongoose';

const modelWeightsSchema = new mongoose.Schema({
  number:            { type: Number, required: true, unique: true },
  score:             { type: Number, default: 0 },
  totalAppearances:  { type: Number, default: 0 },
  totalDraws:        { type: Number, default: 0 },
  recentAppearances: { type: Number, default: 0 },
  dayWeights:        { type: Object, default: {} },
  dayDrawCounts:     { type: Object, default: {} },
  predictedCount:    { type: Number, default: 0 },
  hitCount:          { type: Number, default: 0 },
});

export default mongoose.model('ModelWeights', modelWeightsSchema);
