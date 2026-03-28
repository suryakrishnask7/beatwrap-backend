const express = require('express');
const mongoose = require('mongoose');
const ListeningHistory = require('../models/ListeningHistory');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// POST /api/listening/sync
// Called by the app periodically (on HomeScreen load, on app foreground)
// Saves the user's current week listening data to Atlas
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const { weekKey, topTracks, topArtists, topGenres, recentlyPlayed, stats } = req.body;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

    const userId = new mongoose.Types.ObjectId(req.user.id);

    // Upsert — always update with latest data for the week
    const updated = await ListeningHistory.findOneAndUpdate(
      { userId, weekKey },
      {
        topTracks: topTracks || [],
        topArtists: topArtists || [],
        topGenres: topGenres || [],
        recentlyPlayed: recentlyPlayed || [],
        explorationIndex: stats?.explorationIndex || 0,
        discoveryRate: stats?.discoveryRate || 0,
        replayFrequency: stats?.replayFrequency || 0,
        estimatedMinutes: stats?.estimatedMinutes || 0,
        lastUpdated: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, weekKey });
  } catch (e) {
    console.error('Listening sync error:', e.message);
    res.status(500).json({ error: 'Failed to sync listening history' });
  }
});

// GET /api/listening/history?weekKey=
// Returns the stored listening data for a specific week
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { weekKey } = req.query;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const history = await ListeningHistory.findOne({ userId, weekKey });

    if (!history) return res.json({ found: false });

    res.json({
      found: true,
      topTracks: history.topTracks,
      topArtists: history.topArtists,
      topGenres: history.topGenres,
      stats: {
        explorationIndex: history.explorationIndex,
        discoveryRate: history.discoveryRate,
        replayFrequency: history.replayFrequency,
        estimatedMinutes: history.estimatedMinutes,
        topGenres: history.topGenres,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch listening history' });
  }
});

module.exports = router;