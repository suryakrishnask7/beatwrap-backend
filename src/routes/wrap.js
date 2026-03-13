const express = require('express');
const WeeklyWrap = require('../models/WeeklyWrap');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// GET /api/wrap/current — get this week's wrap from Atlas
// If it exists, return it (locked — never regenerate same week)
router.get('/current', authMiddleware, async (req, res) => {
  try {
    const { weekKey } = req.query;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

    const wrap = await WeeklyWrap.findOne({ userId: req.user.id, weekKey });
    if (wrap) {
      return res.json({ found: true, wrap: wrap.aiWrap, stats: wrap.stats, weekKey });
    }
    res.json({ found: false });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch wrap' });
  }
});

// POST /api/wrap/save — save this week's wrap to Atlas (only if not already saved)
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { weekKey, aiWrap, stats } = req.body;
    if (!weekKey || !aiWrap) return res.status(400).json({ error: 'weekKey and aiWrap required' });

    // upsert=false — never overwrite an existing wrap for same week
    // This is the lock: once saved, the character and wrap never change
    const existing = await WeeklyWrap.findOne({ userId: req.user.id, weekKey });
    if (existing) {
      // Already locked — return the existing one, ignore the new data
      return res.json({ saved: false, wrap: existing.aiWrap, stats: existing.stats, message: 'Already locked for this week' });
    }

    const newWrap = await WeeklyWrap.create({
      userId: req.user.id,
      weekKey,
      aiWrap,
      stats,
    });

    res.json({ saved: true, wrap: newWrap.aiWrap, stats: newWrap.stats });
  } catch (e) {
    console.error('Save wrap error:', e);
    res.status(500).json({ error: 'Failed to save wrap' });
  }
});

// GET /api/wrap/history — all past wraps except current week
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { currentWeekKey } = req.query;
    const wraps = await WeeklyWrap.find({
      userId: req.user.id,
      ...(currentWeekKey ? { weekKey: { $ne: currentWeekKey } } : {}),
    }).sort({ createdAt: -1 }).limit(20);

    res.json({ wraps });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;