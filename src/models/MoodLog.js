const mongoose = require('mongoose');

const moodLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekKey: { type: String, required: true },
  day: { type: String, required: true },
  dayIndex: { type: Number },
  emoji: { type: String, required: true },
  label: { type: String, required: true },
  value: { type: String, required: true },
  note: { type: String },
  timestamp: { type: Number },
}, { timestamps: true });

moodLogSchema.index({ userId: 1, weekKey: 1, day: 1 });

module.exports = mongoose.model('MoodLog', moodLogSchema);
