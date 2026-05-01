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

const TAMIL_CHARACTERS = [
  { name: 'Chithan', film: 'Pithamagan', vibe: 'Dark ambient, sparse instrumentals, drone loops, silence as sound.' },
  { name: 'Velu Nayakan', film: 'Nayakan', vibe: 'Slow orchestral builds, Ilaiyaraaja emotional swells, weight of a whole life.' },
  { name: 'Vikram', film: 'Vikram Vedha', vibe: 'Driving rock, sharp action scores, music that sounds like running with purpose.' },
  { name: 'Vedha', film: 'Vikram Vedha', vibe: 'Unpredictable playlist — hip-hop then classical then folk. All instinct.' },
  { name: 'Ram', film: '96', vibe: 'Ambient piano, soft indie, music for quiet nights full of longing.' },
  { name: 'Jaanu', film: '96', vibe: 'Soft acoustic songs, tender melodies, quietly heartbroken beauty.' },
  { name: 'Paruthiveeran', film: 'Paruthiveeran', vibe: 'Raw village folk, nadaswaram, music that smells like red soil.' },
  { name: 'Azhagar', film: 'Subramaniapuram', vibe: '90s Tamil OSTs, slow ballads, music that feels like a memory.' },
  { name: 'Karthik', film: 'Vinnaithaandi Varuvaayaa', vibe: 'AR Rahman romantic, lush guitar, falling in love slowly.' },
  { name: 'Jessie', film: 'Vinnaithaandi Varuvaayaa', vibe: 'Soft indie pop, acoustic restraint, standing at a door you cannot open.' },
  { name: 'Anbuselvan', film: 'Kaakha Kaakha', vibe: 'AR Rahman action, driving rock, committed and forward-moving.' },
  { name: 'Vinod', film: 'Kadhal Kondein', vibe: 'One artist on repeat, obsessive deep dives, same 3 songs again and again.' },
  { name: 'Sivasami', film: 'Asuran', vibe: 'Slow folk builds, GV Prakash rawness, music rooted in survival.' },
  { name: 'Amar', film: 'Vikram', vibe: 'Layered electronic scores, dark orchestral, Anirudh tension.' },
  { name: 'Rolex', film: 'Vikram', vibe: 'Maximalist playlists, too many genres, everything turned up.' },
  { name: 'Gandhi Mahaan', film: 'Mahaan', vibe: 'Genre-blending, classical then trap, cannot be pinned down.' },
  { name: 'Rishi Kumar', film: 'Roja', vibe: 'Soft AR Rahman, longing instrumentals, missing someone far away.' },
  { name: 'Roja', film: 'Roja', vibe: 'Waiting melodies, slow violin, hope held very carefully.' },
  { name: 'Karthik_Alaipayuthey', film: 'Alaipayuthey', vibe: 'Youthful AR Rahman, upbeat Tamil pop, first week of being in love.' },
  { name: 'Nallasivam', film: 'Anbe Sivam', vibe: 'Warm humanist folk, beauty in ordinary moments, arm around your shoulder.' },
  { name: 'Prabhu', film: 'Polladhavan', vibe: 'Street energy, gritty Tamil beats, garage midnight underground.' },
  { name: 'Divya', film: 'Mouna Ragam', vibe: 'Layered emotional Ilaiyaraaja, refuses to be simple, bittersweet.' },
  { name: 'Pariyerum Perumal', film: 'Pariyerum Perumal', vibe: 'Indie Tamil folk, Santhosh Narayanan rawness, quiet pain.' },
  { name: 'Kabali', film: 'Kabali', vibe: 'Santhosh Narayanan swagger, slow-walk BGMs, arriving somewhere important.' },
  { name: 'Prabhu_IS', film: 'Irudhi Suttru', vibe: 'Driven beats, focused energy, no time for sentimentality.' },
  { name: 'Deepak', film: 'Dhruvangal Pathinaaru', vibe: 'Minimal thriller scores, silence as music, never quite resolves.' },
  { name: 'Jordan', film: 'Sarpatta Parambarai', vibe: 'Rise, fall, redemption — motivation and comeback energy.' },
  { name: 'Arjun', film: '7G Rainbow Colony', vibe: 'Youth heartbreak, obsessive love songs, emotional chaos.' },
  { name: 'Sethu', film: 'Sethu', vibe: 'Pain-heavy melodies, tragic ballads, identity lost to love.' },
];

