const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const WeeklyWrap = require('../models/WeeklyWrap');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ── Tamil characters list for character-only regeneration ─────────────────────
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
  { name: 'Karthik', film: 'Alaipayuthey', vibe: 'Youthful AR Rahman, upbeat Tamil pop, first week of being in love.' },
  { name: 'Nallasivam', film: 'Anbe Sivam', vibe: 'Warm humanist folk, beauty in ordinary moments, arm around your shoulder.' },
  { name: 'Prabhu', film: 'Polladhavan', vibe: 'Street energy, gritty Tamil beats, garage midnight underground.' },
  { name: 'Divya', film: 'Mouna Ragam', vibe: 'Layered emotional Ilaiyaraaja, refuses to be simple, bittersweet.' },
  { name: 'Pariyerum Perumal', film: 'Pariyerum Perumal', vibe: 'Indie Tamil folk, Santhosh Narayanan rawness, quiet pain.' },
  { name: 'Kabali', film: 'Kabali', vibe: 'Santhosh Narayanan swagger, slow-walk BGMs, arriving somewhere important.' },
  { name: 'Prabhu', film: 'Irudhi Suttru', vibe: 'Driven beats, focused energy, no time for sentimentality.' },
  { name: 'Deepak', film: 'Dhruvangal Pathinaaru', vibe: 'Minimal thriller scores, silence as music, never quite resolves.' },
  { name: 'Jordan', film: 'Sarpatta Parambarai', vibe: 'Rise, fall, redemption — motivation and comeback energy.' },
  { name: 'Pariyerum Perumal', film: 'Pariyerum Perumal', vibe: 'Indie folk, rooted emotion, quiet resilience.' },
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
      console.log(`Wrap already locked for user ${req.user.id} week ${weekKey}`);
      return res.json({ saved: false, wrap: existing.aiWrap, stats: existing.stats, message: 'Already locked for this week' });
    }

    const newWrap = await WeeklyWrap.create({ userId, weekKey, aiWrap, stats });
    console.log(`Wrap saved for user ${req.user.id} week ${weekKey}`);
    res.json({ saved: true, wrap: newWrap.aiWrap, stats: newWrap.stats });
  } catch (e) {
    console.error('Save wrap error:', e.message, e.code);
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

// ── NEW: POST /api/wrap/regenerate-character ──────────────────────────────────
// Enforces once-per-24h limit on the backend. Generates a new character using
// the user's actual listening stats from their current wrap, then updates the
// stored wrap in Atlas so friends also see the updated character.
router.post('/regenerate-character', authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const { weekKey } = req.body;
    if (!weekKey) return res.status(400).json({ error: 'weekKey required' });

    // ── 24h cooldown check ────────────────────────────────────────────────────
    const user = await User.findById(userId).select('lastCharacterRegenAt');
    if (user.lastCharacterRegenAt) {
      const msSinceLast = Date.now() - new Date(user.lastCharacterRegenAt).getTime();
      const msIn24h = 24 * 60 * 60 * 1000;
      if (msSinceLast < msIn24h) {
        const msRemaining = msIn24h - msSinceLast;
        const hoursLeft = Math.ceil(msRemaining / (60 * 60 * 1000));
        return res.status(429).json({
          error: 'cooldown',
          message: `You can regenerate your character once per day. Try again in ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}.`,
          hoursLeft,
        });
      }
    }

    // ── Get user's current wrap for their listening stats ─────────────────────
    const currentWrap = await WeeklyWrap.findOne({ userId, weekKey });
    if (!currentWrap || !currentWrap.stats) {
      return res.status(404).json({ error: 'No wrap found for this week. Generate your wrap first.' });
    }

    const { topGenres, topArtists, topTracks } = currentWrap.stats;

    // ── Ask Groq for a new character only ─────────────────────────────────────
    const prompt = `You are BeatWrap AI. Based on this user's music listening data, assign them a new Tamil cinema character.

Top Genres: ${topGenres?.map(g => g.genre).join(', ') || 'Mixed'}
Top Artists: ${topArtists?.slice(0, 6).map(a => a.name).join(', ') || 'Various'}
Top Tracks: ${topTracks?.slice(0, 6).map(t => `${t.name} by ${t.artists?.[0]?.name}`).join(', ') || 'Various'}

Previous character this week: ${currentWrap.aiWrap?.tamil_character?.name || 'none'} — pick a DIFFERENT character this time.

Choose from this list:
${CHARACTER_LIST}

Return ONLY valid JSON — no extra text:
{
  "name": "...",
  "film": "...",
  "why_this_character": "One sharp sentence explaining the match.",
  "archetype": "...",
  "inspired_by": "..."
}`;

    let newCharacter;
    try {
      const groqRes = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.9,
        },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
      );
      const content = groqRes.data.choices[0].message.content.replace(/```json|```/g, '').trim();
      newCharacter = JSON.parse(content);
    } catch (groqErr) {
      console.error('Groq regen error:', groqErr?.response?.data || groqErr.message);
      // Fallback: pick a random different character
      const others = TAMIL_CHARACTERS.filter(c => c.name !== currentWrap.aiWrap?.tamil_character?.name);
      const fallback = others[Math.floor(Math.random() * others.length)];
      newCharacter = {
        name: fallback.name,
        film: fallback.film,
        why_this_character: `The energy this week resonates with the world of ${fallback.name}.`,
        archetype: 'The Unexpected',
        inspired_by: fallback.film,
      };
    }

    // ── Validate character is on the list ─────────────────────────────────────
    const valid = TAMIL_CHARACTERS.find(c => c.name.toLowerCase() === newCharacter.name?.toLowerCase());
    if (!valid) {
      const fallback = TAMIL_CHARACTERS[Math.floor(Math.random() * TAMIL_CHARACTERS.length)];
      newCharacter.name = fallback.name;
      newCharacter.film = fallback.film;
    }

    // ── Update the wrap in Atlas with new character ───────────────────────────
    const updatedAiWrap = {
      ...currentWrap.aiWrap,
      tamil_character: {
        name: newCharacter.name,
        film: newCharacter.film,
        why_this_character: newCharacter.why_this_character,
      },
      tamil_protagonist: {
        archetype: newCharacter.archetype || currentWrap.aiWrap?.tamil_protagonist?.archetype,
        inspired_by: newCharacter.inspired_by || newCharacter.film,
      },
    };

    await WeeklyWrap.findOneAndUpdate(
      { userId, weekKey },
      { aiWrap: updatedAiWrap },
      { new: true }
    );

    // ── Update user's lastCharacterRegenAt timestamp ──────────────────────────
    await User.findByIdAndUpdate(userId, { lastCharacterRegenAt: new Date() });

    console.log(`Character regenerated for user ${req.user.id}: ${newCharacter.name} (${newCharacter.film})`);

    res.json({
      success: true,
      tamil_character: {
        name: newCharacter.name,
        film: newCharacter.film,
        why_this_character: newCharacter.why_this_character,
      },
      tamil_protagonist: {
        archetype: newCharacter.archetype,
        inspired_by: newCharacter.inspired_by || newCharacter.film,
      },
    });
  } catch (e) {
    console.error('Regenerate character error:', e);
    res.status(500).json({ error: 'Failed to regenerate character' });
  }
});

module.exports = router;