import { db, must } from '../db.js';
import { config } from '../config.js';
import { scrapeProductPage } from './scrape.js';

let running = false;
export const isRunning = () => running;

/** A 'running' row that outlived its process (crash / Render restart) is closed out honestly as failed. */
async function closeStaleRuns() {
  const cutoff = new Date(Date.now() - config.scrape.staleRunMs).toISOString();
  must(await db.from('scrape_logs').update({
    outcome: 'failed', error_code: 'INTERRUPTED', error: 'Run was interrupted before finishing (process restart or crash)',
    finished_at: new Date().toISOString(),
  }).eq('outcome', 'running').lt('started_at', cutoff));
}

/** Scrape one tracked product and record the outcome. Bad data is NEVER written to price_history. */
export async function scrapeAndRecord(product) {
  const started = new Date().toISOString();
  const [logRow] = must(await db.from('scrape_logs').insert({ product_id: product.id, started_at: started }).select('id'));
  const result = await scrapeProductPage(product.url);
  const finished = new Date().toISOString();
  const detail = { attempts: result.attempts };

  if (result.ok) {
    const d = result.data;
    detail.extra = d.extra; detail.layout = d.layout; detail.raw = d.raw;
    // Sanity flag (not a rejection - the store legitimately changes prices often).
    if (product.last_price && Math.abs(d.price - product.last_price) / product.last_price > 0.5) {
      detail.note = `large change vs previous (${product.last_price} -> ${d.price})`;
    }
    must(await db.from('price_history').insert({
      product_id: product.id, price: d.price, currency: d.currency, stock_status: d.stockStatus, stock_qty: d.stockQty, scraped_at: finished,
    }));
    const outcome = result.attempts.length > 1 ? 'retried' : 'success';
    must(await db.from('scrape_logs').update({
      outcome, attempts: result.attempts.length, price: d.price, finished_at: finished, detail,
    }).eq('id', logRow.id));
    must(await db.from('products').update({
      last_price: d.price, last_stock: d.stockStatus, last_success_at: finished, last_attempt_at: finished, last_status: outcome,
    }).eq('id', product.id));
    return { id: product.id, outcome, price: d.price };
  }

  must(await db.from('scrape_logs').update({
    outcome: 'failed', attempts: result.attempts.length, finished_at: finished,
    error_code: result.error?.code || 'ERROR', error: String(result.error?.message || 'unknown').slice(0, 500), detail,
  }).eq('id', logRow.id));
  // last_price/last_stock deliberately untouched: the dashboard keeps showing the last VERIFIED values.
  must(await db.from('products').update({ last_attempt_at: finished, last_status: 'failed' }).eq('id', product.id));
  return { id: product.id, outcome: 'failed', error: result.error?.code };
}

const isDue = (p, now) => !p.last_attempt_at ||
  now - new Date(p.last_attempt_at).getTime() >= p.interval_minutes * 60_000 - config.scrape.dueSlackMs;

/** Called by cron. State lives in the DB, so a sleeping/restarted instance loses nothing. */
export async function runDue({ force = false, ids = null } = {}) {
  if (running) return { skipped: 'already running' };
  running = true;
  const summary = [];
  try {
    await closeStaleRuns();
    let q = db.from('products').select('*').eq('active', true);
    if (ids) q = q.in('id', ids);
    const products = must(await q);
    const now = Date.now();
    for (const p of products.filter((p) => force || isDue(p, now))) {
      try { summary.push(await scrapeAndRecord(p)); }
      catch (e) { summary.push({ id: p.id, outcome: 'error', error: e.message }); console.error('runner error', p.id, e); }
    }
    return { ran: summary.length, summary };
  } finally { running = false; }
}
