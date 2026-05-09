# Gastos — Personal Finance Dashboard: Design Spec
**Date:** 2026-05-09  
**Status:** Approved  
**Scope:** Full cloud migration + AI categorization + budget/audit UI

---

## 1. Overview

Single-user personal finance dashboard. Existing Vite/React app with ~7,751 embedded base transactions (Santander AR) and a working XLSX upload parser. This design migrates everything to the cloud: code to GitHub (hosted on GitHub Pages), data to Supabase (PostgreSQL + Auth), and adds AI-powered categorization via a Claude API proxy running as a Supabase Edge Function.

**End state:** visit the GitHub Pages URL → magic link login → full dashboard with persistent data, smart categorization, budget tracking, and audit trail.

---

## 2. Architecture

```
Browser (GitHub Pages SPA)
  └─ React + Vite
       ├─ @supabase/supabase-js  (auth, data reads/writes)
       └─ XLSX upload parser (unchanged)

Supabase
  ├─ Auth (magic link, single user: maxi.goldschwartz@gmail.com)
  ├─ PostgreSQL (transactions, settings, cat_log tables)
  ├─ RLS policies (all rows scoped to auth.uid())
  └─ Edge Function: categorize-tx
       └─ calls Anthropic Claude API (key stored as Supabase secret)

GitHub
  ├─ Repo: gastos (code + history)
  ├─ GitHub Actions: build → deploy to gh-pages branch on push to main
  └─ Secrets: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

All data loads at startup (no pagination — ~8K rows is manageable). No server-side rendering; everything is a static SPA.

---

## 3. Data Model

### `transactions`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | `u_${date}_${referencia}` for uploads; `b_${index}` for base data |
| user_id | uuid | FK → auth.users, RLS filter |
| date | date | |
| ym | text | `YYYY-MM` derived column (indexed) |
| year | int | |
| cat | text | Assigned category |
| bank | text | `Santander`, etc. |
| ars | numeric | Signed (negative = expense) |
| usd | numeric | `ars / usdRate` at upload time |
| usd_rate | numeric | Exchange rate at upload |
| xfer | boolean | Is interbank transfer |
| raw_desc | text | Full description from bank |
| merchant | text | Extracted merchant name |
| referencia | text | Bank reference number |
| notes | text | User-added notes |
| project | text | User-assigned project label |
| group_id | uuid | FK → groups (nullable) |
| ai_cat | boolean | Was category assigned by AI |
| ai_confidence | numeric | 0–1, AI confidence score |
| needs_review | boolean | Queued for user review |
| created_at | timestamptz | |

### `settings`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid PK | |
| monthly_budget_usd | numeric | |
| groups | jsonb | `[{id, name, categories[]}]` |
| vendor_hints | jsonb | `{merchant: {cat, project}}` — user-confirmed overrides |
| usd_rate | numeric | Default upload rate |

### `cat_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid | |
| tx_id | text | FK → transactions.id |
| action | text | `ai_assigned`, `user_confirmed`, `user_corrected`, `ai_skipped` |
| cat_before | text | |
| cat_after | text | |
| confidence | numeric | |
| prompt_tokens | int | |
| completion_tokens | int | |
| model | text | |
| created_at | timestamptz | |

All tables have `user_id` with RLS: `auth.uid() = user_id`.

---

## 4. Authentication

- Magic link only (no password). Email: `maxi.goldschwartz@gmail.com`.
- Supabase Auth handles token issuance + refresh.
- `App.jsx` checks `supabase.auth.getSession()` on mount; shows `<Auth />` login screen if no session.
- After clicking magic link → redirected back to app → session established automatically.
- No logout needed for single-user, but a logout button will be included for cleanliness.

---

## 5. Data Migration (One-time)

A one-time Node.js migration script (`scripts/migrate-base-data.js`) will:
1. Decode the `_D` delta-encoded string from the original `finanzas.jsx` artifact (or read from `transactions_clean.csv`)
2. Assign `id = b_${index}`, `user_id` = the known single user's UUID
3. Batch-insert into Supabase `transactions` table via service role key
4. Remove the embedded data from `Finanzas.jsx`

