const mongoose = require('mongoose');
require('dotenv').config();
const { syncAllUsers } = require('./src/jobs/syncJob');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/beatwrap')
  .then(async () => {
    console.log('Connected to DB. Running force sync to fix artist images...');
    await syncAllUsers();
    console.log('Sync complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
