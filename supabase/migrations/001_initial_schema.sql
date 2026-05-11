-- ============================================================
-- Gastos: initial schema
-- ============================================================

-- Immutable helpers needed for GENERATED columns
-- (to_char and extract are STABLE in Postgres; we wrap them as IMMUTABLE
--  since date→ym/year is deterministic regardless of locale for date input)
create or replace function public.fn_date_ym(d date)
  returns text language sql immutable strict as
  $$ select to_char(d, 'YYYY-MM') $$;

create or replace function public.fn_date_year(d date)
  returns int language sql immutable strict as
  $$ select extract(year from d)::int $$;

-- transactions
create table public.transactions (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  ym            text generated always as (public.fn_date_ym(date)) stored,
  year          int  generated always as (public.fn_date_year(date)) stored,
  cat           text,
  bank          text,
  ars           numeric,
  usd           numeric,
  usd_rate      numeric,
  xfer          boolean default false,
  raw_desc      text,
  merchant      text,
  referencia    text,
  notes         text,
  project       text,
  group_id      uuid,
  ai_assigned   boolean default false,
  ai_confidence numeric,
  needs_review  boolean default false,
  deleted_at    timestamptz,
  created_at    timestamptz default now()
);

create index transactions_user_ym     on public.transactions(user_id, ym);
create index transactions_user_cat    on public.transactions(user_id, cat);
create index transactions_user_year   on public.transactions(user_id, year);
create index transactions_not_deleted on public.transactions(user_id, deleted_at) where deleted_at is null;

alter table public.transactions enable row level security;
create policy "user owns their transactions"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- settings (one row per user)
create table public.settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  monthly_budget_usd  numeric default 0,
  category_budgets    jsonb default '{}',
  groups              jsonb default '[]',
  vendor_hints        jsonb default '{}',
  usd_rate            numeric default 1050
);

alter table public.settings enable row level security;
create policy "user owns their settings"
  on public.settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- cat_log (no FK on tx_id — log survives tx deletion)
create table public.cat_log (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  tx_id             text,
  action            text not null,
  cat_before        text,
  cat_after         text,
  confidence        numeric,
  note              text,
  prompt_tokens     int,
  completion_tokens int,
  model             text,
  created_at        timestamptz default now()
);

create index cat_log_user_created on public.cat_log(user_id, created_at desc);
create index cat_log_tx_id        on public.cat_log(tx_id);
create index cat_log_merchant     on public.cat_log(user_id, tx_id, action);

alter table public.cat_log enable row level security;
create policy "user owns their cat_log"
  on public.cat_log for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- blue_rates: historical dólar blue exchange rates (ARS per 1 USD)
create table public.blue_rates (
  date date primary key,
  rate numeric not null
);

alter table public.blue_rates enable row level security;
create policy "authenticated users can read blue_rates"
  on public.blue_rates for select
  using (auth.role() = 'authenticated');
create policy "authenticated users can insert blue_rates"
  on public.blue_rates for insert
  with check (auth.role() = 'authenticated');
create policy "authenticated users can update blue_rates"
  on public.blue_rates for update
  using (auth.role() = 'authenticated');
