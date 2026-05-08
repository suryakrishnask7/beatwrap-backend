const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const WeeklyWrap = require('../models/WeeklyWrap');
const ListeningHistory = require('../models/ListeningHistory');
const ListeningSession = require('../models/ListeningSession');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// ── Shared helper — matches the ISO week key format used in HomeScreen.js ─────
function getCurrentWeekKey(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** Returns the weekKey for N weeks ago. */
function getWeekKey(weeksAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - weeksAgo * 7);
  return getCurrentWeekKey(d);
}

const GROQ_API_KEY = process.env.GROQ_API_KEY;



// GET /api/wrap/current
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

// POST /api/wrap/save
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { weekKey, aiWrap, stats } = req.body;
    if (!weekKey || !aiWrap) {
      return res.status(400).json({ error: 'weekKey and aiWrap required' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);

    const existing = await WeeklyWrap.findOne({ userId, weekKey });
    if (existing) {
      return res.json({ saved: false, wrap: existing.aiWrap, stats: existing.stats, message: 'Already locked for this week' });
    }

    const newWrap = await WeeklyWrap.create({ userId, weekKey, aiWrap, stats });
    res.json({ saved: true, wrap: newWrap.aiWrap, stats: newWrap.stats });
  } catch (e) {
    if (e.code === 11000) {
      const existing = await WeeklyWrap.findOne({
        userId: new mongoose.Types.ObjectId(req.user.id),
        weekKey: req.body.weekKey,
      });
      return res.json({ saved: false, wrap: existing?.aiWrap, stats: existing?.stats, message: 'Already locked for this week' });
    }
    res.status(500).json({ error: 'Failed to save wrap' });
  }
});

// GET /api/wrap/history
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

// POST /api/wrap/regenerate-wrap
// Receives full wrap from frontend. 24h cooldown enforced.
// Updates Atlas so friends see the refreshed wrap too.
router.post('/regenerate-wrap', authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const { weekKey, aiWrap } = req.body;
    if (!weekKey || !aiWrap) return res.status(400).json({ error: 'weekKey and aiWrap required' });

    // 24h cooldown check
    const user = await User.findById(userId).select('lastCharacterRegenAt');
    if (user.lastCharacterRegenAt) {
      const msSinceLast = Date.now() - new Date(user.lastCharacterRegenAt).getTime();
      const msIn24h = 24 * 60 * 60 * 1000;
      if (msSinceLast < msIn24h) {
        const hoursLeft = Math.ceil((msIn24h - msSinceLast) / (60 * 60 * 1000));
        return res.status(429).json({
          error: 'cooldown',
          message: `You can regenerate your wrap once per day. Try again in ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}.`,
          hoursLeft,
        });
      }
    }

    const currentWrap = await WeeklyWrap.findOne({ userId, weekKey });
    if (!currentWrap) {
      return res.status(404).json({ error: 'No wrap found for this week. Generate your wrap first.' });
    }

    // Update Atlas
    await WeeklyWrap.findOneAndUpdate({ userId, weekKey }, { aiWrap }, { new: true });

    // Update cooldown timestamp
    await User.findByIdAndUpdate(userId, { lastCharacterRegenAt: new Date() });

    console.log(`Wrap regenerated for user ${req.user.id}`);

    res.json({ success: true, wrap: aiWrap });
  } catch (e) {
    console.error('Regenerate wrap error:', e);
    res.status(500).json({ error: 'Failed to regenerate wrap' });
  }
});


