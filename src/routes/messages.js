const express = require('express');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// GET /api/messages/:friendId — load conversation history
router.get('/:friendId', authMiddleware, async (req, res) => {
  try {
    const conversationId = [req.user.id, req.params.friendId].sort().join('_');
    const messages = await Message.find({ conversationId })
      .sort({ createdAt: 1 })
      .limit(100);

    res.json({ messages });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// GET /api/messages — get last message for each conversation (for inbox)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all conversations this user is part of
    const lastMessages = await Message.aggregate([
      { $match: { $or: [{ from: userId }, { to: userId }] } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationId', lastMsg: { $first: '$$ROOT' } } },
    ]);

    res.json({ conversations: lastMessages.map(c => c.lastMsg) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

module.exports = router;