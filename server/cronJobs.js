/**
 * cronJobs.js
 * Schedules the daily NEPSE market summary job.
 *
 * Fires at 3:05 PM NPT (Nepal Standard Time = UTC+5:45).
 * In UTC:  15:05 NPT = 09:20 UTC
 * Cron:    "20 9 * * 0-4"   (Sun-Thu = Nepal trading days Sun–Thu)
 */

const cron = require('node-cron');
const { dispatchDailySummary } = require('./marketSummary');

/**
 * @param {object} supabase  Supabase client injected from index.js
 */
function startCronJobs(supabase) {
  // ── Daily Market Summary ── 3:05 PM NPT (09:20 UTC), Sun–Thu ─────────────
  cron.schedule(
    '13 5 * * 1-5',
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

  console.log('[Cron] Daily market summary job scheduled → 3:05 PM NPT (Sun–Thu)');
}

module.exports = { startCronJobs };
