# Shelfwatch – Product Price & Stock Tracker

A reliable full-stack web application that tracks products from the INE mock storefront ([https://demo.inelabteamdev.com/](https://demo.inelabteamdev.com/)), automatically scrapes current price and stock on a 2-hour schedule, stores historical records in Supabase PostgreSQL, and provides a per-product dashboard with price history charts and scrape attempt logs.

---

## Architecture & Data Flow

```
[React + Vite Frontend] (Vercel)
         │  HTTP / JSON
         ▼
[Express REST API] (Render Docker + Playwright Chromium)
   │               │
   │ Scrapes       ▼
   │          [Supabase PostgreSQL]
   │          - products
   │          - price_history (verified readings only)
   │          - scrape_logs (every attempt, success, retry & failure)
   ▼
[INE Mock Storefront]
- /api/catalog (HTTP fetch for search)
- /product/:id (Playwright browser for client-rendered dynamic price & stock)
         ▲
         │ Every 2 hours (POST /api/scrape/run)
[cron-job.org]
```

---

## Tech Stack

* **Frontend**: React 18, Vite, Recharts, CSS3
* **Backend**: Node.js (ESM), Express 4, Playwright Chromium
* **Database**: Supabase PostgreSQL (with Row Level Security & check constraints)
* **Scheduling**: External cron service (cron-job.org) triggering `POST /api/scrape/run`
* **Deployments**: Vercel (Frontend), Render (Backend Docker Web Service), Supabase (Database)

---

## Key Features

1. **Product Search**: Search products in real time by partial or full name (e.g., "water", "bottle", "Meridian Water Bottle Plus"), category, or brand with lightweight HTTP fetch and in-memory caching.
2. **Product Tracking**: Track any product from the mock store with immediate initial scrape execution.
3. **Price & Stock Scraping**: Handles the mock store's client-side hydration, randomized layout classes, anti-bot mouse movement requirements, Proof-of-Work challenges, zero-width space price obfuscation, and upstream 429 retries.
4. **Price & Stock History**: Visualized as an interactive time-series chart and reverse-chronological data table.
5. **Per-Product Scrape Log**: Full observability table displaying Timestamp, Status (`SUCCESS`, `RETRIED`, `FAILED`), Price, Stock, Duration, Attempts, and expandable attempt-by-attempt diagnostic details.
6. **Headed Playwright Mode**: Visually observe Chromium navigating to the store, hovering over the price block, clicking reveal, and extracting data. Optional chaos mode demonstrates automated retries and exponential backoff under simulated HTTP 503s and 8s network delays.
7. **External 2-Hour Scheduling**: Secure `POST /api/scrape/run` endpoint protected by `CRON_SECRET` with concurrency overlap guards and database-derived execution due-ness.

---

## Database Schema

Run in the Supabase SQL Editor (`supabase/schema.sql`):

```sql
create extension if not exists "pgcrypto";

-- Tracked products table
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  external_id      text not null unique,
  name             text not null,
  url              text not null,
  image_url        text,
  interval_minutes int not null default 120 check (interval_minutes >= 30),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  last_price       numeric(12,2),
  last_stock       text,
  last_success_at  timestamptz,
  last_attempt_at  timestamptz,
  last_status      text
);

-- Historical price & stock records (ONLY VERIFIED DATA IS STORED)
create table if not exists price_history (
  id           bigserial primary key,
  product_id   uuid not null references products(id) on delete cascade,
  price        numeric(12,2) not null check (price > 0),
  currency     text,
  stock_status text not null check (stock_status in ('in_stock','low_stock','out_of_stock')),
  stock_qty    int,
  scraped_at   timestamptz not null default now()
);
create index if not exists price_history_product_time on price_history(product_id, scraped_at desc);

-- Per-product scrape attempt log (including retries, duration, and failures)
create table if not exists scrape_logs (
  id          bigserial primary key,
  product_id  uuid not null references products(id) on delete cascade,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  outcome     text not null default 'running' check (outcome in ('running','success','retried','failed')),
  attempts    int not null default 0,
  price       numeric(12,2),
  error_code  text,
  error       text,
  detail      jsonb
);
create index if not exists scrape_logs_product_time on scrape_logs(product_id, started_at desc);

alter table products      enable row level security;
alter table price_history enable row level security;
alter table scrape_logs   enable row level security;
```

---

## Environment Variables

### Backend (`backend/.env`)
| Variable | Description |
|---|---|
| `PORT` | API server port (default: `3000`) |
| `SUPABASE_URL` | Supabase project URL (e.g., `https://xyz.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key (server-side only, NEVER frontend) |
| `CRON_SECRET` | Shared secret expected in `Authorization: Bearer <secret>` or `x-cron-secret` |
| `CORS_ORIGIN` | Allowed frontend origin (e.g., `http://localhost:5173` or your Vercel URL) |
| `STORE_BASE_URL` | Base URL of mock store (default: `https://demo.inelabteamdev.com`) |
| `HEADED` | Set to `1` to watch visible Chromium browser locally (default: `0`) |
| `CHAOS` | Set to `1` to inject artificial 503s and 8s delays for demonstration (default: `0`) |

### Frontend (`frontend/.env`)
| Variable | Description |
|---|---|
| `VITE_API_URL` | URL of the backend API (e.g. `http://localhost:3000` or Render URL) |

---

## Local Setup & Running

### Prerequisites
* Node.js >= 20
* npm

### 1. Database Setup
Create a new project in [Supabase](https://supabase.com). Open the **SQL Editor**, paste the contents of `supabase/schema.sql`, and click **Run**.

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env and supply your SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CRON_SECRET

npm install
npx playwright install chromium

# Start backend server
npm start
# Server runs on http://localhost:3000
```

### 3. Frontend Setup
```bash
cd frontend
cp .env.example .env
# Ensure VITE_API_URL=http://localhost:3000 in frontend/.env

npm install
npm run dev
# Dashboard opens on http://localhost:5173
```

---

## Scraper Commands & Demonstration

### Dry-run single product scrape (Headless, no DB write):
```bash
cd backend
npm run scrape:dry -- https://demo.inelabteamdev.com/product/408
```

### Headed mode (Visually watch Chromium scrape):
```bash
cd backend
npm run scrape:headed:no-chaos -- https://demo.inelabteamdev.com/product/408
```

### Headed mode with Chaos (Demonstrates retries, backoff, and failure recovery):
```bash
cd backend
npm run scrape:headed -- https://demo.inelabteamdev.com/product/408
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Health check & keep-warm target |
| `GET` | `/api/search?q=water` | None | Search products by name, category, SKU |
| `GET` | `/api/products` | None | List tracked products with recent reliability ticks |
| `POST` | `/api/products` | None | Track a product and immediately trigger first scrape |
| `PATCH` | `/api/products/:id` | None | Update tracking frequency (`intervalMinutes`) or pause/resume |
| `DELETE` | `/api/products/:id` | None | Untrack product and cascade delete history & logs |
| `GET` | `/api/products/:id/history` | None | Retrieve verified price & stock history |
| `GET` | `/api/products/:id/logs` | None | Retrieve scrape attempt logs with per-attempt diagnostics |
| `POST` | `/api/products/:id/scrape` | None | Manually trigger immediate on-demand scrape |
| `POST` | `/api/scrape/run` | Secret | Scheduled cron endpoint (also aliased at `/api/cron/scrape`) |

---

## Configuring the 2-Hour Scheduler (cron-job.org)

Because Render's free tier spins down instances during inactivity, an external cron service is used to trigger scraping.

1. Create a free account at [cron-job.org](https://cron-job.org).
2. Create a **Scrape Job**:
   - **Title**: `INE Price Tracker - 2h Scrape`
   - **URL**: `https://<YOUR-RENDER-APP>.onrender.com/api/scrape/run`
   - **Method**: `POST`
   - **Schedule**: Every 2 hours (`0 */2 * * *`)
   - **Headers**:
     - `Authorization`: `Bearer <YOUR_CRON_SECRET>`
     - (or `x-cron-secret`: `<YOUR_CRON_SECRET>`)
   - The endpoint returns `202 Accepted` immediately and executes in the background.
3. (Optional but recommended) Create a **Keep-Warm Job**:
   - **Title**: `INE Price Tracker - Keep Warm`
   - **URL**: `https://<YOUR-RENDER-APP>.onrender.com/health`
   - **Method**: `GET`
   - **Schedule**: Every 10 minutes (`*/10 * * * *`)

---

## Deployment Steps

### 1. Database (Supabase)
1. Log in to [Supabase](https://supabase.com/) and create a project.
2. In the **SQL Editor**, run the SQL script in `supabase/schema.sql`.
3. Under **Project Settings -> API**, copy:
   - **Project URL** -> `SUPABASE_URL`
   - **service_role key** (secret) -> `SUPABASE_SERVICE_ROLE_KEY`

### 2. Backend (Render)
1. Connect your Git repository in [Render](https://render.com/).
2. Select **New Web Service**.
3. Choose:
   - **Root Directory**: `backend`
   - **Runtime**: **Docker** (Render will use the included `backend/Dockerfile` with Playwright dependencies pre-configured).
   - **Instance Type**: Free
4. Add Environment Variables:
   - `SUPABASE_URL`: `https://<project-id>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: `<your-supabase-service-role-key>`
   - `CRON_SECRET`: `<your-random-secure-string>`
   - `CORS_ORIGIN`: `https://<your-vercel-app>.vercel.app`
   - `STORE_BASE_URL`: `https://demo.inelabteamdev.com`
   - `PORT`: `3000`
5. Set Health Check Path: `/health`. Click **Deploy Web Service**.

### 3. Frontend (Vercel)
1. Import your Git repository in [Vercel](https://vercel.com/).
2. Select:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend`
3. Add Environment Variable:
   - `VITE_API_URL`: `https://<your-render-app>.onrender.com`
4. Click **Deploy**.
5. Once deployed, copy your Vercel URL and add it to `CORS_ORIGIN` in Render.

---

## Testing & Verification

Run backend unit tests:
```bash
cd backend
npm test
```
Verifies price parsing with zero-width characters, fullwidth digits, currency formats, stock status mapping, and layout validations.

Run end-to-end dry run:
```bash
cd backend
npm run scrape:dry -- https://demo.inelabteamdev.com/product/468
```
Verifies live navigation, anti-bot mouse movements, click handling, dynamic layout decoding, and data validation against the live mock store.
