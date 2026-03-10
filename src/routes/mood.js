const express = require('express');
const MoodLog = require('../models/MoodLog');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const getWeekKey = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
};

// POST /api/mood/:userId
router.post('/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { day, dayIndex, emoji, label, value, note, timestamp } = req.body;
    const weekKey = getWeekKey();

    const moodLog = await MoodLog.findOneAndUpdate(
      { userId, weekKey, day },
      { userId, weekKey, day, dayIndex, emoji, label, value, note, timestamp },
      { upsert: true, new: true }
    );

    res.json({ success: true, moodLog });
  } catch (e) {
    console.error('Save mood error:', e);
    res.status(500).json({ error: 'Failed to save mood' });
  }
});

// GET /api/mood/:userId/:weekKey
router.get('/:userId/:weekKey', authMiddleware, async (req, res) => {
  try {
    const { userId, weekKey } = req.params;
    const moods = await MoodLog.find({ userId, weekKey }).sort({ dayIndex: 1 });
    res.json(moods);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch moods' });
  }
});

module.exports = router;
