let schedulerTimer = null;

function runScheduledTasks() {
  // Placeholder for weekly wrap background tasks.
  // Keep this function light/safe so scheduler failures do not crash the process.
  try {
    const nowIso = new Date().toISOString();
    console.log(`[wrapScheduler] heartbeat at ${nowIso}`);
  } catch (error) {
    console.error('[wrapScheduler] task error:', error.message);
  }
}

function startScheduler() {
  if (schedulerTimer) {
    return;
  }

  // Run once at startup, then every hour.
  runScheduledTasks();
  schedulerTimer = setInterval(runScheduledTasks, 60 * 60 * 1000);
  console.log('[wrapScheduler] started');
}

function stopScheduler() {
  if (!schedulerTimer) {
    return;
  }
  clearInterval(schedulerTimer);
  schedulerTimer = null;
  console.log('[wrapScheduler] stopped');
}

module.exports = { startScheduler, stopScheduler };
