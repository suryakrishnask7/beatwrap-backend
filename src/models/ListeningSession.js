const mongoose = require('mongoose');

// Tracks individual playback sessions per user per track.
// startTime is set when playback begins; endTime + durationSeconds set when it ends.
const listeningSessionSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trackId:         { type: String, required: true },
  startTime:       { type: Date, required: true },
  endTime:         { type: Date, default: null },
  durationSeconds: { type: Number, default: 0 },
}, { timestamps: true });

// Efficient queries for "sessions in current week" per user
listeningSessionSchema.index({ userId: 1, startTime: 1 });

module.exports = mongoose.model('ListeningSession', listeningSessionSchema);
