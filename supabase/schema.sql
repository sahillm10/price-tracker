-- Run this in the Supabase SQL editor.
create extension if not exists "pgcrypto";

create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  external_id      text not null unique,          -- stable id from the store (URL path)
  name             text not null,
  url              text not null,
  image_url        text,
  interval_minutes int  not null default 120 check (interval_minutes >= 30),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  -- denormalised "latest known good" values for the dashboard
  last_price       numeric(12,2),
  last_stock       text,
  last_success_at  timestamptz,
  last_attempt_at  timestamptz,
  last_status      text                           -- success | retried | failed
);

-- Only ever contains VERIFIED readings. Failed scrapes never land here.
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

-- One row per scrape run (per product), including every failure.
create table if not exists scrape_logs (
  id          bigserial primary key,
  product_id  uuid not null references products(id) on delete cascade,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  outcome     text not null default 'running' check (outcome in ('running','success','retried','failed')),
  attempts    int  not null default 0,
  price       numeric(12,2),
  error_code  text,
  error       text,
  detail      jsonb                                -- per-attempt timings + errors
);
create index if not exists scrape_logs_product_time on scrape_logs(product_id, started_at desc);

-- Backend uses the service-role key, so lock the tables down from anon access.
alter table products      enable row level security;
alter table price_history enable row level security;
alter table scrape_logs   enable row level security;
