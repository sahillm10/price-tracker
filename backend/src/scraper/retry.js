import { config } from '../config.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs fn up to maxAttempts times with exponential backoff + jitter.
 * Returns { ok, value, attempts[], error } - never throws, so a failure can always be logged.
 */
export async function withRetries(fn, { maxAttempts = config.scrape.maxAttempts, onAttempt } = {}) {
  const attempts = [];
  let lastError = null;
  for (let n = 1; n <= maxAttempts; n++) {
    const t0 = Date.now();
    try {
      const value = await fn(n);
      attempts.push({ n, ok: true, ms: Date.now() - t0 });
      onAttempt?.(attempts.at(-1));
      return { ok: true, value, attempts, error: null };
    } catch (e) {
      lastError = e;
      attempts.push({ n, ok: false, ms: Date.now() - t0, code: e.code || e.name || 'ERROR', message: String(e.message).slice(0, 300) });
      onAttempt?.(attempts.at(-1));
      if (n < maxAttempts) {
        let wait = config.scrape.backoffBaseMs * 2 ** (n - 1) + Math.floor(Math.random() * 500);
        if (e.retryAfterMs) wait = Math.max(wait, Math.min(e.retryAfterMs, 30_000)); // store said "slow down" (HTTP 429)
        await sleep(wait);
      }
    }
  }
  return { ok: false, value: null, attempts, error: lastError };
}
