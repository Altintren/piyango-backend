import mongoose from 'mongoose';

const evaluationResultSchema = new mongoose.Schema({
  predictionIndex: Number,
  numbersHit:      Number,
  jokerHit:        Boolean,
  superstarHit:    Boolean,
  totalHitScore:   Number,
}, { _id: false });

const predictionSchema = new mongoose.Schema({
  status:    { type: String, enum: ['pending', 'evaluated'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  predictions: [{
    numbers:   [Number],
    joker:     { type: Number, default: null },
    superstar: { type: Number, default: null },
    _id: false,
  }],
  modelConfidence: Number,

  evaluatedAgainstDrawId: { type: Number, default: null },
  evaluatedAt:            { type: Date,   default: null },
  evaluationResults:      { type: [evaluationResultSchema], default: [] },
  bestHitScore:           { type: Number, default: null },
  averageHitScore:        { type: Number, default: null },
});

export default mongoose.model('Prediction', predictionSchema);
