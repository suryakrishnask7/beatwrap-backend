// wrapScheduler.js
// REMOVED: All automatic wrap generation logic has been removed.
// Wrap generation is now 100% user-triggered from the frontend.
// This file is kept as an empty stub so existing requires don't crash.

function startScheduler() {
  console.log('[WrapScheduler] Scheduler disabled — wrap generation is user-triggered only.');
}

async function runWrapGeneration() {
  console.log('[WrapScheduler] Manual run disabled — use frontend to generate wraps.');
}

module.exports = { startScheduler, runWrapGeneration };