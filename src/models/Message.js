const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  // Conversation ID = sorted pair of user IDs joined by '_'
  // e.g. "abc123_xyz789" — always consistent regardless of who sends
  conversationId: { type: String, required: true, index: true },
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['text', 'track'], default: 'text' },
  text: { type: String, default: '' },
  // For track messages
  payload: {
    name: String,
    artist: String,
    imageUrl: String,
    spotifyUrl: String,
    spotifyUri: String,
  },
}, { timestamps: true });

// Index for fast conversation loading
messageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);