After migration, `Finanzas.jsx` loads all transactions from Supabase at startup via a single `select *` query.

---

## 6. AI Categorization Flow

Triggered when a user uploads new transactions.

```
For each new tx:
  1. Check vendor_hints (settings.vendor_hints[merchant])
     → if found with >80% historical concentration: auto-assign, no API call
  2. Check recent cat_log for same merchant (last 6 months)
     → if found: suggest same category (high confidence, no API call)
  3. Call Edge Function: categorize-tx
     → sends: merchant, rawDesc, amount, existing categories list
     → Claude returns: {cat, confidence, reasoning}
  4. If confidence >= 0.75: auto-assign, cat_log action='ai_assigned'
  5. If confidence < 0.75: set needs_review=true, cat_log action='ai_skipped'
```

Edge Function hides the Anthropic API key. It is the only component that can call the Claude API.

**Vendor pattern learning:** after user confirms/corrects a category in the review queue, the app checks if that merchant has >80% of all-time transactions in a single category → if yes, writes to `vendor_hints` to skip AI next time.

---

## 7. UI Views

### Existing (unchanged behavior, data source changes to Supabase)
- **Dashboard** — monthly spend chart, category breakdown
- **Totals** — aggregated table by category/period
- **Transactions** — full filterable table

### New tabs

**Revisar (Review Queue)**
- Lists transactions where `needs_review = true`
- Shows: date, merchant, amount, rawDesc, AI's suggested category + confidence
- User can: confirm suggested, pick different category, add project label, add notes
- On confirm: updates transaction, logs to cat_log, triggers vendor pattern check

**Presupuesto (Budget)**
- Monthly budget input (stored in settings)
- Bar chart: actual spend vs budget per month (current year)
- Category breakdown vs budget targets (user sets per-category targets in settings)
- "Spend by project/group in period" query — user picks project label or group + date range → shows total + transaction list

**Auditoría (Audit)**
- Table of all cat_log entries, newest first
- Columns: date, merchant, action, cat_before→cat_after, confidence, tokens used
- Filter by action type, date range
- Summary: total AI calls, total tokens, auto-assigned %, review rate

---

## 8. GitHub + CI/CD

- Repo: `gastos` (public or private user's choice)
- `main` branch → GitHub Actions on push:
  1. `npm ci`
  2. `npm run build` (Vite, injects `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from secrets)
  3. Deploy `dist/` to `gh-pages` branch
- GitHub Pages serves from `gh-pages` branch
- `vite.config.js` sets `base: '/gastos/'` (repo name) for correct asset paths

---

## 9. Implementation Phases

All phases are being built at once (user preference), but logically ordered for dependency correctness:

1. **Infra setup**: GitHub repo, Supabase project, tables + RLS, GitHub Secrets
2. **Base data migration**: decode + insert historical transactions
3. **Auth integration**: `src/supabase.js`, `src/Auth.jsx`, App.jsx session gate
4. **Data layer**: replace localStorage + embedded data with Supabase reads/writes in Finanzas.jsx
5. **Edge Function**: `supabase/functions/categorize-tx/index.ts`
6. **AI categorization UI**: upload flow → categorize → review queue
7. **Budget + Audit views**: new tabs + settings UI
8. **CI/CD**: GitHub Actions workflow + `gh-pages` deployment

---

## 10. Out of Scope

- Multi-user support (single user only)
- Pagination (all data loads at startup)
- Offline mode / PWA
- Automatic bank data fetching (download + upload manually)
- Mobile-native app
- Multiple currencies other than ARS/USD

---

## 11. Key Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| GitHub Pages (not Netlify/Vercel) | User explicitly chose GitHub |
| Magic link (not Google OAuth) | Simpler, no OAuth app setup needed for single user |
| Supabase Edge Function for Claude | Keeps API key server-side; free tier sufficient for personal use |
| Load all data at startup | ~8K rows is small; avoids pagination complexity |
| Vendor hints in settings JSONB | Low-cardinality lookup, doesn't need its own table |
| confidence ≥ 0.75 threshold | Balances automation vs. accuracy; tunable via settings later |
