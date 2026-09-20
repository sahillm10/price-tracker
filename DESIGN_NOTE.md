# Design Note: INE Product Price Tracker

## Architecture & Tool Choices

### Why Playwright vs Lightweight HTTP?
We adopted a hybrid approach that uses the most lightweight and reliable tool for each task:
* **Lightweight HTTP (`fetch` + JSON parsing)** is used for **Product Search and Catalog Discovery** (`backend/src/scraper/catalog.js`). The mock store provides a RESTful `/api/catalog` and `/api/product/:id` API that returns product listings and metadata directly. Using `fetch` with in-memory caching keeps search instant, avoids launching browser instances, and consumes negligible memory.
* **Playwright Chromium** is strictly required for **Price and Stock Extraction** (`backend/src/scraper/scrape.js`). Reverse-engineering the store's frontend bundle revealed why plain HTTP cannot extract prices:
  1. **Client-Side Hydration**: The initial HTML returned by `GET /product/:id` contains no price or stock figures (only empty placeholders).
  2. **Dynamic Class Generation**: On each page load, the frontend queries `/api/layout`, which returns randomized CSS class names (`pw-k2`, `pv-k2`, `sl-k2`, etc.) and variable DOM structures. Hardcoded CSS selectors cannot survive these shifts.
  3. **Behavioral Anti-Bot Verification (`Ar`)**: The price is initially hidden behind a "Reveal price" button. The store initializes a tracker `new Ar({ minMoves: 8, minDwellMs: 600 })`. Unless at least 8 mousemove events (spaced by ≥40ms) and 600ms of hover dwell time occur over the `.price-block`, the button remains disabled (`disabled: p !== null`).
  4. **Cryptographic Proof-of-Work Challenge**: When Reveal is clicked, the store fetches `/api/challenge`, computes a Proof-of-Work challenge using WebAssembly, POSTs to `/api/session` with the solution, and receives a bearer session token before finally requesting `/api/products/:id/price`.
  5. **De-obfuscation**: The price response payload is encrypted/XORed and decoded in the browser before rendering into dynamically split `<span>` elements separated by zero-width spaces (`\u200b`).

Only a genuine browser runtime executing the client-side JavaScript can satisfy these constraints.

---

## Scraping Reliability Strategy

1. **Anti-Bot Simulation & Click Robustness**:
   - The scraper scrolls `.price-block` into view and calculates its exact viewport coordinates.
   - It simulates natural human cursor sweeps across the element (disagreeing coordinates, spaced in time) to satisfy `minMoves: 8` and pauses for ≥700ms to fulfill `minDwellMs: 600`.
   - The store wraps the reveal click in `Xn()`, a probabilistic hurdle that silently drops 17.5% of clicks and delays 17.5% by 900ms. The scraper monitors the DOM and retries clicks if the button remains in an idle, un-triggered state.

2. **Wait for Terminal State, Not Sleep**:
   - The store often encounters temporary `upstream 429` errors during its internal session challenge and retries up to 6 times (`Retrying (attempt x/6)`).
   - The scraper actively waits for `.price-success` or `.price-error` using `page.waitForFunction` (capped at 25s) rather than arbitrary large sleeps, immediately proceeding the moment data settles.

3. **Selector Resilience & Priority**:
   - The scraper inspects the layout definition returned by `/api/layout` for the active page session.
   - `classes.priceValue` is prioritized as the primary price carrier element (`y`). `classes.sale` is treated as a secondary fallback because the store generates `classes.sale` as an artificial "Deal price" decoy when `m.triple` is active, or omits it entirely when `m.triple` is false.

4. **Zero-Width & Unicode Sanitization**:
   - The store formats prices with split character spans separated by zero-width spaces (`\u200b`) and occasionally uses fullwidth Unicode numerals (`０-９`).
   - `parsePrice` normalizes input via `String.prototype.normalize('NFKC')` and strips `[\u200B-\u200D\uFEFF]` before numeric extraction, guaranteeing numbers like `₹11,954` are never truncated to `1`.

5. **Bounded Retries with Exponential Backoff & Jitter**:
   - Failed attempts retry up to 4 times with exponential backoff (2s, 4s, 8s + random jitter).
   - If a `429 Too Many Requests` status is returned with a `retry-after` header, the backoff automatically respects the server's requested delay.
   - A fresh browser context is used per attempt to eliminate stale cookies, poisoned cache, or half-hydrated scripts.

6. **Error Isolation**:
   - In scheduled batch scrapes, each tracked product is processed in an independent `try/catch` block. Failure of Product A never terminates or blocks scraping for Product B or C.

7. **Classified Failure Logging**:
   - Failures are classified into machine-readable error codes (`RATE_LIMITED`, `HTTP_ERROR`, `TIMEOUT`, `RENDER_TIMEOUT`, `STRUCTURE_CHANGED`, `UNSTABLE`, `INVALID_DATA`, `NETWORK`).
   - Scrape logs record per-attempt millisecond durations, error messages, and raw extracted text.

---

## Scheduling Strategy

* **External Cron over `setInterval`**:
  Render free-tier instances enter sleep mode after 15 minutes of inactivity. An in-process `setInterval` would pause indefinitely while the instance sleeps.
* **Stateless Cron Triggers**:
  An external cron provider (such as cron-job.org) triggers `POST /api/scrape/run` every 2 hours.
