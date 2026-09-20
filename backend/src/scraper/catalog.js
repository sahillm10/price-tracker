// Product search uses the store's own JSON API - no browser needed.
import { config } from '../config.js';
import { ScrapeError } from '../errors.js';
import { withRetries } from './retry.js';

export async function getJson(path) {
  const r = await withRetries(async () => {
    let res;
    try {
      res = await fetch(config.storeBaseUrl + path, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    } catch (e) {
      throw new ScrapeError(e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', String(e.message));
    }
    if (res.status === 429) {
      const retryHeader = res.headers.get('retry-after');
      let retryAfterMs = 1500;
      if (retryHeader) {
        const parsed = Number(retryHeader);
        if (Number.isFinite(parsed) && parsed > 0) retryAfterMs = parsed * 1000;
      }
      throw new ScrapeError('RATE_LIMITED', `HTTP 429 for ${path}`, { retryAfterMs });
    }
    if (!res.ok) throw new ScrapeError('HTTP_ERROR', `HTTP ${res.status} for ${path}`);
    try { return await res.json(); } catch { throw new ScrapeError('INVALID_DATA', `bad JSON from ${path}`); }
  }, { maxAttempts: 5 });
  if (!r.ok) throw r.error;
  return r.value;
}

let cache = { at: 0, items: [] };
const TTL_MS = 15 * 60_000;

async function loadCatalog() {
  const PAGE_SIZE = 60;
  const first = await getJson(`/api/catalog?page=1&pageSize=${PAGE_SIZE}`);
  const all = [...(first.items || [])];
  const totalPages = Math.min(first.pages || 1, 25);
  const rest = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2);
  for (let i = 0; i < rest.length; i += 2) { // 2 at a time with polite spacing
    const batch = await Promise.all(rest.slice(i, i + 2).map((p) => getJson(`/api/catalog?page=${p}&pageSize=${PAGE_SIZE}`)));
    batch.forEach((b) => all.push(...(b.items || [])));
    await new Promise((r) => setTimeout(r, 200));
  }
  const byId = new Map(all.map((p) => [p.id, p]));
  if (byId.size === 0) throw new ScrapeError('INVALID_DATA', 'catalog is empty');
  return [...byId.values()].map((p) => ({
    externalId: String(p.id), name: p.name, brand: p.brand, category: p.category, sku: p.sku,
    url: `${config.storeBaseUrl}/product/${p.id}`, imageUrl: null,
  }));
}

export async function searchStore(q, limit = 50) {
  if (Date.now() - cache.at > TTL_MS || !cache.items.length) {
    try { cache = { at: Date.now(), items: await loadCatalog() }; }
    catch (e) { if (!cache.items.length) throw e; /* stale results beat an error for search */ }
  }
  const needle = (q || '').trim().toLowerCase();
  const hits = needle
    ? cache.items.filter((p) => [p.name, p.brand, p.category, p.sku].some((f) => f?.toLowerCase().includes(needle)))
    : cache.items;
  return hits.slice(0, limit);
}

// Extra info (specs, reviews) for the product page of the dashboard.
const infoCache = new Map();
export async function productInfo(externalId) {
  const hit = infoCache.get(externalId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = await getJson(`/api/product/${encodeURIComponent(externalId)}`);
  infoCache.set(externalId, { at: Date.now(), data });
  return data;
}
