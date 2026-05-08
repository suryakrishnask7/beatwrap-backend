const axios = require('axios');
const User = require('../models/User');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const getValidToken = async (user) => {
  if (!user.spotifyToken) return null;

  // If token is still valid (with 5 min buffer), return it
  if (user.spotifyTokenExpiry && user.spotifyTokenExpiry.getTime() > Date.now() + 5 * 60000) {
    return user.spotifyToken;
  }

  if (!user.spotifyRefreshToken) return null;

  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: user.spotifyRefreshToken,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
        },
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiry = new Date(Date.now() + (expires_in || 3600) * 1000);

    user.spotifyToken = access_token;
    if (refresh_token) user.spotifyRefreshToken = refresh_token;
    user.spotifyTokenExpiry = expiry;
    await user.save();

    return access_token;
  } catch (error) {
    console.error(`Failed to refresh token for user ${user.displayName}:`, error.response?.data || error.message);
    return null;
  }
};

const getRecentlyPlayed = async (token, afterTimestamp = null) => {
  try {
    let url = 'https://api.spotify.com/v1/me/player/recently-played?limit=50';
    if (afterTimestamp) {
      url += `&after=${afterTimestamp}`;
    }

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return response.data.items || [];
  } catch (error) {
    console.error('Failed to fetch recently played:', error.response?.data || error.message);
    return [];
  }
};

module.exports = {
  getValidToken,
  getRecentlyPlayed
};
