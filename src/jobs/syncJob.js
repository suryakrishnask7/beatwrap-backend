const cron = require('node-cron');
const User = require('../models/User');
const ListeningHistory = require('../models/ListeningHistory');
const { getValidToken, getRecentlyPlayed } = require('../services/spotifyServerService');

function getCurrentWeekKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * After ingesting tracks, recompute the derived stats from raw play counts.
 */
function recomputeStats(history) {
  const trackPlayCounts = Object.fromEntries(history.trackPlayCounts || new Map());
  const artistPlayCounts = Object.fromEntries(history.artistPlayCounts || new Map());
  const artistMeta = Object.fromEntries(history.artistMeta || new Map());
  const trackMeta = Object.fromEntries(history.trackMeta || new Map());

  // Build a fallback metadata map from dailyTopTracks for backwards compatibility
  const fallbackMeta = {};
  for (const [, tracks] of history.dailyTopTracks || new Map()) {
    for (const t of tracks) {
      if (t.trackId && !fallbackMeta[t.trackId]) fallbackMeta[t.trackId] = t;
    }
  }

  // ── Top 5 Tracks of the Week (locked-in) ──────────────────────────────
  const sortedTracks = Object.entries(trackPlayCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  history.topTracksOfWeek = sortedTracks.map(([trackId, plays]) => {
    // Prefer explicitly saved trackMeta, fallback to what we logged in dailyTopTracks
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

  // ── Top 5 Artists of the Week ─────────────────────────────────────────
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

  // ── Unique Genres ─────────────────────────────────────────────────────
  const genreSet = new Set();
  for (const [, meta] of Object.entries(artistMeta)) {
    if (meta.genres) meta.genres.forEach(g => genreSet.add(g));
  }
  history.uniqueGenres = Array.from(genreSet);

  // ── Top Genres (ranked by total plays of artists in that genre) ────────
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

  // ── Exploration Index ─────────────────────────────────────────────────
  const totalUniqueArtists = Object.keys(artistPlayCounts).length;
  const totalUniqueGenres = genreSet.size;
  const totalUniqueTracks = Object.keys(trackPlayCounts).length;

  const genreScore = Math.min(totalUniqueGenres * 5, 50);

  const top5ArtistIds = new Set(sortedArtists.slice(0, 5).map(([id]) => id));
  const nonTopArtists = Object.keys(artistPlayCounts).filter(id => !top5ArtistIds.has(id)).length;
  const discoveryRate = totalUniqueArtists > 0
    ? Math.round((nonTopArtists / totalUniqueArtists) * 100) : 0;
  const discoveryScore = discoveryRate * 0.3;

  const replayTracks = Object.values(trackPlayCounts).filter(c => c > 1).length;
  const replayFrequency = totalUniqueTracks > 0
    ? Math.round((replayTracks / totalUniqueTracks) * 100) : 0;
  const replayScore = Math.max(0, 20 - replayFrequency * 0.2);

  history.explorationIndex = Math.round(Math.min(genreScore + discoveryScore + replayScore, 100));
  history.discoveryRate = discoveryRate;
  history.replayFrequency = replayFrequency;
}

const syncAllUsers = async () => {
  console.log('[Sync] Starting...');
  
  try {
    const users = await User.find({ spotifyToken: { $exists: true } });
    const weekKey = getCurrentWeekKey();
    const todayStr = new Date().toISOString().split('T')[0];

    for (const user of users) {
      try {
        const token = await getValidToken(user);
        if (!token) {
          console.log(`[Sync] Skip ${user.displayName} — no token`);
          continue;
        }

        let history = await ListeningHistory.findOne({ userId: user._id, weekKey });
        if (!history) {
          history = new ListeningHistory({ userId: user._id, weekKey });
        }

        let afterTimestamp = null;
        if (history.lastSyncAt) {
          afterTimestamp = new Date(history.lastSyncAt).getTime();
        }

        const items = await getRecentlyPlayed(token, afterTimestamp);
        if (!items || items.length === 0) {
          continue;
        }

        let newMinutes = 0;
        let latestTimestamp = afterTimestamp || 0;
        let latestItem = null;

        for (const item of items) {
          const playedAt = new Date(item.played_at).getTime();
          if (playedAt > latestTimestamp) {
            latestTimestamp = playedAt;
            latestItem = item;
          }

          const track = item.track;
          const durationMs = track.duration_ms || 0;
          newMinutes += (durationMs / 60000);
          const trackId = track.id;
          const safeKey = trackId.replace(/\./g, '_');
          const albumImg = track.album?.images?.[0]?.url || null;
          const primaryArtist = track.artists?.[0]?.name || 'Unknown';

          console.log(`  🎵 ${user.displayName}: "${track.name}" — ${primaryArtist}`);

          // ── Store track metadata (never lose it) ───────────────────────
          history.trackMeta.set(safeKey, {
            name: track.name,
            artist: primaryArtist,
            albumImg,
            durationMs,
          });

          // ── Track Play Counts ──────────────────────────────────────────
          const currentCount = history.trackPlayCounts.get(safeKey) || 0;
          history.trackPlayCounts.set(safeKey, currentCount + 1);

          // ── Artist Play Counts + Metadata ──────────────────────────────
          for (const artist of (track.artists || [])) {
            const artistId = artist.id;
            if (!artistId) continue;
            const artistCount = history.artistPlayCounts.get(artistId) || 0;
            history.artistPlayCounts.set(artistId, artistCount + 1);

            // Store artist meta — use album art as image fallback
            const existing = history.artistMeta.get(artistId);
            if (!existing) {
              history.artistMeta.set(artistId, {
                name: artist.name,
                image: null, // do not use album art, frontend handles null with colored initials
                genres: [],
              });
            }
          }

          // ── Daily Top Tracks ───────────────────────────────────────────
          const dailyTracks = history.dailyTopTracks.get(todayStr) || [];
          const existingIdx = dailyTracks.findIndex(t => t.trackId === trackId);
          
          if (existingIdx >= 0) {
            dailyTracks[existingIdx].plays += 1;
          } else {
            dailyTracks.push({
              trackId, name: track.name, artist: primaryArtist,
              albumImg, durationMs, plays: 1
            });
          }
          
          dailyTracks.sort((a, b) => b.plays - a.plays);
          history.dailyTopTracks.set(todayStr, dailyTracks.slice(0, 10));
        }

        // Add to total and daily minutes (integer only)
        history.estimatedMinutes = Math.round(history.estimatedMinutes + newMinutes);
        const currentDailyMins = history.dailyMinutes.get(todayStr) || 0;
        history.dailyMinutes.set(todayStr, Math.round(currentDailyMins + newMinutes));

        // ── Enrich artists with Spotify API (genres + better images) ─────
        try {
          const artistIds = Array.from(history.artistMeta.keys())
            .filter(id => {
              const meta = history.artistMeta.get(id);
              return !meta?.genres || meta.genres.length === 0 || !meta.image;
            })
            .slice(0, 15); // Process up to 15 at a time since we might need to fallback to individual search requests

          if (artistIds.length > 0) {
            const axios = require('axios');
            let enriched = 0;
            try {
              // Try the bulk endpoint first
              const res = await axios.get(`https://api.spotify.com/v1/artists?ids=${artistIds.join(',')}`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              for (const artist of (res.data.artists || [])) {
                if (!artist) continue;
                const existing = history.artistMeta.get(artist.id) || {};
                history.artistMeta.set(artist.id, {
                  ...existing,
                  name: artist.name,
                  image: artist.images?.[0]?.url || existing.image || null,
                  genres: artist.genres?.length > 0 ? artist.genres : (existing.genres || []),
                });
                enriched++;
              }
            } catch (e) {
              // 403 = Spotify dev mode restriction. Fallback to /search API which is NOT blocked!
              if (e.response && e.response.status === 403) {
                console.log('  ⚠️ Bulk artist API 403 Forbidden. Falling back to Search API...');
                for (const id of artistIds) {
                  try {
                    const existing = history.artistMeta.get(id);
                    if (!existing || !existing.name) continue;
                    
                    const searchRes = await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent('artist:' + existing.name)}&type=artist&limit=1`, {
                      headers: { Authorization: `Bearer ${token}` }
                    });
                    
                    const foundArtist = searchRes.data.artists?.items?.[0];
                    if (foundArtist && foundArtist.name.toLowerCase() === existing.name.toLowerCase()) {
                      history.artistMeta.set(id, {
                        ...existing,
                        image: foundArtist.images?.[0]?.url || existing.image || null,
                        genres: foundArtist.genres?.length > 0 ? foundArtist.genres : (existing.genres || []),
                      });
                      enriched++;
                    }
                  } catch (searchErr) {
                    console.error('Search API fallback failed for artist:', existing?.name);
                  }
                  // Small delay to prevent rate limiting
                  await new Promise(r => setTimeout(r, 200));
                }
              }
            }
            console.log(`  📊 Enriched ${enriched} artists`);
          }
        } catch (e) {
          console.error('Artist enrichment error:', e.message);
        }

        // Update timestamps
        history.lastSyncAt = new Date(latestTimestamp);
        history.lastUpdated = new Date();

        // Recompute all derived stats
        recomputeStats(history);

        await history.save();

        // ── Save the most recently played track to User for Notes ──────────
        if (latestItem) {
          user.lastPlayedTrack = {
            trackId: latestItem.track.id,
            name: latestItem.track.name,
            artist: latestItem.track.artists?.[0]?.name || 'Unknown',
            albumImg: latestItem.track.album?.images?.[0]?.url || null,
            playedAt: new Date(latestItem.played_at),
          };
          await user.save();
        }

        console.log(`[Sync] ${user.displayName}: +${items.length} tracks, +${Math.round(newMinutes)} min, total=${history.estimatedMinutes} min | #1: ${history.topTracksOfWeek?.[0]?.name || 'n/a'}`);

      } catch (err) {
        console.error(`[Sync] Error for ${user.displayName}:`, err.message);
      }
    }
    console.log('[Sync] Done.');
  } catch (error) {
    console.error('[Sync] Fatal:', error);
  }
};

const startSyncJob = () => {
  console.log('[Sync] Cron initialized (every 10 min)');
  cron.schedule('*/10 * * * *', syncAllUsers);
  setTimeout(syncAllUsers, 5000);
};

module.exports = { startSyncJob, syncAllUsers };
