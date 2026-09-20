import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parseStock, looksLoaded } from './parse.js';

test('parsePrice handles common formats', () => {
  assert.deepEqual(parsePrice('$1,299.00'), { value: 1299, currency: '$' });
  assert.equal(parsePrice('₹ 1,29,999').value, 129999);
  assert.equal(parsePrice('1.299,50 €').value, 1299.5);
  assert.equal(parsePrice('12,99').value, 12.99);
  assert.equal(parsePrice('Price: $49').value, 49);
});
test('parsePrice handles mock store zero-width spaces and unicode digits', () => {
  // Mock store split carrier injects \u200b
  assert.deepEqual(parsePrice('₹\u200b1\u200b1\u200b,\u200b9\u200b5\u200b4'), { value: 11954, currency: '₹' });
  // Mock store fullwidth digits
  assert.equal(parsePrice('₹１１，９５４').value, 11954);
  // Trailing tax notes
  assert.equal(parsePrice('₹18,304/- (incl. of all taxes)').value, 18304);
  // Spaced thousands
  assert.equal(parsePrice('Rs. 18 304.00').value, 18304);
});
test('parsePrice rejects junk instead of guessing', () => {
  for (const bad of ['', 'Loading...', '$0.00', 'N/A', null]) assert.throws(() => parsePrice(bad));
});
test('parseStock maps to fixed vocabulary', () => {
  assert.equal(parseStock('In Stock').status, 'in_stock');
  assert.equal(parseStock('Out of stock').status, 'out_of_stock');
  assert.deepEqual(parseStock('Only 3 left!'), { status: 'low_stock', qty: 3 });
  assert.deepEqual(parseStock('In stock · 142 left'), { status: 'in_stock', qty: 142 });
  assert.deepEqual(parseStock('Selling fast — 85 left'), { status: 'in_stock', qty: 85 });
  assert.deepEqual(parseStock('Hurry, just 4 left'), { status: 'low_stock', qty: 4 });
  assert.throws(() => parseStock('???'));
  assert.throws(() => parseStock(''));
});
test('looksLoaded flags placeholders', () => {
  assert.equal(looksLoaded('Loading...'), false);
  assert.equal(looksLoaded('$10.00'), true);
});
