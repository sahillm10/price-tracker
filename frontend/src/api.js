const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

async function req(path, opts = {}, retries = 2) {
  // Render's free tier sleeps: the first request can take ~50s and may fail once while it wakes up.
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
      if (res.status === 204) return null;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    } catch (e) {
      if (i >= retries || e.message.startsWith('HTTP 4')) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

export const api = {
  search: (q) => req(`/api/search?q=${encodeURIComponent(q)}`),
  products: () => req('/api/products'),
  track: (p, intervalMinutes = 120) => req('/api/products', { method: 'POST', body: JSON.stringify({ ...p, intervalMinutes }) }),
  update: (id, patch) => req(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  untrack: (id) => req(`/api/products/${id}`, { method: 'DELETE' }),
  history: (id) => req(`/api/products/${id}/history`),
  info: (id) => req(`/api/products/${id}/info`),
  logs: (id) => req(`/api/products/${id}/logs`),
  scrapeNow: (id) => req(`/api/products/${id}/scrape`, { method: 'POST' }),
};
