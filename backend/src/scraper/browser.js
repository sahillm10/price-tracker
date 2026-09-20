import { chromium } from 'playwright';
import { config } from '../config.js';
import { ScrapeError } from '../errors.js';
import { sleep } from './retry.js';

let browserPromise = null;

/** First line + the last lines of Playwright's call log ("element is not enabled", "intercepts pointer events", ...). */
export function brief(e) {
  const lines = String(e?.message || e).split('\n').map((l) => l.trim()).filter(Boolean);
  return [lines[0], ...lines.slice(1).filter((l) => l !== 'Call log:').slice(-2)].join(' | ').slice(0, 400);
}

async function getBrowser() {
  // Re-launch if Chromium crashed between runs.
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.isConnected()) return b;
    browserPromise = null;
  }
  browserPromise = chromium.launch({
    headless: !config.headed,
    slowMo: config.headed ? 75 : 0, // visible pace without excessive delay
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

/**
 * Fresh, isolated context per attempt: no cookies/cache carried over from a bad attempt.
 * CHAOS=1 injects slow responses and 5xx errors so the retry logic can be demonstrated on demand.
 */
export async function withPage(fn, { log = () => {} } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  try {
    if (!config.headed) {
      // Headless runs don't need heavy images/media; saves bandwidth
      await context.route('**/*', (route) =>
        ['image', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue());
    }
    if (config.chaos) {
      await context.route('**/*', async (route) => {
        if (!['document', 'xhr', 'fetch'].includes(route.request().resourceType())) return route.continue();
        const roll = Math.random();
        if (roll < 0.25) { log('CHAOS: delaying response 8s'); await sleep(8000); return route.continue(); }
        if (roll < 0.5) { log('CHAOS: returning HTTP 503'); return route.fulfill({ status: 503, body: 'Service Unavailable' }); }
        return route.continue();
      });
    }
    const page = await context.newPage();
    return await fn(page);
  } catch (e) {
    if (e instanceof ScrapeError) throw e;
    throw new ScrapeError(e?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', brief(e));
  } finally {
    await context.close().catch(() => {});
  }
}
