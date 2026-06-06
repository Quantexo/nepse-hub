/**
 * cronJobs.js
 * Schedules the daily NEPSE market summary job.
 *
 * Fires at 6:00 PM NPT (Nepal Standard Time = UTC+5:45).
 * In UTC: 18:00 NPT = 12:15 UTC
 * Cron:    "15 12 * * 1-5"   (Mon-Fri)
 */

const cron = require('node-cron');
const { dispatchDailySummary } = require('./marketSummary');

/**
 * @param {object} supabase  Supabase client injected from index.js
 */
function startCronJobs(supabase) {
  // ── Daily Market Summary ── 6:00 PM NPT (12:15 UTC), Mon–Fri ─────────────
  cron.schedule(
    '30 9 * * 1-5',
    async () => {
      console.log('[Cron] Triggering daily market summary…');
      try {
        await dispatchDailySummary(supabase);
      } catch (err) {
        console.error('[Cron] Market summary job failed:', err.message);
      }
    },
    { timezone: 'UTC' }
  );

  console.log('[Cron] Daily market summary job scheduled → 6:00 PM NPT (Mon–Fri)');
}

module.exports = { startCronJobs };