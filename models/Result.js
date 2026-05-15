import mongoose from 'mongoose';

const prizeItemSchema = new mongoose.Schema({
  category:     String,
  winnersCount: Number,
  prizeAmount:  String,
}, { _id: false });

const resultSchema = new mongoose.Schema({
  drawId:   { type: Number, required: true, unique: true },
  drawDate: { type: String, required: true },
  numbers:  {
    type: [Number],
    required: true,
    validate: { validator: v => v.length === 6, message: 'numbers dizisi tam 6 eleman içermeli' },
  },
  joker:      { type: Number, default: null },
  superstar:  { type: Number, default: null },
  prizeTable: { type: [prizeItemSchema], default: [] },
}, { timestamps: true });

export default mongoose.model('Result', resultSchema);
