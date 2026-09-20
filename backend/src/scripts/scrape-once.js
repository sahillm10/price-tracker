// Dry run of the full scrape pipeline against one product URL - no database needed.
//   npm run scrape:dry -- <product-url>
//   npm run scrape:headed -- <product-url>     (visible browser + injected slow/failing responses)
import { scrapeProductPage } from '../scraper/scrape.js';
import { closeBrowser } from '../scraper/browser.js';
import { config } from '../config.js';

// Cross-platform support for flags as well as environment variables
if (process.argv.includes('--headed')) config.headed = true;
if (process.argv.includes('--chaos')) config.chaos = true;
if (process.argv.includes('--no-chaos')) config.chaos = false;

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = args[0];
if (!url) {
  console.error('usage: npm run scrape:dry -- <product-url>');
  console.error('       npm run scrape:headed -- <product-url>');
  process.exit(1);
}
console.log(`headed=${config.headed} chaos=${config.chaos}`);
const t = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);

const runs = Number(process.env.RUNS || 1);
for (let i = 1; i <= runs; i++) {
  t(`--- run ${i}/${runs} ---`);
  const r = await scrapeProductPage(url, { log: t });
  if (r.ok) t(`RESULT ${r.attempts.length > 1 ? 'retried' : 'success'}: ${JSON.stringify(r.data)}`);
  else t(`RESULT failed after ${r.attempts.length} attempts: [${r.error?.code}] ${r.error?.message}  (nothing would be stored)`);
}
await closeBrowser();
