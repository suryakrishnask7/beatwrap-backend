const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// POST /api/auth/spotify
router.post('/spotify', async (req, res) => {
  try {
    const { spotifyId, displayName, email, profileImage, spotifyToken } = req.body;
    if (!spotifyId || !displayName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let user = await User.findOne({ spotifyId });
    if (user) {
      user.spotifyToken = spotifyToken;
      user.displayName = displayName;
      if (profileImage) user.profileImage = profileImage;
      await user.save();
    } else {
      user = await User.create({ spotifyId, displayName, email, profileImage, spotifyToken });
    }

    const token = jwt.sign(
      { id: user._id, spotifyId: user.spotifyId },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        _id: user._id,
        spotifyId: user.spotifyId,
        displayName: user.displayName,
        email: user.email,
        profileImage: user.profileImage,
        username: user.username || null,
        // Tell the app if this user needs to set a username
        hasUsername: !!user.username,
      },
    });
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// POST /api/auth/username — set username on first login
router.post('/username', authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    // Validate: lowercase letters, numbers, underscores, 3-20 chars
    const valid = /^[a-z0-9_]{3,20}$/.test(username.toLowerCase());
    if (!valid) return res.status(400).json({ error: 'Username must be 3-20 chars, letters/numbers/underscores only' });

    // Check taken
    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) return res.status(400).json({ error: 'Username already taken' });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { username: username.toLowerCase() },
      { new: true }
    );

    res.json({
      success: true,
      username: user.username,
      user: {
        _id: user._id,
        spotifyId: user.spotifyId,
        displayName: user.displayName,
        email: user.email,
        profileImage: user.profileImage,
        username: user.username,
        hasUsername: true,
      },
    });
  } catch (e) {
    console.error('Username error:', e);
    res.status(500).json({ error: 'Failed to set username' });
  }
});

// GET /api/auth/check-username/:username — check availability
router.get('/check-username/:username', async (req, res) => {
  try {
    const existing = await User.findOne({ username: req.params.username.toLowerCase() });
    res.json({ available: !existing });
  } catch (e) {
    res.status(500).json({ error: 'Check failed' });
  }
});


// GET /api/auth/stats — real profile stats for ProfileScreen
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const WeeklyWrap = require('../models/WeeklyWrap');
    const MoodLog = require('../models/MoodLog');
    const user = await User.findById(req.user.id).select('friends');
    const [wrapCount, moodCount] = await Promise.all([
      WeeklyWrap.countDocuments({ userId: req.user.id }),
      MoodLog.countDocuments({ userId: req.user.id }),
    ]);
    res.json({
      wraps: wrapCount,
      moodDays: moodCount,
      friends: user?.friends?.length || 0,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;