/**
 * Everything that knows how INE's mock store behaves lives here.
 *
 * What discovery showed us:
 *  - The page is client-rendered. On load it calls /api/layout, which returns RANDOMISED class names
 *    (e.g. pv-q9 vs pv-m4), element order, tag names and price format. So selectors can't be hardcoded.
 *  - The price starts hidden behind a "Reveal" button.
 *  - Two prices are shown: the crossed-out MRP (decoy) and the current/sale price. The "% off" badge can be wrong.
 * Strategy: capture the layout the page actually used, build selectors from it, click Reveal, wait for a real price.
 */
import { config } from '../config.js';
import { ScrapeError } from '../errors.js';
import { looksLoaded } from '../scraper/parse.js';

export const productUrl = (id) => `${config.storeBaseUrl}/product/${id}`;

export function validateLayout(layout) {
  const c = layout && layout.classes;
  if (!c || typeof c !== 'object' || !c.stock || !(c.sale || c.priceValue)) {
    throw new ScrapeError('STRUCTURE_CHANGED', `unexpected /api/layout shape: ${JSON.stringify(layout).slice(0, 200)}`);
  }
  return c;
}

// ---------- functions that run INSIDE the browser (must be self-contained) ----------

/** Returns the raw text of each field. First VISIBLE element per class wins (hidden decoys are ignored). */
export function pageRead(c) {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const find = (cls) => (cls ? [...document.querySelectorAll('.' + CSS.escape(cls))].find(visible) || null : null);
  const text = (el) => {
    if (!el) return null;
    let t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) { // some layouts carry the value in an attribute instead of text
      for (const a of ['data-price', 'data-value', 'value', 'content', 'aria-label', 'title']) {
        const v = el.getAttribute(a);
        if (v && v.trim()) { t = v.trim(); break; }
      }
    }
    return t || null;
  };
  const status = document.querySelector('.price-status');
  return {
    sale: text(find(c.sale)),
    priceValue: text(find(c.priceValue)),
    mrp: text(find(c.mrp)),
    stock: text(find(c.stock)),
    seller: text(find(c.seller)),
    delivery: text(find(c.delivery)),
    rating: text(find(c.rating)),
    status: status ? status.textContent.trim() : null,
  };
}

/** True once a visible price element contains a digit. */
export function pageHasPrice(c) {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  for (const cls of [c.priceValue, c.sale]) {
    if (!cls) continue;
    const el = [...document.querySelectorAll('.' + CSS.escape(cls))].find(visible);
    if (el && /\d/.test((el.textContent || '') + Object.values(el.dataset || {}).join(''))) return true;
  }
  return false;
}

// ---------- Node-side helpers ----------

const cleanStr = (t) => String(t || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
const countNumbers = (t) => (cleanStr(t).match(/\d[\d,]*(?:\.\d+)?/g) || []).length;

/** Pick the CURRENT price. Never the MRP. Must contain exactly one number, otherwise we can't trust it. */
export function pickCurrent(raw) {
  // priceValue is the primary selling price element rendered by the store.
  // sale is checked as fallback (used when priceValue holds multi-part decoys in test suites).
  for (const key of ['priceValue', 'sale']) {
    if (raw[key] && looksLoaded(raw[key]) && countNumbers(raw[key]) === 1) return { key, text: raw[key] };
  }
  throw new ScrapeError('INVALID_DATA', `could not isolate one current price: sale="${raw.sale}" priceValue="${raw.priceValue}" status="${raw.status}"`);
}

/**
 * Click "Reveal". Simulates human mouse movement and dwell over .price-block to satisfy
 * the store's anti-bot requirement (Ar: minMoves: 8, minDwellMs: 600).
 * Handles the probabilistic click-dropping wrapper (Xn) by retrying clicks until loading starts.
 */
export async function revealPrice(page, log = () => {}) {
  const block = page.locator('.price-block').first();
  const hasBlock = await block.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false);
  if (!hasBlock) return false;

  await block.scrollIntoViewIfNeeded().catch(() => {});
  const box = await block.boundingBox();
  if (box) {
    // Dispatch mouse events smoothly to satisfy Ar anti-bot (minMoves: 8, minDwellMs: 600)
    const startX = box.x + 30;
    const startY = box.y + 25;
    await page.mouse.move(startX, startY).catch(() => {});
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(startX + i * 25, startY + (i % 2) * 10, { steps: 3 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 60));
    }
    // Dwell to satisfy minDwellMs: 600
    await new Promise((r) => setTimeout(r, 700));
  }

  // Click the reveal button. The store wraps onClick in Xn() which randomly drops or delays clicks.
  // We click until loading or a terminal price status appears.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const isAccepted = await page.evaluate(() => {
      const spinner = document.querySelector('.spinner, .price-block[aria-busy="true"]');
      const resolved = document.querySelector('.price-success, .price-error');
      const btn = document.querySelector('button.btn-primary');
      return !!(spinner || resolved || (btn && /try again|refresh/i.test(btn.textContent || '')));
    }).catch(() => false);

    if (isAccepted) {
      log('Reveal button accepted');
      return true;
    }

    const isReady = await page.evaluate(() => {
      const btn = document.querySelector('button.btn-primary');
      return btn && !btn.disabled && /reveal/i.test(btn.textContent || '');
    }).catch(() => false);

    if (isReady) {
      log(`Clicking Reveal button (attempt ${attempt})`);
      await page.click('button.btn-primary', { timeout: 3_000 }).catch(() => {});
      // Allow time for Xn potential 900ms delay or challenge initiation
      await new Promise((r) => setTimeout(r, 1_100));
    } else {
      // Wiggle cursor over price block to ensure enough moves are registered
      if (box) {
        await page.mouse.move(box.x + 50 + attempt * 12, box.y + 25, { steps: 3 }).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return true;
}

export async function waitForPrice(page, classes, timeoutMs) {
  try {
    const handle = await page.waitForFunction(
      (c) => {
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        for (const cls of [c.priceValue, c.sale]) {
          if (!cls) continue;
          const el = [...document.querySelectorAll('.' + CSS.escape(cls))].find(visible);
          if (el && /\d/.test((el.textContent || '') + Object.values(el.dataset || {}).join(''))) return { ok: true };
        }
        const err = document.querySelector('.price-error, .price-block.price-error');
        if (err && visible(err)) {
          return { error: (err.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) };
        }
        return false;
      },
      classes,
      { timeout: timeoutMs }
    );
    const result = await handle.jsonValue();
    if (result && result.error) {
      throw new ScrapeError('HTTP_ERROR', `Store failed to load price: ${result.error}`);
    }
  } catch (e) {
    if (e instanceof ScrapeError) throw e;
    const raw = await page.evaluate(pageRead, classes).catch(() => ({}));
    throw new ScrapeError(
      raw.status ? 'RENDER_TIMEOUT' : 'STRUCTURE_CHANGED',
      raw.status
        ? `price never appeared (page says: "${raw.status}")`
        : `no visible element for price class .${classes.priceValue}; page structure may have changed`
    );
  }
}
