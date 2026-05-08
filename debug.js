// Check artist data in ListeningHistory
require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const ListeningHistory = require('./src/models/ListeningHistory');
  const histories = await ListeningHistory.find({});
  for (const h of histories) {
    console.log(`\n=== Week: ${h.weekKey}, Minutes: ${h.estimatedMinutes} ===`);
    console.log(`Top Tracks:`, JSON.stringify(h.topTracksOfWeek?.slice(0, 3), null, 2));
    console.log(`Top Artists:`, JSON.stringify(h.topArtistsOfWeek?.slice(0, 3), null, 2));
    
    // Show raw artist meta to check images
    const meta = Object.fromEntries(h.artistMeta || new Map());
    const sample = Object.entries(meta).slice(0, 3);
    console.log(`Artist Meta (sample):`, JSON.stringify(sample, null, 2));
  }
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
