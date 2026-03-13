const express = require('express');
const User = require('../models/User');
const WeeklyWrap = require('../models/WeeklyWrap');
const authMiddleware = require('../middleware/auth');
const axios = require('axios');
const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// GET /api/friends/search?q=  — search by displayName OR @username
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });

    const query = q.startsWith('@') ? q.slice(1) : q;

    const users = await User.find({
      $or: [
        { displayName: { $regex: query, $options: 'i' } },
        { username: { $regex: query, $options: 'i' } },
      ],
      _id: { $ne: req.user.id },
    }).select('displayName username profileImage').limit(10);

    // Return { users: [] } — this is what FriendsScreen expects
    res.json({ users });
  } catch (e) {
    console.error('Search error:', e);
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/friends/request
router.post('/request', authMiddleware, async (req, res) => {
  try {
    const { fromId, toId } = req.body;
    if (!toId) return res.status(400).json({ error: 'toId required' });

    const toUser = await User.findById(toId);
    if (!toUser) return res.status(404).json({ error: 'User not found' });
    if (toId === fromId) return res.status(400).json({ error: 'Cannot add yourself' });

    // Already friends
    if (toUser.friends?.some(f => f.toString() === fromId)) {
      return res.status(400).json({ message: 'Already friends' });
    }

    // Already sent
    const existing = toUser.friendRequests?.find(
      r => r.from.toString() === fromId && r.status === 'pending'
    );
    if (existing) return res.status(400).json({ message: 'Request already sent' });

    toUser.friendRequests.push({ from: fromId, status: 'pending' });
    await toUser.save();

    res.json({ success: true });
  } catch (e) {
    console.error('Friend request error:', e);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// GET /api/friends/requests/pending/:userId
router.get('/requests/pending/:userId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('friendRequests.from', 'displayName username profileImage');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const pending = (user.friendRequests || []).filter(r => r.status === 'pending');
    res.json({ requests: pending });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch requests' });
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

    await User.findByIdAndUpdate(request.from, {
      $addToSet: { friends: req.user.id },
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to accept request' });
  }
});

// GET /api/friends/:userId — returns friends with their latest wrap
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('friends', 'displayName username profileImage');
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Attach latest wrap to each friend
    const friendsWithWrap = await Promise.all(
      user.friends.map(async (friend) => {
        const wrap = await WeeklyWrap.findOne({ userId: friend._id }).sort({ createdAt: -1 });
        return {
          _id: friend._id,
          displayName: friend.displayName,
          username: friend.username,
          profileImage: friend.profileImage,
          wrap: wrap?.aiWrap || null,
          stats: wrap?.stats || null,
        };
      })
    );

    res.json({ friends: friendsWithWrap });
  } catch (e) {
    console.error('Get friends error:', e);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// GET /api/friends/compatibility/:userId/:friendId
router.get('/compatibility/:userId/:friendId', authMiddleware, async (req, res) => {
  try {
    const { userId, friendId } = req.params;
    const [userWrap, friendWrap] = await Promise.all([
      WeeklyWrap.findOne({ userId }).sort({ createdAt: -1 }),
      WeeklyWrap.findOne({ userId: friendId }).sort({ createdAt: -1 }),
    ]);

    if (!userWrap || !friendWrap) {
      return res.json({ score: 50, vibe_description: 'Not enough data yet!', shared_traits: [], chemistry: 'Still discovering.' });
    }

    const u1 = { topGenres: userWrap.stats?.topGenres?.map(g => g.genre) || [], explorationIndex: userWrap.stats?.explorationIndex || 50, tamilCharacter: userWrap.aiWrap?.tamil_character?.name || 'Unknown' };
    const u2 = { topGenres: friendWrap.stats?.topGenres?.map(g => g.genre) || [], explorationIndex: friendWrap.stats?.explorationIndex || 50, tamilCharacter: friendWrap.aiWrap?.tamil_character?.name || 'Unknown' };

    const overlap = u2.topGenres.filter(g => new Set(u1.topGenres).has(g)).length;
    const genreScore = Math.round((overlap / Math.max(u1.topGenres.length, 1)) * 40);
    const explorationScore = Math.round(Math.max(0, 30 - Math.abs(u1.explorationIndex - u2.explorationIndex) / 2));
    const finalScore = Math.min(99, Math.max(20, genreScore + explorationScore + Math.floor(Math.random() * 20 + 10)));

    let result;
    try {
      const prompt = `Two music listeners' compatibility:
User 1: genres [${u1.topGenres.join(', ')}], exploration ${u1.explorationIndex}/100, character ${u1.tamilCharacter}
User 2: genres [${u2.topGenres.join(', ')}], exploration ${u2.explorationIndex}/100, character ${u2.tamilCharacter}
Score: ${finalScore}%
Return only JSON: {"vibe_description":"...","shared_traits":["...","...","..."],"chemistry":"..."}`;

      const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 200, temperature: 0.7 },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
      );
      const content = groqRes.data.choices[0].message.content.replace(/```json|```/g, '').trim();
      result = { score: finalScore, ...JSON.parse(content) };
    } catch {
      result = { score: finalScore, vibe_description: 'Two frequencies finding harmony.', shared_traits: ['Eclectic taste', 'Mood-led listening'], chemistry: 'Different wavelengths, same room.' };
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Compatibility failed' });
  }
});

module.exports = router;