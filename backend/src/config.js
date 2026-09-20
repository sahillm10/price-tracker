import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 3000),
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, ''),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  cronSecret: process.env.CRON_SECRET,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  storeBaseUrl: (process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com').replace(/\/$/, ''),
  headed: process.env.HEADED === '1',
  chaos: process.env.CHAOS === '1',
  scrape: {
    maxAttempts: 4,
    navTimeoutMs: 25_000,      // one page load
    renderTimeoutMs: 25_000,   // wait for async content to appear after load (allows store's 6 internal retries)
    backoffBaseMs: 2_000,      // 2s, 4s, 8s (+ jitter)
    stableGapMs: 700,          // gap between the two reads that must agree
    dueSlackMs: 5 * 60_000,    // cron drift tolerance
    staleRunMs: 10 * 60_000,   // a 'running' log older than this is marked failed (interrupted)
  },
};
