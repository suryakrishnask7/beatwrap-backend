const express = require('express');
const WeeklyWrap = require('../models/WeeklyWrap');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// GET current week key
const getWeekKey = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
};

// POST /api/wrap/save
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { stats, aiWrap, topTracks, topArtists, moodLogs } = req.body;
    const weekKey = getWeekKey();
    const userId = req.user.id;

    const wrap = await WeeklyWrap.findOneAndUpdate(
      { userId, weekKey },
      {
        userId,
        weekKey,
        stats,
        aiWrap,
        topTracks: topTracks?.slice(0, 20) || [],
        topArtists: topArtists?.slice(0, 20) || [],
        moodLogs: moodLogs || [],
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, wrap });
  } catch (e) {
    console.error('Save wrap error:', e);
    res.status(500).json({ error: 'Failed to save wrap' });
  }
});

// GET /api/wrap/:userId/:weekKey
router.get('/:userId/:weekKey', authMiddleware, async (req, res) => {
  try {
    const { userId, weekKey } = req.params;
    const wrap = await WeeklyWrap.findOne({ userId, weekKey });
    if (!wrap) return res.status(404).json({ error: 'Wrap not found' });
    res.json(wrap);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch wrap' });
  }
});

// GET /api/wrap/:userId/history
router.get('/:userId/history', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const wraps = await WeeklyWrap.find({ userId })
      .sort({ createdAt: -1 })
      .limit(12)
      .select('weekKey aiWrap stats createdAt');
    res.json(wraps);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
