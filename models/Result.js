import mongoose from 'mongoose';

const resultSchema = new mongoose.Schema({
  value:     { type: Number, required: true, unique: true },
  drawDate:  { type: Date,   required: true },
  numbers:   { type: [Number], required: true },
  joker:     { type: Number, default: null },
  superstar: { type: Number, default: null },
});

export default mongoose.model('Result', resultSchema);
