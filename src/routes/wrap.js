const express = require('express');
const mongoose = require('mongoose');
const WeeklyWrap = require('../models/WeeklyWrap');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// GET /api/wrap/current — get this week's wrap from Atlas
router.get('/current', authMiddleware, async (req, res) => {
  try {
    const { weekKey } = req.query;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const wrap = await WeeklyWrap.findOne({ userId, weekKey });

    if (wrap) {
      return res.json({ found: true, wrap: wrap.aiWrap, stats: wrap.stats, weekKey });
    }
    res.json({ found: false });
  } catch (e) {
    console.error('Get wrap error:', e);
    res.status(500).json({ error: 'Failed to fetch wrap' });
  }
});

// POST /api/wrap/save — save this week's wrap (only if not already saved — locked)
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { weekKey, aiWrap, stats } = req.body;
    if (!weekKey || !aiWrap) {
      return res.status(400).json({ error: 'weekKey and aiWrap required' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);

    // Check if already locked for this week
    const existing = await WeeklyWrap.findOne({ userId, weekKey });
    if (existing) {
      console.log(`Wrap already locked for user ${req.user.id} week ${weekKey}`);
      return res.json({
        saved: false,
        wrap: existing.aiWrap,
        stats: existing.stats,
        message: 'Already locked for this week',
      });
    }

    const newWrap = await WeeklyWrap.create({ userId, weekKey, aiWrap, stats });
    console.log(`Wrap saved for user ${req.user.id} week ${weekKey}`);
    res.json({ saved: true, wrap: newWrap.aiWrap, stats: newWrap.stats });
  } catch (e) {
    console.error('Save wrap error:', e.message, e.code);
    // Handle duplicate key (race condition — two saves at same time)
    if (e.code === 11000) {
      const existing = await WeeklyWrap.findOne({
        userId: new mongoose.Types.ObjectId(req.user.id),
        weekKey: req.body.weekKey,
      });
      return res.json({
        saved: false,
        wrap: existing?.aiWrap,
        stats: existing?.stats,
        message: 'Already locked for this week',
      });
    }
    res.status(500).json({ error: 'Failed to save wrap' });
  }
});

// GET /api/wrap/history — all past wraps except current week
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { currentWeekKey } = req.query;
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const wraps = await WeeklyWrap.find({
      userId,
      ...(currentWeekKey ? { weekKey: { $ne: currentWeekKey } } : {}),
    }).sort({ createdAt: -1 }).limit(20);
    res.json({ wraps });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;