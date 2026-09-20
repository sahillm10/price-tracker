import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { db, must } from './db.js';
import { searchStore, productInfo } from './scraper/catalog.js';
import { runDue, isRunning } from './scraper/runner.js';

const app = express();
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
app.use(express.json());

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(req.method, req.path, e);
  res.status(e.status || 500).json({ error: e.code ? `${e.code}: ${e.message}` : e.message });
});

// Keep-warm target for cron-job.org (ping every ~10 min) and Render health check.
app.get('/health', (_req, res) => res.json({ ok: true, scraping: isRunning(), time: new Date().toISOString() }));

// ---- search the mock store ----
app.get('/api/search', wrap(async (req, res) => res.json(await searchStore(String(req.query.q || '')))));

// ---- tracked products ----
app.get('/api/products', wrap(async (_req, res) => {
  const products = must(await db.from('products').select('*').order('created_at', { ascending: false }));
  // last 20 log outcomes per product for the reliability strip
  const logs = must(await db.from('scrape_logs').select('product_id,outcome,started_at')
    .in('product_id', products.map((p) => p.id)).order('started_at', { ascending: false }).limit(Math.max(20, products.length * 20)));
  const byProduct = {};
  for (const l of logs) (byProduct[l.product_id] ||= []).length < 20 && byProduct[l.product_id].push(l.outcome);
  res.json(products.map((p) => ({ ...p, recent_outcomes: (byProduct[p.id] || []).reverse() })));
}));

app.post('/api/products', wrap(async (req, res) => {
  const { externalId, name, url, imageUrl, intervalMinutes = 120 } = req.body || {};
  if (!externalId || !name || !url) return res.status(400).json({ error: 'externalId, name and url are required' });
  if (!String(url).startsWith(config.storeBaseUrl)) return res.status(400).json({ error: 'Only the INE mock store can be tracked' });
  const [row] = must(await db.from('products').upsert(
    { external_id: externalId, name, url, image_url: imageUrl || null, interval_minutes: Math.max(30, Number(intervalMinutes) || 120), active: true },
    { onConflict: 'external_id' }).select());
  runDue({ force: true, ids: [row.id] }).catch(console.error); // first data point right away
  res.status(201).json(row);
}));

app.patch('/api/products/:id', wrap(async (req, res) => {
  const patch = {};
  if (req.body.intervalMinutes != null) patch.interval_minutes = Math.max(30, Number(req.body.intervalMinutes));
  if (req.body.active != null) patch.active = !!req.body.active;
  res.json(must(await db.from('products').update(patch).eq('id', req.params.id).select())[0]);
}));

app.delete('/api/products/:id', wrap(async (req, res) => {
  must(await db.from('products').delete().eq('id', req.params.id));
  res.status(204).end();
}));

app.get('/api/products/:id/history', wrap(async (req, res) => {
  res.json(must(await db.from('price_history').select('price,currency,stock_status,stock_qty,scraped_at')
    .eq('product_id', req.params.id).order('scraped_at', { ascending: true }).limit(1000)));
}));

app.get('/api/products/:id/info', wrap(async (req, res) => {
  const [p] = must(await db.from('products').select('external_id').eq('id', req.params.id));
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(await productInfo(p.external_id));
}));

app.get('/api/products/:id/logs', wrap(async (req, res) => {
  res.json(must(await db.from('scrape_logs').select('id,started_at,finished_at,outcome,attempts,price,error_code,error,detail')
    .eq('product_id', req.params.id).order('started_at', { ascending: false }).limit(100)));
}));

app.post('/api/products/:id/scrape', wrap(async (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'A scrape run is already in progress' });
  runDue({ force: true, ids: [req.params.id] }).catch(console.error);
  res.status(202).json({ started: true });
}));

// ---- scheduled scraping endpoints (called by cron-job.org every 2h) ----
// Responds 202 immediately (preventing cron timeouts) and executes the scrape job in the background.
// Protected by CRON_SECRET via either Authorization: Bearer <secret> or x-cron-secret header.
const authCron = (req) => {
  if (!config.cronSecret) return true; // dev default if unset
  const headerSecret = req.get('x-cron-secret');
  const authHeader = req.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return headerSecret === config.cronSecret || bearerToken === config.cronSecret;
};

const handleCronRun = (req, res) => {
  if (!authCron(req)) return res.status(401).json({ error: 'unauthorized: valid CRON_SECRET required' });
  if (isRunning()) return res.status(202).json({ started: false, reason: 'already running' });
  const force = req.query.force === 'true' || req.body?.force === true;
  runDue({ force })
    .then((s) => console.log('scheduled scrape finished:', JSON.stringify(s)))
    .catch((e) => console.error('scheduled scrape failed:', e));
  res.status(202).json({ started: true, forced: force });
};

app.post('/api/scrape/run', handleCronRun);
app.post('/api/cron/scrape', handleCronRun);

app.listen(config.port, () => console.log(`API on :${config.port} (headed=${config.headed}, chaos=${config.chaos})`));
