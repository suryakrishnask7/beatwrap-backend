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
  // ── VOID / DETACHED ───────────────────────────────
  { id: 1, name: 'Chithan', film: 'Pithamagan', archetype: 'The Void', traits: ['emotionless','isolated','primal'], music_vibe: 'Dark ambient, drone, empty soundscapes' },
  // ── POWER / LEGACY ────────────────────────────────
  { id: 2, name: 'Velu Nayakan', film: 'Nayakan', archetype: 'The Burdened Leader', traits: ['responsibility','legacy','moral weight'], music_vibe: 'Heavy orchestral, Ilaiyaraaja depth' },
  { id: 3, name: 'Kabali', film: 'Kabali', archetype: 'The King', traits: ['authority','calm power','presence'], music_vibe: 'Swagger beats, slow-walk energy' },
  { id: 4, name: 'Rolex', film: 'Vikram', archetype: 'The Apex Predator', traits: ['dominant','fearless','chaotic control'], music_vibe: 'Aggressive, maximal, high-intensity' },
  // ── ORDER VS CHAOS ────────────────────────────────
  { id: 5, name: 'Vikram', film: 'Vikram Vedha', archetype: 'The System', traits: ['disciplined','logical','controlled'], music_vibe: 'Structured beats, focused energy' },
  { id: 6, name: 'Vedha', film: 'Vikram Vedha', archetype: 'The Chaos Mind', traits: ['unpredictable','philosophical','grey'], music_vibe: 'Genre-chaotic playlists' },
  // ── LOVE / LONGING ────────────────────────────────
  { id: 7, name: 'Ram', film: '96', archetype: 'The Nostalgic Soul', traits: ['introverted','memory-driven','soft'], music_vibe: 'Ambient piano, late-night music' },
  { id: 8, name: 'Jaanu', film: '96', archetype: 'The Gentle Heart', traits: ['empathetic','warm','contained'], music_vibe: 'Soft acoustic, tender melodies' },
  { id: 9, name: 'Karthik_VTV', film: 'Vinnaithaandi Varuvaayaa', archetype: 'The Romantic Idealist', traits: ['passionate','dreamy','persistent'], music_vibe: 'AR Rahman romance' },
  { id: 10, name: 'Jessie', film: 'Vinnaithaandi Varuvaayaa', archetype: 'The Unreachable', traits: ['guarded','conflicted','distant'], music_vibe: 'Soft indie restraint' },
  { id: 11, name: 'Karthik_Alaipayuthey', film: 'Alaipayuthey', archetype: 'The Young Lover', traits: ['playful','intense','immature'], music_vibe: 'Upbeat love songs' },
  { id: 12, name: 'Swapna', film: 'Vallavan', archetype: 'The Illusion', traits: ['idealized','unreachable','fantasy-driven'], music_vibe: 'Dreamy love tracks, obsessive romance' },
  // ── OBSESSION / BREAKDOWN ─────────────────────────
  { id: 13, name: 'Vinod', film: 'Kadhal Kondein', archetype: 'The Obsessive', traits: ['fixated','unstable','intense'], music_vibe: 'Looped songs, emotional repetition' },
  { id: 14, name: 'Sethu', film: 'Sethu', archetype: 'The Broken Lover', traits: ['tragic','fragile','identity loss'], music_vibe: 'Pain-heavy melodies' },
  // ── RAW / ROOTED ──────────────────────────────────
  { id: 15, name: 'Paruthiveeran', film: 'Paruthiveeran', archetype: 'The Untamed', traits: ['wild','impulsive','earthy'], music_vibe: 'Raw folk, gaana' },
  { id: 16, name: 'Sivasami', film: 'Asuran', archetype: 'The Survivor', traits: ['protective','grounded','silent strength'], music_vibe: 'Slow folk builds' },
  { id: 17, name: 'Pariyerum Perumal', film: 'Pariyerum Perumal', archetype: 'The Silent Fighter', traits: ['resilient','observant','quiet pain'], music_vibe: 'Indie folk, rooted emotion' },
  // ── STREET / REAL ─────────────────────────────────
  { id: 18, name: 'Prabhu', film: 'Polladhavan', archetype: 'The Hustler', traits: ['street-smart','ambitious','grounded'], music_vibe: 'Gritty underground beats' },
  { id: 19, name: 'Azhagar', film: 'Subramaniapuram', archetype: 'The Loyal Friend', traits: ['loyal','emotional','tragic'], music_vibe: 'Retro Ilaiyaraaja nostalgia' },
  { id: 20, name: 'Anbu', film: 'Madras', archetype: 'The Voice', traits: ['political','grounded','community-driven'], music_vibe: 'Gaana + protest music' },
  // ── DISCIPLINE / STRUCTURE ────────────────────────
  { id: 21, name: 'Anbuselvan', film: 'Kaakha Kaakha', archetype: 'The Protector', traits: ['focused','disciplined','sacrificial'], music_vibe: 'Sharp action scores' },
  { id: 22, name: 'Prabhu', film: 'Irudhi Suttru', archetype: 'The Coach', traits: ['harsh','driven','results-first'], music_vibe: 'Training beats' },
  // ── HUMANISM ──────────────────────────────────────
  { id: 23, name: 'Nallasivam', film: 'Anbe Sivam', archetype: 'The Humanist', traits: ['empathetic','kind','philosophical'], music_vibe: 'Warm soulful music' },
  // ── IDENTITY / MODERN ─────────────────────────────
  { id: 24, name: 'Gandhi Mahaan', film: 'Mahaan', archetype: 'The Rebellion', traits: ['freedom-seeking','conflicted','evolving'], music_vibe: 'Genre-mixing chaos' },
  { id: 25, name: 'Amar', film: 'Vikram', archetype: 'The Seeker', traits: ['curious','driven','layered'], music_vibe: 'Electronic cinematic' },
  // ── CLASSIC EMOTION ───────────────────────────────
  { id: 26, name: 'Divya', film: 'Mouna Ragam', archetype: 'The Conflicted Soul', traits: ['independent','layered','introspective'], music_vibe: 'Bittersweet Ilaiyaraaja' },
  { id: 27, name: 'Rishi Kumar', film: 'Roja', archetype: 'The Devoted', traits: ['loyal','hopeful','loving'], music_vibe: 'Soft longing melodies' },
  { id: 28, name: 'Roja', film: 'Roja', archetype: 'The Waiting Heart', traits: ['patient','hopeful','strong'], music_vibe: 'Emotional strings' },
  // ── ICONIC ADDITIONS (NEW BANGERS) ────────────────
  { id: 29, name: 'Krishnan', film: 'Vaaranam Aayiram', archetype: 'The Explorer', traits: ['growth','emotional journey','self-discovery'], music_vibe: 'Travel + life-phase music' },
  { id: 30, name: 'Jordan', film: 'Sarpatta Parambarai', archetype: 'The Comeback', traits: ['rise','fall','redemption'], music_vibe: 'Motivation + comeback energy' },
  { id: 31, name: 'Arjun', film: '7G Rainbow Colony', archetype: 'The Reckless Lover', traits: ['immature','obsessive','emotional'], music_vibe: 'Youth heartbreak + chaos' },
  { id: 32, name: 'Kitta', film: 'Bison', archetype: 'The Minimalist', traits: ['quiet','detached','observant'], music_vibe: 'Lo-fi, minimal, low-energy music' },
  { id: 33, name: 'Guru', film: 'Guru', archetype: 'The Visionary', traits: ['ambitious','risk-taking','driven'], music_vibe: 'Big build, inspirational' },
  { id: 34, name: 'Surya', film: 'Vaaranam Aayiram', archetype: 'The Son', traits: ['emotional','respect-driven','growth'], music_vibe: 'Emotional journey tracks' },
  { id: 35, name: 'Sakthi', film: 'Sivaji', archetype: 'The Game Changer', traits: ['bold','visionary','impact-driven'], music_vibe: 'Mass + grand energy' },
  { id: 36, name: 'Michael', film: 'Bigil', archetype: 'The Leader', traits: ['mentor','strong','responsible'], music_vibe: 'Motivational + team energy' },
  { id: 37, name: 'Raghuvaran', film: 'VIP', archetype: 'The Underdog', traits: ['frustrated','talented','rising'], music_vibe: 'Angry youth + ambition' },
  { id: 38, name: 'Deepak', film: 'Dhruvangal Pathinaaru', archetype: 'The Analyst', traits: ['observant','calm','intellectual'], music_vibe: 'Minimal thriller, ambient tension' },
];

const CHARACTER_LIST = TAMIL_CHARACTERS.map(c => `${c.id}. ${c.name} (${c.film})\n   Music this character represents: ${c.music_vibe}`).join('\n\n');

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