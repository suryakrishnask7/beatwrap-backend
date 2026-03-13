const mongoose = require('mongoose');

const weeklyWrapSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekKey: { type: String, required: true }, // e.g. "2025-W03"
  aiWrap: { type: Object }, // full groq result
  stats: { type: Object }, // top genres, tracks, artists, etc
  lockedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// One wrap per user per week
weeklyWrapSchema.index({ userId: 1, weekKey: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyWrap', weeklyWrapSchema);