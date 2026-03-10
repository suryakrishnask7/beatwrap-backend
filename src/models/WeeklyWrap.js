const mongoose = require('mongoose');

const weeklyWrapSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekKey: { type: String, required: true }, // e.g., "2024-W23"
  weekStart: { type: Date },
  weekEnd: { type: Date },

  // Spotify data
  topTracks: [{ id: String, name: String, artists: [{ name: String }], duration_ms: Number }],
  topArtists: [{ id: String, name: String, genres: [String] }],
  recentlyPlayed: { type: Number, default: 0 }, // count

  // Computed stats
  stats: {
    topGenres: [{ genre: String, count: Number }],
    explorationIndex: Number,
    discoveryRate: Number,
    replayFrequency: Number,
    estimatedMinutes: Number,
    genreShift: Number,
    uniqueArtists: Number,
    totalTracks: Number,
  },

  // AI generated content
  aiWrap: {
    week_label: String,
    dominant_vibe: String,
    energy_level: String,
    tamil_protagonist: {
      archetype: String,
      inspired_by: String,
    },
    tamil_character: {
      name: String,
      film: String,
      why_this_character: String,
    },
    story: String,
    confidence: Number,
  },

  // Mood logs for this week
  moodLogs: [{
    day: String,
    emoji: String,
    label: String,
    value: String,
    note: String,
    timestamp: Number,
  }],
}, { timestamps: true });

weeklyWrapSchema.index({ userId: 1, weekKey: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyWrap', weeklyWrapSchema);
