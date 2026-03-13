const mongoose = require('mongoose');

const moodLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekKey: { type: String, required: true }, // e.g. "2025-W03"
  dayIndex: { type: Number, required: true }, // 0=Mon, 6=Sun
  day: { type: String }, // "Mon", "Tue" etc
  emoji: { type: String },
  label: { type: String },
  value: { type: String },
  note: { type: String, default: '' },
  loggedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// One mood per user per day per week
moodLogSchema.index({ userId: 1, weekKey: 1, dayIndex: 1 }, { unique: true });

module.exports = mongoose.model('MoodLog', moodLogSchema);