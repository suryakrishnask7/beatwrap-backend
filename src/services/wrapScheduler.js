// src/services/wrapScheduler.js
// ─────────────────────────────────────────────────────────────────────────────
// Runs every Sunday at midnight and generates wraps for all users who have
// listening history for the week but haven't generated a wrap yet.
// This means friends can see your wrap even if you haven't opened the app.
// ─────────────────────────────────────────────────────────────────────────────

const axios = require('axios');
const WeeklyWrap = require('../models/WeeklyWrap');
const ListeningHistory = require('../models/ListeningHistory');
const User = require('../models/User');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE = 'https://api.groq.com/openai/v1';

// ── Week key helper ────────────────────────────────────────────────────────
function getCurrentWeekKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ── Minimal character list for backend (no music_vibe needed for prompt) ──
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
  { name: 'Dhanush', film: 'Kadhal Kondein', vibe: 'One artist on repeat, obsessive deep dives, same 3 songs again and again.' },
  { name: 'Sivasami', film: 'Asuran', vibe: 'Slow folk builds, GV Prakash rawness, music rooted in survival.' },
  { name: 'Amar', film: 'Vikram', vibe: 'Layered electronic scores, dark orchestral, Anirudh tension.' },
  { name: 'Rolex', film: 'Vikram', vibe: 'Maximalist playlists, too many genres, everything turned up.' },
  { name: 'Gandhi Mahaan', film: 'Mahaan', vibe: 'Genre-blending, classical then trap, cannot be pinned down.' },
  { name: 'Rishi Kumar', film: 'Roja', vibe: 'Soft AR Rahman, longing instrumentals, missing someone far away.' },
  { name: 'Roja', film: 'Roja', vibe: 'Waiting melodies, slow violin, hope held very carefully.' },
  { name: 'Karthik', film: 'Alaipayuthey', vibe: 'Youthful AR Rahman, upbeat Tamil pop, first week of being in love.' },
  { name: 'Nallasivam', film: 'Anbe Sivam', vibe: 'Warm humanist folk, beauty in ordinary moments, arm around your shoulder.' },
  { name: 'Virumaandi', film: 'Virumaandi', vibe: 'Heavy percussion, raw folk-fusion, music that punches first.' },
  { name: 'Prabhu', film: 'Polladhavan', vibe: 'Street energy, gritty Tamil beats, garage midnight underground.' },
  { name: 'Mynaa', film: 'Mynaa', vibe: 'Cheerful indie, bright Tamil pop, running through an open field.' },
  { name: 'Divya', film: 'Mouna Ragam', vibe: 'Layered emotional Ilaiyaraaja, refuses to be simple, bittersweet.' },
  { name: 'Kokila', film: 'Kolamaavu Kokila', vibe: 'Dark-comedy funk, genre switches, soft surface with unsettling underneath.' },
  { name: 'Pariyerum Perumal', film: 'Pariyerum Perumal', vibe: 'Indie Tamil folk, Santhosh Narayanan rawness, quiet pain.' },
  { name: 'Kabali', film: 'Kabali', vibe: 'Santhosh Narayanan swagger, slow-walk BGMs, arriving somewhere important.' },
  { name: 'Prabhu', film: 'Irudhi Suttru', vibe: 'Driven beats, focused energy, no time for sentimentality.' },
  { name: 'Wilson', film: 'Dhruvangal Pathinaaru', vibe: 'Minimal thriller scores, silence as music, never quite resolves.' },
  { name: 'Aśok', film: 'Ko', vibe: 'Fresh indie, Harris Jayaraj energy, finding something before everyone else.' },
];

const CHARACTER_LIST = TAMIL_CHARACTERS.map(c =>
  `${c.name} (${c.film}) — ${c.vibe}`
).join('\n');

