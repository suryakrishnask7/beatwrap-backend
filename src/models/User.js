const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  spotifyId: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  username: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  email: { type: String },
  profileImage: { type: String },
  spotifyToken: { type: String },
  spotifyRefreshToken: { type: String },
  spotifyTokenExpiry: { type: Date },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // friendRequests have been moved to the Friendship model
  // NEW: tracks when user last regenerated their character — enforces once-per-day limit
  lastCharacterRegenAt: { type: Date, default: null },
  // Tracks the most recently played song for the friends "Notes" feature
  lastPlayedTrack: {
    trackId: String,
    name: String,
    artist: String,
    albumImg: String,
    playedAt: Date
  },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);