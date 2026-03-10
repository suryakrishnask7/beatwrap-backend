const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

// POST /api/auth/spotify - Register or login via Spotify
router.post('/spotify', async (req, res) => {
  try {
    const { spotifyId, displayName, email, profileImage, spotifyToken } = req.body;

    if (!spotifyId || !displayName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let user = await User.findOne({ spotifyId });

    if (user) {
      // Update token
      user.spotifyToken = spotifyToken;
      user.displayName = displayName;
      if (profileImage) user.profileImage = profileImage;
      await user.save();
    } else {
      // Create new user
      user = await User.create({
        spotifyId,
        displayName,
        email,
        profileImage,
        spotifyToken,
      });
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
      },
    });
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

module.exports = router;
