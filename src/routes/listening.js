const express = require('express');
const mongoose = require('mongoose');
const ListeningHistory = require('../models/ListeningHistory');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// ── POST /api/listening/sync ─────────────────────────────────────────────────
// Full absolute upsert — used on fresh app load / week rollover.
// Overwrites estimatedMinutes with the accurate paginated total.
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const { weekKey, topTracks, topArtists, topGenres, recentlyPlayed, stats } = req.body;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

    const userId = new mongoose.Types.ObjectId(req.user.id);

    await ListeningHistory.findOneAndUpdate(
      { userId, weekKey },
      {
        topTracks:        topTracks  || [],
        topArtists:       topArtists || [],
        topGenres:        topGenres  || [],
        recentlyPlayed:   recentlyPlayed || [],
        explorationIndex: stats?.explorationIndex || 0,
        discoveryRate:    stats?.discoveryRate    || 0,
        replayFrequency:  stats?.replayFrequency  || 0,
        estimatedMinutes: stats?.estimatedMinutes || 0,
        lastUpdated:      new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, weekKey });
  } catch (e) {
    console.error('Listening sync error:', e.message);
    res.status(500).json({ error: 'Failed to sync listening history' });
  }
});

// ── POST /api/listening/incremental ─────────────────────────────────────────
// Incremental update — uses $inc so values accumulate correctly.
// Called every hour by the frontend with only the NEW plays since last sync.
// Body: {
//   weekKey,
//   addMinutes: Number,
//   dailyMinutes:    { "2026-05-01": 45, ... }
//   dailyTopTracks:  { "2026-05-01": [{trackId, name, artist, plays, albumImg}], ... }
//   trackPlayCounts: { "spotify_track_id": 3, ... }
// }
router.post('/incremental', authMiddleware, async (req, res) => {
  try {
    const { weekKey, addMinutes, dailyMinutes, dailyTopTracks, trackPlayCounts } = req.body;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

    const userId = new mongoose.Types.ObjectId(req.user.id);

    // $inc: accumulate minutes (never overwrite)
    const incOps = { estimatedMinutes: Number(addMinutes) || 0 };

    if (dailyMinutes) {
      Object.entries(dailyMinutes).forEach(([date, mins]) => {
        incOps[`dailyMinutes.${date}`] = Number(mins) || 0;
      });
    }

    if (trackPlayCounts) {
      Object.entries(trackPlayCounts).forEach(([trackId, count]) => {
        // Replace dots in track IDs to avoid MongoDB path conflicts
        const safeKey = trackId.replace(/\./g, '_');
        incOps[`trackPlayCounts.${safeKey}`] = Number(count) || 0;
      });
    }

    // $set: replace daily top tracks for each date (not incremented — recalculated each sync)
    const setOps = { lastUpdated: new Date(), lastSyncAt: new Date() };
    if (dailyTopTracks) {
      Object.entries(dailyTopTracks).forEach(([date, tracks]) => {
        setOps[`dailyTopTracks.${date}`] = tracks.slice(0, 5);
      });
    }

    const result = await ListeningHistory.findOneAndUpdate(
      { userId, weekKey },
      { $inc: incOps, $set: setOps },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      totalMinutes: result.estimatedMinutes,
      weekKey,
    });
  } catch (e) {
    console.error('Incremental sync error:', e.message);
    res.status(500).json({ error: 'Failed to sync incremental listening data' });
  }
});

// ── GET /api/listening/history?weekKey= ─────────────────────────────────────
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { weekKey } = req.query;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const history = await ListeningHistory.findOne({ userId, weekKey });
    if (!history) return res.json({ found: false });

    res.json({
      found: true,
      topTracks:  history.topTracks,
      topArtists: history.topArtists,
      topGenres:  history.topGenres,
      dailyMinutes:   Object.fromEntries(history.dailyMinutes || new Map()),
      dailyTopTracks: Object.fromEntries(history.dailyTopTracks || new Map()),
      trackPlayCounts: Object.fromEntries(history.trackPlayCounts || new Map()),
      lastSyncAt: history.lastSyncAt,
      stats: {
        explorationIndex: history.explorationIndex,
        discoveryRate:    history.discoveryRate,
        replayFrequency:  history.replayFrequency,
        estimatedMinutes: history.estimatedMinutes,
        topGenres:        history.topGenres,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch listening history' });
  }
});

module.exports = router;