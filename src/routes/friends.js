const express = require('express');
const User = require('../models/User');
const WeeklyWrap = require('../models/WeeklyWrap');
const authMiddleware = require('../middleware/auth');
const axios = require('axios');
const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// GET /api/friends/search
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);

    const users = await User.find({
      displayName: { $regex: q, $options: 'i' },
      _id: { $ne: req.user.id },
    }).select('displayName profileImage').limit(10);

    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/friends/request/email — add by email address
router.post('/request/email', authMiddleware, async (req, res) => {
  try {
    const { fromId, email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const toUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (!toUser) return res.status(404).json({ error: 'User not found' });
    if (toUser._id.toString() === fromId) return res.status(400).json({ error: 'Cannot add yourself' });

    // Check if already friends
    if (toUser.friends?.includes(fromId)) return res.status(400).json({ error: 'Already friends' });

    // Check if request already exists
    const already = toUser.friendRequests?.find(r => r.from.toString() === fromId && r.status === 'pending');
    if (already) return res.status(400).json({ error: 'Request already sent' });

    toUser.friendRequests = toUser.friendRequests || [];
    toUser.friendRequests.push({ from: fromId, status: 'pending' });
    await toUser.save();

    res.json({ success: true, toName: toUser.displayName });
  } catch (e) {
    console.error('Friend request by email error:', e);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// GET /api/friends/requests/pending/:userId
router.get('/requests/pending/:userId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('friendRequests.from', 'displayName email profileImage');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const pending = (user.friendRequests || []).filter(r => r.status === 'pending');
    res.json({ requests: pending });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// POST /api/friends/request
router.post('/request', authMiddleware, async (req, res) => {
  try {
    const { fromId, toId } = req.body;

    const toUser = await User.findById(toId);
    if (!toUser) return res.status(404).json({ error: 'User not found' });

    const existing = toUser.friendRequests.find(r => r.from.toString() === fromId);
    if (existing) return res.status(400).json({ error: 'Request already sent' });

    toUser.friendRequests.push({ from: fromId, status: 'pending' });
    await toUser.save();

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// PUT /api/friends/request/:requestId/accept
router.put('/request/:requestId/accept', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const request = user.friendRequests.id(req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    request.status = 'accepted';
    user.friends.addToSet(request.from);
    await user.save();

    // Add reverse friendship
    await User.findByIdAndUpdate(request.from, {
      $addToSet: { friends: req.user.id },
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to accept request' });
  }
});

// GET /api/friends/:userId
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).populate('friends', 'displayName profileImage');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.friends);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// GET /api/friends/compatibility/:userId/:friendId
router.get('/compatibility/:userId/:friendId', authMiddleware, async (req, res) => {
  try {
    const { userId, friendId } = req.params;

    // Get latest wraps for both users
    const [userWrap, friendWrap] = await Promise.all([
      WeeklyWrap.findOne({ userId }).sort({ createdAt: -1 }),
      WeeklyWrap.findOne({ userId: friendId }).sort({ createdAt: -1 }),
    ]);

    if (!userWrap || !friendWrap) {
      return res.json({
        score: 50,
        vibe_description: 'Not enough data yet — listen more and check back!',
        shared_traits: [],
        chemistry: 'Still discovering.',
      });
    }

    const u1 = {
      topGenres: userWrap.stats?.topGenres?.map(g => g.genre) || [],
      explorationIndex: userWrap.stats?.explorationIndex || 50,
      tamilCharacter: userWrap.aiWrap?.tamil_character?.name || 'Unknown',
    };

    const u2 = {
      topGenres: friendWrap.stats?.topGenres?.map(g => g.genre) || [],
      explorationIndex: friendWrap.stats?.explorationIndex || 50,
      tamilCharacter: friendWrap.aiWrap?.tamil_character?.name || 'Unknown',
    };

    // Calculate genre overlap
    const u1Genres = new Set(u1.topGenres);
    const overlap = u2.topGenres.filter(g => u1Genres.has(g)).length;
    const genreScore = Math.round((overlap / Math.max(u1.topGenres.length, 1)) * 40);
    const explorationDiff = Math.abs(u1.explorationIndex - u2.explorationIndex);
    const explorationScore = Math.round(Math.max(0, 30 - explorationDiff / 2));
    const baseScore = genreScore + explorationScore + Math.floor(Math.random() * 20 + 10);
    const finalScore = Math.min(99, Math.max(20, baseScore));

    // Generate AI description
    let result;
    try {
      const prompt = `Two music listeners' compatibility:
User 1: genres [${u1.topGenres.join(', ')}], exploration ${u1.explorationIndex}/100, character ${u1.tamilCharacter}
User 2: genres [${u2.topGenres.join(', ')}], exploration ${u2.explorationIndex}/100, character ${u2.tamilCharacter}
Score: ${finalScore}%

Return only JSON:
{"vibe_description":"short cinematic description","shared_traits":["trait1","trait2","trait3"],"chemistry":"one line"}`;

      const groqRes = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.7,
        },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
      );

      const content = groqRes.data.choices[0].message.content.replace(/```json|```/g, '').trim();
      result = { score: finalScore, ...JSON.parse(content) };
    } catch {
      result = {
        score: finalScore,
        vibe_description: 'Two frequencies that find unexpected harmony.',
        shared_traits: ['Eclectic taste', 'Mood-led listening'],
        chemistry: 'Different wavelengths, same room.',
      };
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Compatibility calculation failed' });
  }
});

module.exports = router;