// ── POST /api/wrap/generate ──────────────────────────────────────────────────
// Triggered manually by the frontend when the user wants to generate their wrap.
// Accepts: { totalMinutes, topArtists: [String], topTracks: [String] }
// Stores into weekly_wraps with one-per-week enforcement.
// Returns: { saved: true, data } on first create, or { saved: false, data } if already exists.
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { totalMinutes, topArtists, topTracks } = req.body;

    if (totalMinutes == null) {
      return res.status(400).json({ error: 'totalMinutes is required' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const weekKey = getCurrentWeekKey();
    const now = new Date();

    // Compute weekStart (Monday) and weekEnd (Sunday) for this ISO week
    const weekStartDate = new Date(now);
    weekStartDate.setHours(0, 0, 0, 0);
    const day = weekStartDate.getDay() || 7;
    weekStartDate.setDate(weekStartDate.getDate() - day + 1);
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekEndDate.getDate() + 6);
    weekEndDate.setHours(23, 59, 59, 999);

    // Build the minimal wrap payload — frontend provides the stats
    const wrapPayload = {
      totalMinutes: Number(totalMinutes) || 0,
      topArtists: Array.isArray(topArtists) ? topArtists : [],
      topTracks:  Array.isArray(topTracks)  ? topTracks  : [],
      weekStart:  weekStartDate,
      weekEnd:    weekEndDate,
    };

    // One wrap per week — reject duplicates (return existing data)
    const existing = await WeeklyWrap.findOne({ userId, weekKey });
    if (existing) {
      return res.json({
        saved: false,
        message: 'Wrap already exists for this week',
        data: existing.aiWrap || wrapPayload,
        stats: existing.stats,
        weekKey,
      });
    }

    const newWrap = await WeeklyWrap.create({
      userId,
      weekKey,
      aiWrap: wrapPayload,   // store under aiWrap so the rest of the app can read it
      stats:  { totalMinutes: wrapPayload.totalMinutes, topArtists, topTracks },
      lockedAt: now,
    });

    console.log(`[WrapGenerate] userId=${req.user.id} weekKey=${weekKey} totalMinutes=${totalMinutes}`);

    res.status(201).json({
      saved: true,
      data: newWrap.aiWrap,
      stats: newWrap.stats,
      weekKey,
    });
  } catch (e) {
    if (e.code === 11000) {
      // Race-condition duplicate — return existing
      const existing = await WeeklyWrap.findOne({
        userId: new mongoose.Types.ObjectId(req.user.id),
        weekKey: getCurrentWeekKey(),
      });
      return res.json({
        saved: false,
        message: 'Wrap already exists for this week',
        data: existing?.aiWrap || {},
        stats: existing?.stats || {},
        weekKey: getCurrentWeekKey(),
      });
    }
    console.error('Wrap generate error:', e);
    res.status(500).json({ error: 'Failed to generate wrap' });
  }
});

// ── GET /api/wrap/friend/:friendId ───────────────────────────────────────────
// Returns whether a friend has generated a wrap for the CURRENT ISO week.
// Response: { hasWrap: false } OR { hasWrap: true, data: {...wrapData} }
router.get('/friend/:friendId', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(friendId)) {
      return res.status(400).json({ error: 'Invalid friendId' });
    }

    const weekKey = getCurrentWeekKey();
    const wrap = await WeeklyWrap.findOne({
      userId: new mongoose.Types.ObjectId(friendId),
      weekKey,
    });

    if (!wrap) {
      return res.json({ hasWrap: false });
    }

    res.json({
      hasWrap: true,
      data: {
        weekKey: wrap.weekKey,
        aiWrap: wrap.aiWrap,
        stats:  wrap.stats,
        createdAt: wrap.createdAt,
      },
    });
  } catch (e) {
    console.error('Friend wrap error:', e);
    res.status(500).json({ error: 'Failed to fetch friend wrap' });
  }
});

// ── GET /api/wrap/compare ─────────────────────────────────────────────────────
// Compares the user's current-week listening minutes (live) against last week's stored wrap.
// Returns: { currentMinutes, lastMinutes, percentageChange }
router.get('/compare', authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const thisWeekKey = getCurrentWeekKey();
    const lastWeekKey = getWeekKey(1);

    // ── Current week: fetch from ListeningHistory ──
    const history = await ListeningHistory.findOne({ userId, weekKey: thisWeekKey }).select('estimatedMinutes');
    const currentMinutes = history?.estimatedMinutes ? Math.round(history.estimatedMinutes) : 0;

    // ── Last week: fetch from weekly_wraps ────────────────────────────────────
    const lastWrap = await WeeklyWrap.findOne({ userId, weekKey: lastWeekKey });
    const lastMinutes = lastWrap?.stats?.totalMinutes || lastWrap?.stats?.estimatedMinutes || 0;

    // ── Percentage change ─────────────────────────────────────────────────────
    let percentageChange = 0;
    if (lastMinutes > 0) {
      percentageChange = Math.round(((currentMinutes - lastMinutes) / lastMinutes) * 100);
    } else if (currentMinutes > 0) {
      percentageChange = 100; // first week with data
    }

    res.json({ currentMinutes, lastMinutes, percentageChange });
  } catch (e) {
    console.error('Wrap compare error:', e);
    res.status(500).json({ error: 'Failed to compare wraps' });
  }
});

module.exports = router;