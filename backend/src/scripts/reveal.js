import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] || 'https://demo.inelabteamdev.com/product/408';
fs.mkdirSync('discovery', { recursive: true });
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

page.on('request', (r) => {
  if (['xhr', 'fetch'].includes(r.resourceType())) console.log(at(), 'REQ', r.method(), r.url());
});
page.on('response', async (res) => {
  if (!['xhr', 'fetch'].includes(res.request().resourceType())) return;
  if (res.url().includes('/api/product/')) { console.log(at(), 'RES', res.status(), res.url(), '(skipped)'); return; }
  let body = '';
  try { body = (await res.text()).replace(/\s+/g, ' ').slice(0, 1500); } catch {}
  console.log(at(), 'RES', res.status(), res.url(), '\n     ', body);
});
page.on('requestfailed', (r) => console.log(at(), 'FAILED', r.url(), r.failure()?.errorText));

await page.goto(url, { waitUntil: 'domcontentloaded' });
console.log('\n>>> Page is open. Click "Reveal", wait a few seconds, then click "Refresh price" twice. Script ends in 60s.\n');
try {
  await page.waitForTimeout(60000);
  const html = await page.evaluate(() => document.querySelector('#root').innerHTML);
  fs.writeFileSync('discovery/after-reveal.html', html);
  console.log('\n===== PAGE HTML =====\n' + html.replace(/\s+/g, ' ').slice(0, 9000));
} catch {
  console.log('(window closed early - the network log above is what matters)');
}
await browser.close().catch(() => {});