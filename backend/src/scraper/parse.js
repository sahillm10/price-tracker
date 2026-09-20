import { ScrapeError } from '../errors.js';

/** "$1,299.00" | "₹ 1,29,999" | "1.299,00 €" | "Rs. 499" -> { value: number, currency: string|null } */
export function parsePrice(text) {
  if (typeof text !== 'string') throw new ScrapeError('INVALID_DATA', 'price text missing');
  const raw = text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // strip zero-width spaces, joiners, BOM
    .replace(/\u00A0/g, ' ')               // normalize non-breaking spaces
    .trim();
  const currency = (raw.match(/[$€£₹¥]|USD|EUR|GBP|INR|Rs\.?/i) || [null])[0];
  const m = raw.replace(/\s/g, '').match(/\d[\d.,]*/);
  if (!m) throw new ScrapeError('INVALID_DATA', `no number in price text "${raw}"`);
  let s = m[0].replace(/[.,]$/, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    // whichever separator comes last is the decimal point
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma !== -1) {
    // "1,299" thousands vs "12,99" decimals
    s = /,\d{2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.split(',').join('');
  } else if (lastDot !== -1 && s.split('.').length > 2) {
    s = s.split('.').join(''); // "1.299.000"
  }
  const value = Number(s);
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) {
    throw new ScrapeError('INVALID_DATA', `implausible price "${raw}" -> ${value}`);
  }
  return { value: Math.round(value * 100) / 100, currency };
}

/** Maps free text to a fixed vocabulary. Unknown text is an error, never a guess. */
export function parseStock(text) {
  if (typeof text !== 'string' || !text.trim()) throw new ScrapeError('INVALID_DATA', 'stock text missing');
  const t = text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const qtyMatch = t.match(/(\d+)/);
  const qty = qtyMatch ? Number(qtyMatch[1]) : null;

  if (/out of stock|sold out|unavailable|not available|currently unavailable/.test(t) || qty === 0) {
    return { status: 'out_of_stock', qty: 0 };
  }

  const isUrgent = /only \d+|few left|hurry|low stock/.test(t);
  if ((qty !== null && qty <= 10) || (isUrgent && (qty === null || qty <= 20))) {
    return { status: 'low_stock', qty };
  }

  if (/in stock|available|ready to ship|selling fast|\d+ left|\d+ in stock/.test(t) || (qty !== null && qty > 0)) {
    return { status: 'in_stock', qty };
  }

  throw new ScrapeError('INVALID_DATA', `unrecognised stock text "${text.trim()}"`);
}

const PLACEHOLDER = /loading|please wait|\.\.\.|…|--|n\/a|tbd/i;
export const looksLoaded = (t) => typeof t === 'string' && t.trim().length > 0 && !PLACEHOLDER.test(t);
