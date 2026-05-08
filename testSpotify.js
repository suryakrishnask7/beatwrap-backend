const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./src/models/User');
const { getValidToken } = require('./src/services/spotifyServerService');

async function testSpotify() {
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ spotifyToken: { $exists: true } });
  const token = await getValidToken(user);
  
  try {
    const res = await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent('Harris Jayaraj')}&type=artist&limit=1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Success:', res.data.artists.items[0].images);
  } catch (e) {
    console.error('Spotify Error:', e.response?.status, e.response?.data);
  }
  process.exit(0);
}

testSpotify();
