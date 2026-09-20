import { config } from '../config.js';
import { ScrapeError } from '../errors.js';
import { withPage } from './browser.js';
import { withRetries, sleep } from './retry.js';
import { parsePrice, parseStock, looksLoaded } from './parse.js';
import { validateLayout, pageRead, pickCurrent, revealPrice, waitForPrice } from '../store/adapter.js';

const { navTimeoutMs, renderTimeoutMs, stableGapMs } = config.scrape;

function httpError(res, what) {
  if (res.status() === 429) {
    const secs = Number(res.headers()['retry-after']);
    return new ScrapeError('RATE_LIMITED', `${what} HTTP 429 (store asked us to slow down)`, { retryAfterMs: (Number.isFinite(secs) ? secs : 10) * 1000 });
  }
  return new ScrapeError('HTTP_ERROR', `${what} HTTP ${res.status()}`);
}

/** One attempt at scraping a product page. Throws a classified ScrapeError on anything doubtful. */
async function attemptProduct(url, log) {
  return withPage(async (page) => {
    // The layout the page ACTUALLY rendered with (a second request could return a different one).
    const layoutRes = page.waitForResponse((r) => r.url().includes('/api/layout'), { timeout: navTimeoutMs });
    layoutRes.catch(() => {});

    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
    if (!res) throw new ScrapeError('NETWORK', 'no response');
    if (res.status() >= 400) throw httpError(res, 'page');

    const lr = await layoutRes;
    if (lr.status() >= 400) throw httpError(lr, 'layout');
    const layout = await lr.json().catch(() => { throw new ScrapeError('STRUCTURE_CHANGED', 'layout response was not JSON'); });
    const classes = validateLayout(layout);
    log(`layout rev ${layout.revision} variant ${layout.variant} (price class .${classes.sale || classes.priceValue})`);

    const clicked = await revealPrice(page, log);
    log(clicked ? 'clicked Reveal' : 'no Reveal button found');
    await waitForPrice(page, classes, renderTimeoutMs); // async content: wait for a real value, not a fixed sleep

    // Prices change often and can flicker: accept only two consecutive identical reads.
    const snapshot = async () => {
      const raw = await page.evaluate(pageRead, classes);
      const cur = pickCurrent(raw);
      if (!looksLoaded(raw.stock)) throw new ScrapeError('INVALID_DATA', `stock not loaded: "${raw.stock}"`);
      return { raw, cur, key: `${cur.text}|${raw.mrp}|${raw.stock}` };
    };
    let prev = await snapshot();
    for (let i = 0; i < 4; i++) {
      await sleep(stableGapMs);
      const now = await snapshot();
      if (now.key === prev.key) {
        const price = parsePrice(now.cur.text);
        const stock = parseStock(now.raw.stock);
        const mrp = now.raw.mrp ? parsePrice(now.raw.mrp).value : null;
        // The current price can never exceed the crossed-out MRP. If it does we read the wrong element or caught a mid-update.
        if (mrp && price.value > mrp) throw new ScrapeError('INVALID_DATA', `price ${price.value} is above MRP ${mrp}`);
        return {
          price: price.value, currency: price.currency, stockStatus: stock.status, stockQty: stock.qty,
          extra: { mrp, seller: now.raw.seller, delivery: now.raw.delivery, ratings: now.raw.rating },
          layout: { revision: layout.revision, variant: layout.variant },
          raw: now.raw, // kept in the log so a wrong reading can be debugged later
        };
      }
      log(`values still changing ("${prev.key}" -> "${now.key}"), re-reading`);
      prev = now;
    }
    throw new ScrapeError('UNSTABLE', 'price/stock did not settle across 5 reads');
  }, { log });
}

/** Pure scrape (no DB). Returns { ok, data, attempts, error }. */
export async function scrapeProductPage(url, { log = () => {} } = {}) {
  const r = await withRetries((n) => { log(`attempt ${n}: ${url}`); return attemptProduct(url, log); }, {
    onAttempt: (a) => log(a.ok ? `attempt ${a.n} OK (${a.ms}ms)` : `attempt ${a.n} FAILED [${a.code}] ${a.message}`),
  });
  return { ok: r.ok, data: r.value, attempts: r.attempts, error: r.error };
}
