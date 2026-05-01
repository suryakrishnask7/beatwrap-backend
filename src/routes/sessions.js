const express = require('express');
const mongoose = require('mongoose');
const ListeningSession = require('../models/ListeningSession');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// POST /api/sessions/start
// Called when the user begins playing a track.
// Body: { trackId }
// Returns: { sessionId }
router.post('/start', authMiddleware, async (req, res) => {
  try {
    const { trackId } = req.body;
    if (!trackId) return res.status(400).json({ error: 'trackId required' });

    const userId = new mongoose.Types.ObjectId(req.user.id);

    const session = await ListeningSession.create({
      userId,
      trackId,
      startTime: new Date(),
    });

    res.status(201).json({ sessionId: session._id.toString() });
  } catch (e) {
    console.error('Session start error:', e);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// POST /api/sessions/end
// Called when playback stops or the user skips.
// Body: { sessionId, durationSeconds }
// Returns: { success }
router.post('/end', authMiddleware, async (req, res) => {
  try {
    const { sessionId, durationSeconds } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const dur = Math.max(0, Math.round(Number(durationSeconds) || 0));

    const session = await ListeningSession.findOneAndUpdate(
      { _id: sessionId, userId, endTime: null }, // only update open sessions belonging to this user
      { endTime: new Date(), durationSeconds: dur },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found or already ended' });
    }

    res.json({ success: true, durationSeconds: session.durationSeconds });
  } catch (e) {
    console.error('Session end error:', e);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

module.exports = router;