const CHARACTER_LIST = TAMIL_CHARACTERS.map(c => `${c.name} (${c.film}) — ${c.vibe}`).join('\n');

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
// Regenerates the FULL wrap (story + vibe + character). 24h cooldown enforced.
// Updates Atlas so friends see the refreshed wrap too.
router.post('/regenerate-wrap', authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const { weekKey } = req.body;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

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

    // Get current wrap for stats
    const currentWrap = await WeeklyWrap.findOne({ userId, weekKey });
    if (!currentWrap?.stats) {
      return res.status(404).json({ error: 'No wrap found for this week. Generate your wrap first.' });
    }

    const { topGenres, topArtists, topTracks } = currentWrap.stats;

    const prompt = `You are BeatWrap AI. Regenerate a completely fresh weekly music wrap for this user.

Top Genres: ${topGenres?.map(g => g.genre).join(', ') || 'Mixed'}
Top Artists: ${topArtists?.slice(0, 8).map(a => a.name).join(', ') || 'Various'}
Top Tracks: ${topTracks?.slice(0, 8).map(t => `${t.name} by ${t.artists?.[0]?.name}`).join(', ') || 'Various'}

Previous wrap this week: character was "${currentWrap.aiWrap?.tamil_character?.name || 'none'}", label was "${currentWrap.aiWrap?.week_label || ''}".
You MUST pick a different character and write a completely new story. Different vibe angle, different scenes, fresh perspective.

Available characters:
${CHARACTER_LIST}

Write a 120-160 word cinematic story. No psychological analysis. Keep it smooth and aesthetic.

Return ONLY valid JSON — no extra text:
{
  "week_label": "...",
  "dominant_vibe": "...",
  "energy_level": "...",
  "tamil_protagonist": { "archetype": "...", "inspired_by": "..." },
  "tamil_character": { "name": "...", "film": "...", "why_this_character": "..." },
  "story": "...",
  "confidence": 0.0
}`;

    let newWrapData;
    try {
      const groqRes = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 700,
          temperature: 0.9,
        },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
      );
      const content = groqRes.data.choices[0].message.content.replace(/```json|```/g, '').trim();
      newWrapData = JSON.parse(content);
    } catch (groqErr) {
      console.error('Groq regen error:', groqErr?.response?.data || groqErr.message);
      const others = TAMIL_CHARACTERS.filter(c => c.name !== currentWrap.aiWrap?.tamil_character?.name);
      const fallback = others[Math.floor(Math.random() * others.length)];
      newWrapData = {
        ...currentWrap.aiWrap,
        week_label: currentWrap.aiWrap?.week_label + ' (Remix)',
        tamil_character: {
          name: fallback.name,
          film: fallback.film,
          why_this_character: `Seen through a different lens, this week echoes the world of ${fallback.name}.`,
        },
        tamil_protagonist: { archetype: 'The Unexpected', inspired_by: fallback.film },
      };
    }

    // Validate character
    const valid = TAMIL_CHARACTERS.find(c =>
      c.name.toLowerCase() === newWrapData.tamil_character?.name?.toLowerCase()
    );
    if (!valid && newWrapData.tamil_character) {
      const fallback = TAMIL_CHARACTERS[Math.floor(Math.random() * TAMIL_CHARACTERS.length)];
      newWrapData.tamil_character.name = fallback.name;
      newWrapData.tamil_character.film = fallback.film;
    }

    // Update Atlas
    await WeeklyWrap.findOneAndUpdate({ userId, weekKey }, { aiWrap: newWrapData }, { new: true });

    // Update cooldown timestamp
    await User.findByIdAndUpdate(userId, { lastCharacterRegenAt: new Date() });

    console.log(`Wrap regenerated for user ${req.user.id}: ${newWrapData.tamil_character?.name}`);

    res.json({ success: true, wrap: newWrapData });
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

    // ── Current week: aggregate from sessions first, fall back to ListeningHistory ──
    let currentMinutes = 0;

    // ISO week range for session query
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCHours(0, 0, 0, 0);
    const dow = weekStart.getUTCDay() || 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - dow + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const [sessionResult] = await ListeningSession.aggregate([
      {
        $match: {
          userId,
          startTime: { $gte: weekStart, $lt: weekEnd },
          durationSeconds: { $gt: 0 },
        },
      },
      { $group: { _id: null, totalSeconds: { $sum: '$durationSeconds' } } },
    ]);

    if (sessionResult?.totalSeconds > 0) {
      currentMinutes = Math.round(sessionResult.totalSeconds / 60);
    } else {
      // Fall back to ListeningHistory.estimatedMinutes
      const history = await ListeningHistory.findOne({ userId, weekKey: thisWeekKey }).select('estimatedMinutes');
      currentMinutes = history?.estimatedMinutes || 0;
    }

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