* **Database-Driven Due-ness**:
  Due products are computed via Postgres (`last_attempt_at <= now() - interval_minutes`). A freshly awakened instance immediately queries the database to determine what requires scraping, losing no state across sleep or restarts.
* **Immediate 202 Response**:
  The cron endpoint replies with HTTP `202 Accepted` immediately, preventing external cron providers from timing out (cron-job.org has a ~30s timeout) while Playwright completes scrapes asynchronously.
* **Run Lock / Concurrency Guard**:
  An in-memory `running` mutex prevents concurrent runs if duplicate cron requests fire simultaneously.
* **Keep-Warm Target**:
  A lightweight `GET /health` endpoint can be pinged every 10 minutes to keep the Render free tier warm.

---

## Data Integrity: Never Store Wrong Data

* **Honest Historical Record**:
  `price_history` only ever receives validated readings (`price > 0`, valid stock enum). If scraping fails, **no record is added to `price_history`**, and `products.last_price` remains untouched at its last known verified value.
* **Visible Scrape Logs**:
  Failures are never hidden. Every attempt creates a record in `scrape_logs` with outcome `failed` and the exact error code, so operational visibility remains 100% transparent.
* **Crash Honesty**:
  Before scraping starts, a row is inserted into `scrape_logs` with status `running`. If the process crashes or Render restarts mid-run, `closeStaleRuns()` marks any orphaned `running` rows older than 10 minutes as `failed (INTERRUPTED)` on the subsequent run.

---

## What AI Tools Got Wrong Initially, and How We Corrected It

During early prototyping and analysis, AI tools made several incorrect assumptions about the mock store and environment:

1. **AI assumed standard button clicks would work:**
   - *What AI did*: Implemented `await page.click('button')` or `await btn.evaluate(el => el.click())`.
   - *Why it failed*: The store has a client-side anti-bot class `Ar({ minMoves: 8, minDwellMs: 600 })`. The button is rendered with `disabled={p !== null}` until at least 8 mouse moves and 600ms of hover dwell time are recorded over `.price-block`. Script clicks failed because the store explicitly checks `e.nativeEvent.isTrusted`.
   - *Correction*: Added simulated cursor movements across `.price-block` using Playwright's mouse API with coordinates derived from the element's bounding box, followed by dwell time, and used trusted user clicks.

2. **AI did not account for the probabilistic click dropper (`Xn`):**
   - *What AI did*: Clicked the reveal button once and immediately began waiting for the price.
   - *Why it failed*: Inspection of the store's React bundle revealed the button click was wrapped in `function Xn(e) { if (Math.random() < 0.35) { if (Math.random() < 0.5) return; window.setTimeout(e, 900); return; } e(); }`. Approximately 17.5% of clicks are completely dropped, and 17.5% are delayed by 900ms.
   - *Correction*: Implemented an active polling click loop in `revealPrice` that checks if the button remains enabled/idle and retries clicking until the loading phase or terminal price state is triggered.

3. **AI inverted price selector priority:**
   - *What AI did*: Checked `classes.sale` first and fell back to `classes.priceValue`.
   - *Why it failed*: In the store's JSX, `classes.priceValue` is the actual current selling price (`y`). `classes.sale` is an artificial decoy ("Deal price") rendered only when `m.triple` is enabled. When `m.triple` is false, `classes.sale` does not even exist in the DOM, causing `waitForPrice` to throw false `STRUCTURE_CHANGED` errors.
   - *Correction*: Prioritized `classes.priceValue` as the primary selling price element.

4. **AI used naive whitespace regex for price parsing:**
   - *What AI did*: Used `raw.replace(/\s/g, '').match(/\d[\d.,]*/)` to extract numbers.
   - *Why it failed*: The mock store splits numbers into individual `<span>` tags separated by zero-width spaces (`\u200b`) and sometimes outputs fullwidth Unicode digits (`０-９`). Standard JavaScript `\s` does not match `\u200b`, so `"₹\u200b1\u200b1\u200b,\u200b9\u200b5\u200b4"` matched only the first digit `1`.
   - *Correction*: Added `String.prototype.normalize('NFKC')` and `.replace(/[\u200B-\u200D\uFEFF]/g, '')`, correctly parsing all obfuscated variants.

5. **AI duplicated the Supabase REST URL path:**
   - *What AI did*: Passed `https://<id>.supabase.co/rest/v1/` directly into `createClient()`.
   - *Why it failed*: `@supabase/supabase-js` automatically appends `/rest/v1`, resulting in duplicate path requests (`/rest/v1/rest/v1/products`) that failed with PostgREST error `PGRST125`.
   - *Correction*: Sanitized `config.supabaseUrl` by trimming any trailing `/rest/v1/?$`.

6. **AI made an incorrect assumption about catalog pagination uniqueness:**
   - *What AI did*: Enforced `if (byId.size < first.total * 0.9) throw ScrapeError('catalog incomplete')`.
   - *Why it failed*: The mock store's `/api/catalog` repeats items across pages (1000 total records, but only ~649 unique products). This caused the catalog loader to throw an error on every search request.
   - *Correction*: Removed the false assertion, configured polite pagination with `pageSize=60` and small inter-batch delays to prevent HTTP 429 rate limiting.
