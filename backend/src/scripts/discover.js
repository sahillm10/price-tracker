// Step 1 of the project: learn how the store actually works.
//   npm run discover -- https://demo.inelabteamdev.com/            (listing)
//   npm run discover -- <a product page url>                       (detail)
// Prints: what's in the raw HTML vs. after JS, every XHR/fetch JSON call, and candidate price/stock elements.
// Output is also saved to ./discovery/ - paste the console output back to the assistant to fill in the adapter.
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] || 'https://demo.inelabteamdev.com/';
fs.mkdirSync('discovery', { recursive: true });

const raw = await fetch(url).then((r) => r.text()).catch((e) => `FETCH FAILED: ${e.message}`);
console.log(`\n== 1. RAW HTTP HTML (no JS): ${raw.length} chars`);
console.log(raw.slice(0, 600).replace(/\s+/g, ' '));
fs.writeFileSync('discovery/raw.html', raw);

const browser = await chromium.launch({ headless: false, slowMo: 100 });
const page = await browser.newPage();
const calls = [];
page.on('response', async (res) => {
  const req = res.request();
  if (!['xhr', 'fetch'].includes(req.resourceType())) return;
  let body = '';
  try { body = (await res.text()).slice(0, 400).replace(/\s+/g, ' '); } catch {}
  calls.push({ method: req.method(), status: res.status(), url: res.url(), body });
});
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
console.log('\n== 2. Watching for async content (10s)...');
await page.waitForTimeout(10_000);
console.log(`   (finished ${Date.now() - t0}ms after navigation)`);

console.log(`\n== 3. XHR/fetch calls: ${calls.length}`);
calls.forEach((c) => console.log(`  ${c.method} ${c.status} ${c.url}\n     ${c.body}`));

const rendered = await page.content();
fs.writeFileSync('discovery/rendered.html', rendered);
await page.screenshot({ path: 'discovery/page.png', fullPage: true });
console.log(`\n== 4. Rendered HTML: ${rendered.length} chars (saved discovery/rendered.html, page.png)`);

const cands = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('[class*="price" i],[class*="stock" i],[class*="product" i],[data-testid],[id*="price" i],[id*="stock" i]').forEach((el) => {
    if (out.length < 40) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ''}  =>  "${(el.textContent || '').trim().slice(0, 60).replace(/\s+/g, ' ')}"`);
  });
  return out;
});
console.log('\n== 5. Candidate elements');
cands.forEach((c) => console.log('  ' + c));
console.log('\nBrowser stays open 15s so you can inspect it in DevTools...');
await page.waitForTimeout(15_000);
await browser.close();
