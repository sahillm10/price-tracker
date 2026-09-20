import { Fragment, useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { api } from './api.js';

const fmtMoney = (n) => (n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n));
const fmtTime = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
const STOCK = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock' };
const INTERVALS = [[120, 'Every 2 hours'], [240, 'Every 4 hours'], [720, 'Every 12 hours'], [1440, 'Daily']];
const CAT_ICONS = {
  Audio: '🎧',
  Laptops: '💻',
  Footwear: '👟',
  Wearables: '⌚',
  Electronics: '⚡',
  Accessories: '🎒',
  Default: '📦',
};

function Outcomes({ list = [] }) {
  return (
    <span className="ticks" aria-label={`Last ${list.length} scrapes`}>
      {list.length === 0 && <em className="muted">no runs yet</em>}
      {list.map((o, i) => <i key={i} className={`tick ${o}`} title={o} />)}
    </span>
  );
}
const Stock = ({ s }) => <span className={`chip ${s || 'none'}`}>{STOCK[s] || 'Unknown'}</span>;

function useAsync(fn, deps) {
  const [state, set] = useState({ loading: true, data: null, error: null });
  const run = useCallback(() => {
    set((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => set({ loading: false, data, error: null }), (error) => set({ loading: false, data: null, error }));
  }, deps); // eslint-disable-line
  useEffect(run, [run]);
  return { ...state, reload: run };
}

function Tracked({ open }) {
  const { loading, data, error, reload } = useAsync(() => api.products(), []);
  useEffect(() => { const t = setInterval(reload, 30000); return () => clearInterval(t); }, [reload]);
  if (loading && !data) return <p className="note">Loading tracked products… the server may take up to a minute to wake up.</p>;
  if (error) return <p className="note bad">Couldn't load products: {error.message} <button className="link" onClick={reload}>Try again</button></p>;
  if (!data.length) return <p className="note">Nothing tracked yet. Use <b>Find products</b> to pick one.</p>;
  return (
    <div className="table-wrap">
      <table className="rows">
        <thead><tr><th>Product</th><th className="num">Price</th><th>Stock</th><th>Last 20 scrapes</th><th>Last success</th></tr></thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.id} onClick={() => open(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(p.id)}>
              <td className="name">{p.name}{!p.active && <span className="chip none">paused</span>}</td>
              <td className="num">{fmtMoney(p.last_price)}</td>
              <td><Stock s={p.last_stock} /></td>
              <td><Outcomes list={p.recent_outcomes} /></td>
              <td className="muted">{fmtTime(p.last_success_at)}{p.last_status === 'failed' && <span className="chip failed">last run failed</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Find({ done }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ status: 'idle', items: [], error: null });
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    const t = setTimeout(() => api.search(q).then((items) => setState({ status: 'ok', items, error: null }),
      (error) => setState({ status: 'error', items: [], error })), 300);
    return () => clearTimeout(t);
  }, [q]);
  const track = async (p) => { setBusy(p.externalId); try { await api.track(p); done(); } catch (e) { alert(e.message); } finally { setBusy(null); } };
  return (
    <>
      <input className="search" autoFocus placeholder="Search the store by product name" value={q} onChange={(e) => setQ(e.target.value)} />
      {state.status === 'loading' && <p className="note">Searching…</p>}
      {state.status === 'error' && <p className="note bad">Search failed: {state.error.message}</p>}
      {state.status === 'ok' && state.items.length === 0 && <p className="note">No products match “{q}”.</p>}
      <ul className="results">
        {state.items.map((p) => (
          <li key={p.externalId}>
            {p.imageUrl ? (
              <img src={p.imageUrl} alt="" loading="lazy" />
            ) : (
              <span className="cat-icon-badge" title={p.category || 'Product'} aria-hidden="true">
                {CAT_ICONS[p.category] || CAT_ICONS.Default}
              </span>
            )}
            <div><b>{p.name}</b><span className="muted">{[p.brand, p.category, p.sku].filter(Boolean).join(' · ')}</span></div>
            <button disabled={busy === p.externalId} onClick={() => track(p)}>{busy === p.externalId ? 'Adding…' : 'Track'}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Info({ info, logs }) {
  if (info.loading) return <p className="note small">Loading product details…</p>;
  if (info.error || !info.data) return <p className="note small">Product details are unavailable right now.</p>;
  const d = info.data;
  const latest = (logs || []).find((l) => l.detail?.extra);
  const ex = latest?.detail?.extra || {};
  const reviews = d.reviews || [];
  const avg = reviews.length ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1) : null;
  return (
    <section className="info">
      <dl>
        <div><dt>Brand</dt><dd>{d.brand}</dd></div>
        <div><dt>Category</dt><dd>{d.category}</dd></div>
        <div><dt>SKU</dt><dd>{d.sku}</dd></div>
        {ex.mrp != null && <div><dt>List price (MRP)</dt><dd>{fmtMoney(ex.mrp)}</dd></div>}
        {ex.seller && <div><dt>Seller</dt><dd>{ex.seller.replace(/^Sold by\s*/i, '')}</dd></div>}
        {ex.delivery && <div><dt>Delivery</dt><dd>{ex.delivery.replace(/^Get it by\s*/i, '')}</dd></div>}
        {avg && <div><dt>Reviews</dt><dd>{avg} / 5 from {reviews.length}</dd></div>}
      </dl>
      {d.specs && (
        <details>
          <summary>Specifications</summary>
          <dl className="specs">{Object.entries(d.specs).map(([k, v]) => <div key={k}><dt>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd>{String(v)}</dd></div>)}</dl>
        </details>
      )}
    </section>
  );
}

function Detail({ id, back }) {
  const prods = useAsync(() => api.products(), [id]);
  const hist = useAsync(() => api.history(id), [id]);
  const logs = useAsync(() => api.logs(id), [id]);
  const info = useAsync(() => api.info(id), [id]);
  const [tab, setTab] = useState('history');
  const [expanded, setExpanded] = useState(null);
  const p = prods.data?.find((x) => x.id === id);
  const refresh = () => { prods.reload(); hist.reload(); logs.reload(); };
  if (!p) return <p className="note">{prods.loading ? 'Loading…' : 'Product not found.'} <button className="link" onClick={back}>Back</button></p>;

  const points = (hist.data || []).map((h) => ({ t: new Date(h.scraped_at).getTime(), price: Number(h.price) }));
  const scrapeNow = async () => { try { await api.scrapeNow(id); setTimeout(refresh, 8000); alert('Scrape started. Results appear here in a few seconds.'); } catch (e) { alert(e.message); } };
  const untrack = async () => { if (confirm('Stop tracking and delete its history?')) { await api.untrack(id); back(); } };

  return (
    <>
      <button className="link" onClick={back}>‹ All tracked products</button>
      <header className="detail-head">
        <div>
          <h2>{p.name}</h2>
          <p className="muted"><a href={p.url} target="_blank" rel="noreferrer">Open in store</a> · tracking since {fmtTime(p.created_at)}</p>
        </div>
        <div className="big"><span>{fmtMoney(p.last_price)}</span><Stock s={p.last_stock} /></div>
      </header>
      <div className="controls">
        <label>Scrape frequency
          <select value={p.interval_minutes} onChange={async (e) => { await api.update(id, { intervalMinutes: Number(e.target.value) }); refresh(); }}>
            {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button onClick={scrapeNow}>Scrape now</button>
        <button className="ghost" onClick={async () => { await api.update(id, { active: !p.active }); refresh(); }}>{p.active ? 'Pause' : 'Resume'}</button>
        <button className="ghost danger" onClick={untrack}>Stop tracking</button>
      </div>

      <Info info={info} logs={logs.data} />

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>Price & stock history</button>
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Scrape log ({logs.data?.length ?? '…'})</button>
      </div>

      {tab === 'history' && (
        <>
          <p className="note small">Only verified readings appear here. Failed scrapes are in the scrape log and never create a data point.</p>
          {points.length === 0 ? <p className="note">No successful scrape yet.</p> : (
            <div className="chart">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={points} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke="#DCE0DA" vertical={false} />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })} tick={{ fontSize: 12 }} />
                  <YAxis domain={['auto', 'auto']} tickFormatter={(v) => `₹${v}`} width={56} tick={{ fontSize: 12 }} />
                  <Tooltip labelFormatter={(t) => fmtTime(t)} formatter={(v) => [fmtMoney(v), 'Price']} />
                  <Line type="stepAfter" dataKey="price" stroke="#0E6B5C" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="table-wrap"><table className="rows plain">
            <thead><tr><th>Time</th><th className="num">Price</th><th>Stock</th></tr></thead>
            <tbody>{[...(hist.data || [])].reverse().map((h, i) => (
              <tr key={i}><td>{fmtTime(h.scraped_at)}</td><td className="num">{fmtMoney(Number(h.price))}</td><td><Stock s={h.stock_status} />{h.stock_qty != null && h.stock_status !== 'out_of_stock' ? <span className="muted"> {h.stock_qty} units</span> : null}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}

      {tab === 'log' && (
        <div className="table-wrap"><table className="rows plain">
          <thead><tr><th>Timestamp</th><th>Status</th><th className="num">Price</th><th>Stock</th><th className="num">Duration</th><th className="num">Attempts</th><th>Detail</th></tr></thead>
          <tbody>{(logs.data || []).map((l) => {
            const duration = l.finished_at && l.started_at
              ? `${Math.max(0.1, (new Date(l.finished_at) - new Date(l.started_at)) / 1000).toFixed(1)}s`
              : (l.detail?.attempts?.length
                  ? `${Math.max(0.1, l.detail.attempts.reduce((s, a) => s + (a.ms || 0), 0) / 1000).toFixed(1)}s`
                  : '—');
            const stockDisplay = l.detail?.raw?.stock
              ? l.detail.raw.stock
              : (l.outcome === 'failed' ? '—' : 'In stock');

            return (
              <Fragment key={l.id}>
                <tr onClick={() => setExpanded(expanded === l.id ? null : l.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setExpanded(expanded === l.id ? null : l.id)}>
                  <td>{fmtTime(l.started_at)}</td>
                  <td><span className={`chip ${l.outcome}`}>{l.outcome.toUpperCase()}</span></td>
                  <td className="num">{l.price != null ? fmtMoney(Number(l.price)) : '—'}</td>
                  <td><span className="small">{stockDisplay}</span></td>
                  <td className="num muted">{duration}</td>
                  <td className="num">{l.attempts}</td>
                  <td className="muted">{l.outcome === 'failed' ? `${l.error_code || 'FAILED'}: ${l.error || 'View details'}` : (l.detail?.note || 'Verified scrape')}</td>
                </tr>
                {expanded === l.id && (
                  <tr className="expand"><td colSpan={7}>
                    {(l.detail?.attempts || []).map((a) => (
                      <div key={a.n}>Attempt {a.n}: {a.ok ? 'ok' : <b className="bad">{a.code}</b>} in {a.ms} ms{a.message ? ` — ${a.message}` : ''}</div>
                    ))}
                    {l.detail?.note && <div className="muted">Note: {l.detail.note}</div>}
                    {l.detail?.raw && <div className="muted small">Raw extracted: {JSON.stringify(l.detail.raw)}</div>}
                  </td></tr>
                )}
              </Fragment>
            );
          })}</tbody>
        </table></div>
      )}
    </>
  );
}

export default function App() {
  const [view, setView] = useState({ name: 'tracked' });
  return (
    <div className="shell">
      <nav>
        <b className="brand">Shelfwatch</b>
        <button aria-current={view.name !== 'find'} onClick={() => setView({ name: 'tracked' })}>Tracked</button>
        <button aria-current={view.name === 'find'} onClick={() => setView({ name: 'find' })}>Find products</button>
      </nav>
      <main>
        {view.name === 'tracked' && <><h1>Tracked products</h1><Tracked open={(id) => setView({ name: 'detail', id })} /></>}
        {view.name === 'find' && <><h1>Find products</h1><Find done={() => setView({ name: 'tracked' })} /></>}
        {view.name === 'detail' && <Detail id={view.id} back={() => setView({ name: 'tracked' })} />}
      </main>
    </div>
  );
}
