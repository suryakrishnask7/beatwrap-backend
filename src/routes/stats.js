const express = require('express');
const mongoose = require('mongoose');
const ListeningSession = require('../models/ListeningSession');
const ListeningHistory = require('../models/ListeningHistory');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns { weekStart, weekEnd } as Date objects for the ISO week containing `now`. */
function getCurrentISOWeekRange(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  // ISO week starts on Monday
  const day = d.getUTCDay() || 7; // 0 (Sun) → 7
  d.setUTCDate(d.getUTCDate() - day + 1); // rewind to Monday
  const weekStart = new Date(d);
  const weekEnd = new Date(d);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7); // exclusive upper bound (next Monday 00:00)
  return { weekStart, weekEnd };
}

/** Returns the ISO week key string, e.g. "2025-W03", matching HomeScreen.js logic. */
function getCurrentWeekKey(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ── GET /api/stats/current-week-minutes ──────────────────────────────────────
// Returns the total minutes listened in the current ISO week.
// Primary source: listening_sessions aggregate.
// Fallback: ListeningHistory.estimatedMinutes for the current weekKey.
router.get('/current-week-minutes', authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const { weekStart, weekEnd } = getCurrentISOWeekRange();

    // Aggregate completed sessions for the current week
    const [result] = await ListeningSession.aggregate([
      {
        $match: {
          userId,
          startTime: { $gte: weekStart, $lt: weekEnd },
          durationSeconds: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          totalSeconds: { $sum: '$durationSeconds' },
        },
      },
    ]);

    if (result && result.totalSeconds > 0) {
      const totalMinutes = Math.round(result.totalSeconds / 60);
      return res.json({ totalMinutes, source: 'sessions' });
    }

    // Fallback: use estimatedMinutes stored in ListeningHistory
    const weekKey = getCurrentWeekKey();
    const history = await ListeningHistory.findOne({ userId, weekKey }).select('estimatedMinutes');
    const totalMinutes = history?.estimatedMinutes || 0;
    return res.json({ totalMinutes, source: 'estimated' });
  } catch (e) {
    console.error('current-week-minutes error:', e);
    res.status(500).json({ error: 'Failed to fetch current week minutes' });
  }
});

module.exports = router;
