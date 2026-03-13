const express = require('express');
const MoodLog = require('../models/MoodLog');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// POST /api/mood/save — save a single day's mood
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { weekKey, dayIndex, day, emoji, label, value, note } = req.body;
    if (weekKey === undefined || dayIndex === undefined) {
      return res.status(400).json({ error: 'weekKey and dayIndex required' });
    }

    // Upsert — update if exists, create if not
    const log = await MoodLog.findOneAndUpdate(
      { userId: req.user.id, weekKey, dayIndex },
      { emoji, label, value, note: note || '', day, loggedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({ success: true, log });
  } catch (e) {
    console.error('Mood save error:', e);
    res.status(500).json({ error: 'Failed to save mood' });
  }
});

// GET /api/mood/week?weekKey= — get all moods for a week
router.get('/week', authMiddleware, async (req, res) => {
  try {
    const { weekKey } = req.query;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

    const logs = await MoodLog.find({ userId: req.user.id, weekKey });
    // Return as object keyed by dayIndex for easy lookup
    const byDay = {};
    logs.forEach(l => {
      byDay[l.dayIndex] = { emoji: l.emoji, label: l.label, value: l.value, note: l.note, day: l.day, timestamp: l.loggedAt?.getTime() };
    });

    res.json({ moods: byDay });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch moods' });
  }
});

module.exports = router;