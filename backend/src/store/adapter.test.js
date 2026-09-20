import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCurrent, validateLayout } from './adapter.js';

test('pickCurrent prefers the sale price and ignores the MRP', () => {
  assert.equal(pickCurrent({ sale: '₹9,731', priceValue: '₹11,058 ₹9,731 20% off', mrp: '₹11,058' }).text, '₹9,731');
});
test('pickCurrent falls back to priceValue only if it holds a single number', () => {
  assert.equal(pickCurrent({ sale: null, priceValue: '₹9,731' }).key, 'priceValue');
});
test('pickCurrent refuses ambiguous or placeholder text instead of guessing', () => {
  assert.throws(() => pickCurrent({ sale: '₹11,058 ₹9,731', priceValue: null }));
  assert.throws(() => pickCurrent({ sale: 'Loading...', priceValue: null }));
  assert.throws(() => pickCurrent({ sale: null, priceValue: null, status: 'Price hidden' }));
});
test('validateLayout accepts the real shape and rejects a changed one', () => {
  const ok = { classes: { priceValue: 'pv-q9', sale: 'sl-q9', mrp: 'mr-q9', stock: 'st-q9' } };
  assert.equal(validateLayout(ok).stock, 'st-q9');
  assert.throws(() => validateLayout({ classes: {} }), /unexpected/);
  assert.throws(() => validateLayout(null));
});
