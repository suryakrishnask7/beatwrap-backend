require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('./src/models/User');
const ListeningHistory = require('./src/models/ListeningHistory');
const WeeklyWrap = require('./src/models/WeeklyWrap');
const { getValidToken } = require('./src/services/spotifyServerService');

function getCurrentWeekKey(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function recomputeStats(history) {
  const trackPlayCounts = Object.fromEntries(history.trackPlayCounts || new Map());
  const artistPlayCounts = Object.fromEntries(history.artistPlayCounts || new Map());
  const artistMeta = Object.fromEntries(history.artistMeta || new Map());
  const trackMeta = Object.fromEntries(history.trackMeta || new Map());

  const fallbackMeta = {};
  for (const [, tracks] of history.dailyTopTracks || new Map()) {
    for (const t of tracks) {
      if (t.trackId && !fallbackMeta[t.trackId]) fallbackMeta[t.trackId] = t;
    }
  }

  const sortedTracks = Object.entries(trackPlayCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  history.topTracksOfWeek = sortedTracks.map(([trackId, plays]) => {
    const meta = trackMeta[trackId] || fallbackMeta[trackId] || {};
    return {
      trackId,
      name: meta.name || 'Unknown Track',
      artist: meta.artist || 'Unknown Artist',
      albumImg: meta.albumImg || null,
      plays,
      durationMs: meta.durationMs || 0,
    };
  });

  const sortedArtists = Object.entries(artistPlayCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  history.topArtistsOfWeek = sortedArtists.map(([artistId, plays]) => {
    const meta = artistMeta[artistId] || {};
    return {
      artistId,
      name: meta.name || 'Unknown',
      image: meta.image || null,
      genres: meta.genres || [],
      plays,
    };
  });

  const genreSet = new Set();
  for (const [, meta] of Object.entries(artistMeta)) {
    if (meta.genres) meta.genres.forEach(g => genreSet.add(g));
  }
  history.uniqueGenres = Array.from(genreSet);

  const genrePlayCounts = {};
  for (const [artistId, plays] of Object.entries(artistPlayCounts)) {
    const meta = artistMeta[artistId];
    if (meta?.genres) {
      for (const g of meta.genres) {
        genrePlayCounts[g] = (genrePlayCounts[g] || 0) + plays;
      }
    }
  }
  history.topGenres = Object.entries(genrePlayCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([genre, count]) => ({ genre, count }));

  const totalUniqueArtists = Object.keys(artistPlayCounts).length;
  const totalUniqueGenres = genreSet.size;
  const totalUniqueTracks = Object.keys(trackPlayCounts).length;
  const genreScore = Math.min(totalUniqueGenres * 5, 50);
  const top5ArtistIds = new Set(sortedArtists.slice(0, 5).map(([id]) => id));
  const nonTopArtists = Object.keys(artistPlayCounts).filter(id => !top5ArtistIds.has(id)).length;
  const discoveryRate = totalUniqueArtists > 0 ? Math.round((nonTopArtists / totalUniqueArtists) * 100) : 0;
  const discoveryScore = discoveryRate * 0.3;
  const replayTracks = Object.values(trackPlayCounts).filter(c => c > 1).length;
  const replayFrequency = totalUniqueTracks > 0 ? Math.round((replayTracks / totalUniqueTracks) * 100) : 0;
  const replayScore = Math.max(0, 20 - replayFrequency * 0.2);

  history.explorationIndex = Math.round(Math.min(genreScore + discoveryScore + replayScore, 100));
  history.discoveryRate = discoveryRate;
  history.replayFrequency = replayFrequency;
}

function getWeekKey(weeksAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - weeksAgo * 7);
  return getCurrentWeekKey(d);
}

const rawList = {
  Monday: [
    "Kurukku Siruthvalea",
    "Kaadhal Konjam",
    "Avalukena",
    "Vaigasi Nilave",
    "So Baby"
  ],
  Tuesday: [
    "Hey Sita Hey Rama",
    "Yaaro Yaaro",
    "Naan Nee",
    "Mazhai Kuruvi",
    "Vennira Iravugal"
  ],
  Wednesday: [
    "Iravingu Theevai",
    "Maragatha Maalai",
    "Kannukkulle",
    "Pogatha Yennavittu",
    "Kaarkuzhal Kadavaiye"
  ],
  Thursday: [
    "Thathi Thaavum",
    "En Kadhal Solla",
    "Kannadi Poove",
    "Kondattam",
    "Kaatrai Konjam"
  ],
  Friday: [
    "Yennai Maatrum Kadhale",
    "Mudhal Kaadhal",
    "Kannukulla",
    "Thanga Sela",
    "Malargal Kaettaen"
  ],
  Saturday: [
    "Sollamal Thottu Chellum Thendral",
    "Dheema",
    "Naan Pizhaippeno",
    "Vaaya Veera",
    "Veyyon Silli"
  ],
  Sunday: [
    "Amizhdhe Nee",
    "Paadatha Pattellam",
    "Sonapareeya",
    "Kaalathukkum Nee Venum",
    "Vaenguzhali Ezhindayadi"
  ]
};

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    let user = await User.findOne({ username: 'suryaa' });
    if (!user) {
      console.log('User suryaa not found, falling back to first available user...');
      user = await User.findOne();
      if (!user) {
        console.log('No users found in database at all');
        process.exit(1);
      }
    }

    const token = await getValidToken(user);
    if (!token) {
      console.log('No valid Spotify token found for suryaa');
      process.exit(1);
    }

    const prevWeekKey = getWeekKey(1);
    const dailyMap = new Map();
    const trackPlayCounts = new Map();
    const artistPlayCounts = new Map();
    const trackMeta = new Map();
    const artistMeta = new Map();

    // Map day names to offsets from last Monday
    // We want the dates to correspond to the CURRENT week's days (Monday to Sunday)
    const now = new Date();
    const day = now.getDay() || 7;
    now.setHours(-24 * (day - 1 + 7)); // Substract current days + 7 days for previous week
    now.setHours(0, 0, 0, 0);
    // now is previous week's Monday.

    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = dayNames[i];

      const queries = rawList[dayName];
      const tracks = [];

      for (const query of queries) {
        try {
          const res = await axios.get(`https://api.spotify.com/v1/search`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { q: query, type: 'track', limit: 1 }
          });
          
          if (res.data.tracks && res.data.tracks.items.length > 0) {
            const track = res.data.tracks.items[0];
            const artist = track.artists[0];
            
            tracks.push({
              trackId: track.id,
              name: track.name,
              artist: artist.name,
              albumImg: track.album?.images?.[0]?.url || null,
              durationMs: track.duration_ms,
              plays: 1
            });

            // Update Meta & Counts
            trackMeta.set(track.id, {
              name: track.name,
              artist: artist.name,
              albumImg: track.album?.images?.[0]?.url || null,
              durationMs: track.duration_ms
            });
            trackPlayCounts.set(track.id, (trackPlayCounts.get(track.id) || 0) + 1);

            if (!artistMeta.has(artist.id)) {
              // Fetch artist image since track API doesn't provide it
              let artistImg = null;
              let genres = [];
              try {
                const artRes = await axios.get(`https://api.spotify.com/v1/artists/${artist.id}`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                artistImg = artRes.data.images?.[0]?.url;
                genres = artRes.data.genres || [];
              } catch {
                // Fallback to search if 403
                try {
                   const sArtRes = await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent('artist:' + artist.name)}&type=artist&limit=1`, {
                     headers: { Authorization: `Bearer ${token}` }
                   });
                   artistImg = sArtRes.data.artists?.items?.[0]?.images?.[0]?.url;
                   genres = sArtRes.data.artists?.items?.[0]?.genres || [];
                } catch {}
              }
              
              artistMeta.set(artist.id, {
                name: artist.name,
                image: artistImg,
                genres: genres
              });
            }
            artistPlayCounts.set(artist.id, (artistPlayCounts.get(artist.id) || 0) + 1);

            console.log(`Found: ${track.name} by ${artist.name} (Img: ${artistMeta.get(artist.id).image ? 'YES' : 'NO'})`);
          } else {
            console.log(`Not found: ${query}`);
            // mock it if not found
            tracks.push({
              trackId: "mock_" + Math.random().toString(36).substring(7),
              name: query,
              artist: "Unknown Artist",
              albumImg: null,
            });
          }
        } catch (e) {
          console.error(`Error searching ${query}:`, e.response?.data || e.message);
        }
      }
      dailyMap.set(dateStr, tracks);
    }

    const currentStats = {
      estimatedMinutes: 450,
      explorationIndex: 82,
      discoveryRate: 40,
      replayFrequency: 15,
      topGenres: ['Tamil Pop', 'Kollywood', 'Indian Indie']
    };

    const history = await ListeningHistory.findOneAndUpdate(
      { userId: user._id, weekKey: prevWeekKey },
      { 
        estimatedMinutes: currentStats.estimatedMinutes,
        explorationIndex: currentStats.explorationIndex,
        discoveryRate: currentStats.discoveryRate,
        replayFrequency: currentStats.replayFrequency,
        topGenres: currentStats.topGenres,
        dailyTopTracks: dailyMap,
        trackPlayCounts,
        artistPlayCounts,
        trackMeta,
        artistMeta
      },
      { upsert: true, new: true }
    );

    // Recompute all derived fields (topTracksOfWeek, topArtistsOfWeek, topGenres etc)
    recomputeStats(history);
    await history.save();

    // ── ALSO SEED WEEKLY WRAP (for Stats comparison) ────────────────────────
    await WeeklyWrap.findOneAndUpdate(
      { userId: user._id, weekKey: prevWeekKey },
      {
        stats: {
          explorationIndex: currentStats.explorationIndex,
          discoveryRate: currentStats.discoveryRate,
          replayFrequency: currentStats.replayFrequency,
          estimatedMinutes: currentStats.estimatedMinutes,
          topGenres: currentStats.topGenres.map(g => ({ genre: g, count: Math.floor(Math.random() * 20) + 10 })),
          topTracks: [],
          topArtists: []
        },
        aiWrap: {
          week_label: "The Retro Explorer",
          dominant_vibe: "Nostalgic & Energetic",
          energy_level: "High",
          confidence: 0.92,
          story: "Last week was a journey through the classics. Your ears were tuned to the rhythm of the past while keeping an eye on the future.",
          tamil_character: { name: "Anbu", film: "Vada Chennai", why_this_character: "Determined and rhythmic." }
        },
        lockedAt: new Date(now)
      },
      { upsert: true, new: true }
    );

    console.log(`Successfully seeded previous week (${prevWeekKey}) tracks for suryaa!`);
  } catch (e) {
    console.error(e);
  } finally {
    mongoose.connection.close();
  }
}

seed();