// ── Generate wrap for a single user using their stored listening history ──
async function generateWrapForUser(userId, weekKey, historyData) {
  const { topGenres, topArtists, topTracks } = historyData;

  const prompt = `You are BeatWrap AI. Generate a weekly music wrap.

Top Genres: ${topGenres?.map(g => g.genre).join(', ') || 'Mixed'}
Top Artists: ${topArtists?.slice(0, 8).map(a => a.name).join(', ') || 'Various'}
Top Tracks: ${topTracks?.slice(0, 8).map(t => `${t.name} by ${t.artists?.[0]?.name}`).join(', ') || 'Various'}

Choose a Tamil character from this list whose music vibe matches the listening above:
${CHARACTER_LIST}

Write a 120-160 word cinematic story about this week's listening.
Avoid psychological analysis. Keep it smooth and aesthetic.

Return ONLY valid JSON:
{
  "week_label": "...",
  "dominant_vibe": "...",
  "energy_level": "...",
  "tamil_protagonist": { "archetype": "...", "inspired_by": "..." },
  "tamil_character": { "name": "...", "film": "...", "why_this_character": "..." },
  "story": "...",
  "confidence": 0.0
}`;

  const res = await axios.post(
    `${GROQ_BASE}/chat/completions`,
    {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 700,
      temperature: 0.8,
    },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
  );

  const content = res.data.choices[0].message.content.replace(/```json|```/g, '').trim();
  return JSON.parse(content);
}

// ── Main scheduler function ───────────────────────────────────────────────
async function runWrapGeneration() {
  const weekKey = getCurrentWeekKey();
  console.log(`[WrapScheduler] Running for week ${weekKey}`);

  try {
    // Find all users who have listening history for this week
    // but don't yet have a wrap
    const usersWithHistory = await ListeningHistory.find({ weekKey }).select('userId');
    const userIdsWithHistory = usersWithHistory.map(h => h.userId.toString());

    const usersWithWrap = await WeeklyWrap.find({ weekKey }).select('userId');
    const userIdsWithWrap = new Set(usersWithWrap.map(w => w.userId.toString()));

    // Users who have history but no wrap yet
    const usersToGenerate = userIdsWithHistory.filter(id => !userIdsWithWrap.has(id));
    console.log(`[WrapScheduler] ${usersToGenerate.length} users need wraps generated`);

    for (const userId of usersToGenerate) {
      try {
        const history = await ListeningHistory.findOne({ userId, weekKey });
        if (!history || !history.topTracks?.length) continue;

        const aiWrap = await generateWrapForUser(userId, weekKey, history);

        // Validate character
        const valid = TAMIL_CHARACTERS.find(
          c => c.name.toLowerCase() === aiWrap.tamil_character?.name?.toLowerCase()
        );
        if (!valid && aiWrap.tamil_character) {
          const fallback = TAMIL_CHARACTERS[Math.floor(Math.random() * TAMIL_CHARACTERS.length)];
          aiWrap.tamil_character = {
            name: fallback.name,
            film: fallback.film,
            why_this_character: `The soundtrack this week echoes the world of ${fallback.name}.`,
          };
        }

        const stats = {
          topGenres: history.topGenres,
          topTracks: history.topTracks,
          topArtists: history.topArtists,
          explorationIndex: history.explorationIndex,
          discoveryRate: history.discoveryRate,
          replayFrequency: history.replayFrequency,
          estimatedMinutes: history.estimatedMinutes,
        };

        await WeeklyWrap.create({ userId, weekKey, aiWrap, stats });
        console.log(`[WrapScheduler] Wrap generated for user ${userId}`);

        // Rate limit — don't hammer Groq API
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        console.error(`[WrapScheduler] Failed for user ${userId}:`, e.message);
      }
    }

    console.log(`[WrapScheduler] Done for week ${weekKey}`);
  } catch (e) {
    console.error('[WrapScheduler] Fatal error:', e.message);
  }
}

// ── Schedule helper — runs every Sunday at 00:05 ─────────────────────────
function msUntilNextSunday() {
  const now = new Date();
  const next = new Date(now);
  // Find next Sunday
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
  next.setDate(now.getDate() + daysUntilSunday);
  next.setHours(0, 5, 0, 0); // 00:05 Sunday
  return next.getTime() - now.getTime();
}

function startScheduler() {
  const ms = msUntilNextSunday();
  const hours = Math.floor(ms / 3600000);
  console.log(`[WrapScheduler] Next run in ${hours} hours (next Sunday 00:05)`);

  setTimeout(() => {
    runWrapGeneration();
    // Then repeat every 7 days
    setInterval(runWrapGeneration, 7 * 24 * 60 * 60 * 1000);
  }, ms);
}

module.exports = { startScheduler, runWrapGeneration };