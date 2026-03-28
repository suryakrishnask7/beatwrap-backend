const mongoose = require('mongoose');

// Stores accumulated listening history per user per week
// Used to generate more accurate wraps based on full week's data
const listeningHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekKey: { type: String, required: true }, // e.g. "2025-W03"

  // Aggregated stats for the week
  topTracks: [{ type: Object }],    // Spotify track objects
  topArtists: [{ type: Object }],   // Spotify artist objects
  topGenres: [{ type: Object }],    // { genre, count }
  recentlyPlayed: [{ type: Object }], // raw recently played items

  // Computed metrics
  explorationIndex: { type: Number, default: 0 },
  discoveryRate: { type: Number, default: 0 },
  replayFrequency: { type: Number, default: 0 },
  estimatedMinutes: { type: Number, default: 0 },

  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true });

// One history entry per user per week
listeningHistorySchema.index({ userId: 1, weekKey: 1 }, { unique: true });

module.exports = mongoose.model('ListeningHistory', listeningHistorySchema);