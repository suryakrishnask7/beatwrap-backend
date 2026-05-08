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
// Incremental update — safely merges new plays into existing history.
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

    // Fetch existing or create new
    let history = await ListeningHistory.findOne({ userId, weekKey });
    if (!history) {
      history = new ListeningHistory({ userId, weekKey });
    }

    // Accumulate total minutes
    history.estimatedMinutes += (Number(addMinutes) || 0);

    // Accumulate daily minutes
    if (dailyMinutes) {
      for (const [date, mins] of Object.entries(dailyMinutes)) {
        const currentMins = history.dailyMinutes.get(date) || 0;
        history.dailyMinutes.set(date, currentMins + (Number(mins) || 0));
      }
    }

    // Accumulate total track plays
    if (trackPlayCounts) {
      for (const [trackId, count] of Object.entries(trackPlayCounts)) {
        const safeKey = trackId.replace(/\./g, '_');
        const currentCount = history.trackPlayCounts.get(safeKey) || 0;
        history.trackPlayCounts.set(safeKey, currentCount + (Number(count) || 0));
      }
    }

    // Safely merge daily top tracks
    if (dailyTopTracks) {
      for (const [date, newTracks] of Object.entries(dailyTopTracks)) {
        const existingTracks = history.dailyTopTracks.get(date) || [];
        
        // Map trackId -> track object for easy merging
        const trackMap = new Map();
        
        // Add existing tracks
        for (const t of existingTracks) {
          trackMap.set(t.trackId, { ...t });
        }
        
        // Add/Merge new tracks
        for (const t of newTracks) {
          if (trackMap.has(t.trackId)) {
            const existing = trackMap.get(t.trackId);
            existing.plays += (t.plays || 0);
          } else {
            trackMap.set(t.trackId, { ...t });
          }
        }
        
        // Sort by plays descending and take top 5
        const mergedAndSorted = Array.from(trackMap.values())
          .sort((a, b) => b.plays - a.plays)
          .slice(0, 5);
          
        history.dailyTopTracks.set(date, mergedAndSorted);
      }
    }

    history.lastUpdated = new Date();
    history.lastSyncAt = new Date();

    await history.save();

    res.json({
      success: true,
      totalMinutes: history.estimatedMinutes,
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