const mongoose = require('mongoose');

const listeningHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekKey: { type: String, required: true }, // e.g. "2025-W03"

  // Aggregated stats for the week
  topTracks:      [{ type: Object }],
  topArtists:     [{ type: Object }],
  topGenres:      [{ type: Object }], // { genre, count }
  recentlyPlayed: [{ type: Object }],

  // ── Locked-in weekly top 5 (computed from trackPlayCounts by cron) ──
  topTracksOfWeek: [{ 
    trackId: String, name: String, artist: String, 
    albumImg: String, plays: Number, durationMs: Number 
  }],
  topArtistsOfWeek: [{
    artistId: String, name: String, image: String,
    genres: [String], plays: Number
  }],
  uniqueGenres: [String], // all unique genres seen this week

  // Computed metrics (now updated by cron)
  explorationIndex: { type: Number, default: 0 },
  discoveryRate:    { type: Number, default: 0 },
  replayFrequency:  { type: Number, default: 0 },
  estimatedMinutes: { type: Number, default: 0 },

  // ── Per-day tracking ──────────────────────────────────────────────────
  // keyed by "YYYY-MM-DD"
  dailyMinutes:    { type: Map, of: Number,  default: {} },
  dailyTopTracks:  { type: Map, of: [Object], default: {} }, // top 5 tracks per day
  trackPlayCounts: { type: Map, of: Number,  default: {} },  // trackId → total plays this week

  // ── Per-artist tracking ───────────────────────────────────────────────
  artistPlayCounts: { type: Map, of: Number, default: {} },  // artistId → total plays
  artistMeta:       { type: Map, of: Object, default: {} },  // artistId → { name, image, genres }

  // ── Per-track metadata ────────────────────────────────────────────────
  trackMeta: { type: Map, of: Object, default: {} },  // trackId → { name, artist, albumImg, durationMs }

  lastSyncAt:  { type: Date, default: null },
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true });

listeningHistorySchema.index({ userId: 1, weekKey: 1 }, { unique: true });

module.exports = mongoose.model('ListeningHistory', listeningHistorySchema);