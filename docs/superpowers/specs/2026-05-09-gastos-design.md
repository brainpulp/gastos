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

**Configuration constants** (must be substituted before deployment):
- `GITHUB_USERNAME` — your GitHub account username (determines the Pages URL)
- `GITHUB_PAGES_URL` — `https://<GITHUB_USERNAME>.github.io/gastos/`
- This URL must be set as the Supabase Auth redirect URI AND as the Edge Function CORS origin. Both must match exactly.

```
Browser (GitHub Pages SPA — https://<GITHUB_USERNAME>.github.io/gastos/)
  └─ React + Vite (HashRouter for SPA routing compatibility)
       ├─ @supabase/supabase-js  (auth, data reads/writes)
       └─ XLSX upload parser (unchanged)

Supabase
  ├─ Auth (magic link, single user: maxi.goldschwartz@gmail.com)
  │    └─ Redirect URI: https://<GITHUB_USERNAME>.github.io/gastos/
  ├─ PostgreSQL (transactions, settings, cat_log tables)
  ├─ RLS policies (all rows scoped to auth.uid())
  └─ Edge Function: categorize-tx
       ├─ validates caller's JWT (Authorization: Bearer <token>) before any action
       ├─ returns CORS headers for https://<GITHUB_USERNAME>.github.io origin + handles OPTIONS preflight
       └─ calls Anthropic Claude API (key stored as Supabase secret)

GitHub
  ├─ Repo: gastos (code + history)
  ├─ GitHub Actions: build → deploy to gh-pages branch on push to main
  └─ Secrets: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

All data loads at startup (no pagination — ~8K rows is manageable). No server-side rendering; everything is a static SPA.

**SPA routing on GitHub Pages:** GitHub Pages does not support server-side routing. The app uses `HashRouter` (`/#/tab`) so all navigation stays within the `index.html` entry point. Supabase magic link redirects to `https://<user>.github.io/gastos/` (root); the `#access_token=...` hash fragment is consumed by `@supabase/supabase-js` automatically on load.

---

## 3. Data Model

### `transactions`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | `u_${date}_${referencia}` for uploads; `b_${index}` for base data |
| user_id | uuid NOT NULL | FK → auth.users, RLS filter |
| date | date NOT NULL | |
| ym | text GENERATED | `GENERATED ALWAYS AS (to_char(date, 'YYYY-MM')) STORED`, indexed |
| year | int GENERATED | `GENERATED ALWAYS AS (extract(year from date)::int) STORED` |
| cat | text | Assigned category |
| bank | text | `Santander`, etc. |
| ars | numeric | Signed (negative = expense) |
| usd | numeric | `ars / usd_rate` at upload time |
| usd_rate | numeric | Authoritative per-transaction exchange rate (settings.usd_rate is only the UI pre-fill default) |
| xfer | boolean | Is interbank transfer |
| raw_desc | text | Full description from bank |
| merchant | text | Extracted merchant name (may be empty) |
| referencia | text | Bank reference number |
| notes | text | User-added notes |
| project | text | User-assigned project label |
| group_id | uuid | Plain UUID matched against settings.groups[].id in app layer (no FK) |
| ai_assigned | boolean | Was category set by AI (renamed from `ai_cat` for clarity) |
| ai_confidence | numeric | 0–1, AI confidence score |
| needs_review | boolean DEFAULT false | Queued for user review |
| created_at | timestamptz DEFAULT now() | |

### `settings`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid PK | |
| monthly_budget_usd | numeric | Total monthly budget |
| category_budgets | jsonb | `{[cat: string]: number}` — per-category monthly budget in USD |
| groups | jsonb | `[{id: uuid, name: string, categories: string[]}]` |
| vendor_hints | jsonb | `{[merchant: string]: {cat: string, project: string}}` — auto-assign rules (min 5 confirmed tx) |
| usd_rate | numeric | Default pre-fill value shown in upload UI only |

### `cat_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK DEFAULT gen_random_uuid() | |
| user_id | uuid NOT NULL | RLS filter |
| tx_id | text | References transactions.id (no FK constraint — log survives tx deletion) |
| action | text | `ai_assigned`, `user_confirmed`, `user_corrected`, `ai_skipped`, `ai_error` |
| cat_before | text | |
| cat_after | text | |
| confidence | numeric | |
| note | text | Error message or reasoning (populated on `ai_error` or `ai_skipped`) |
| prompt_tokens | int | |
| completion_tokens | int | |
| model | text | |
| created_at | timestamptz DEFAULT now() | |

**RLS:** All tables have `user_id` with policy `auth.uid() = user_id`. The Edge Function validates the caller's JWT and writes to `cat_log` using the forwarded user context (not service role), ensuring RLS applies to Edge Function writes as well.

---

## 4. Authentication

- Magic link only (no password). Email: `maxi.goldschwartz@gmail.com`.
- Supabase Auth dashboard must have `https://<user>.github.io/gastos/` in the allowed redirect URLs list.
- `App.jsx` checks `supabase.auth.getSession()` on mount; shows `<Auth />` login screen if no session.
- `supabase.auth.onAuthStateChange` handles the token from the magic link's `#access_token=...` hash fragment automatically — no manual hash parsing needed.
- App uses `HashRouter` so all React routes live under `/#/...`, keeping the GitHub Pages entry point at root.
- A logout button is included; calling `supabase.auth.signOut()` clears the session.

---

## 5. Data Migration (One-time)

**Dependency note:** Migration requires the user's Supabase UUID, which only exists after the Supabase Auth user is created (first magic link send). Therefore, migration runs **after** Phase 3 (auth integration) is complete and the user has logged in at least once. The UUID is retrieved from the Supabase Auth dashboard or via `supabase.auth.getUser()` in the browser console.

A one-time Node.js migration script (`scripts/migrate-base-data.js`) will:
1. Read from `transactions_clean.csv` (8,429 rows) or decode `_D` from `finanzas.jsx`
2. Assign `id = b_${index}`, `user_id` = UUID passed as CLI argument (`--user-id <uuid>`)
3. Batch-insert into Supabase `transactions` table via service role key (bypasses RLS for the one-time load)
4. Remove the embedded data from `Finanzas.jsx`

After migration, `Finanzas.jsx` loads all transactions from Supabase at startup via a single `select *` query.

---

## 6. AI Categorization Flow

Triggered when a user uploads new transactions.

```
For each new tx:
  1. Resolve merchant key:
     - If merchant is empty/null, use raw_desc as lookup key
     - If both are empty: set needs_review=true, skip to step 5 (no AI call)

  2. Check vendor_hints[key] — if found: auto-assign, no API call

  3. Check cat_log for same merchant, last 6 months, action=user_confirmed/user_corrected
     → if found: suggest same category, skip API call (treat as high confidence)

  4. Call Edge Function: categorize-tx
     - Request includes user's JWT in Authorization header
     - Edge Function validates JWT, then calls Claude API
     - Payload: {merchant, rawDesc, amount, availableCategories[]}
     - Claude returns: {cat, confidence, reasoning}

     4a. On any error (network, non-200, malformed response, rate limit):
         set needs_review=true, ai_assigned=false
         log action='ai_error', note=error message
         surface error banner to user — upload continues, tx is not blocked

  5. If confidence >= 0.75: auto-assign, ai_assigned=true, log action='ai_assigned'
  6. If confidence < 0.75: set needs_review=true, log action='ai_skipped', note=reasoning
```

**Edge Function security:** The function reads `Authorization: Bearer <token>` from the request, calls `supabase.auth.getUser(token)` to validate it, and rejects unauthenticated requests with HTTP 401. This prevents unauthorized use of the Claude API proxy.

**Edge Function CORS:** The function returns `Access-Control-Allow-Origin: https://<user>.github.io` and handles OPTIONS preflight requests, allowing browser calls from the GitHub Pages origin.

**Vendor pattern learning:** After the user confirms or corrects a category in the review queue:
1. Query all `user_confirmed` + `user_corrected` cat_log entries for the same merchant
2. If total confirmed entries ≥ 5 AND one category appears in >80% of them → write to `settings.vendor_hints[merchant]`
3. Subsequent uploads for that merchant skip the AI entirely

---

## 7. UI Views

### Existing (unchanged behavior, data source changes to Supabase)
- **Dashboard** — monthly spend chart, category breakdown
- **Totals** — aggregated table by category/period
- **Transactions** — full filterable table

### New tabs

**Revisar (Review Queue)**
- Lists transactions where `needs_review = true`
- Shows: date, merchant, amount, rawDesc, AI's suggested category + confidence (or error note)
- User can: confirm suggested, pick different category, add project label, add notes
- On confirm: updates transaction (`needs_review=false`, `cat=chosen`), logs to cat_log (`action=user_confirmed` or `user_corrected`), triggers vendor pattern check

**Presupuesto (Budget)**
- Monthly total budget input + per-category budget inputs (stored in `settings.monthly_budget_usd` and `settings.category_budgets`)
- Bar chart: actual spend vs total budget per month (current year)
- Category breakdown table: actual vs per-category budget targets
- "Spend by project/group in period" query — user picks project label or group + date range → shows total + transaction list

**Auditoría (Audit)**
- Table of all cat_log entries, newest first
- Columns: date, merchant, action, cat_before→cat_after, confidence, note, tokens used
- Filter by action type (`ai_assigned`, `user_corrected`, `ai_error`, etc.), date range
- Summary: total AI calls, total tokens, auto-assigned %, review rate, error rate

---

## 8. GitHub + CI/CD

- Repo: `gastos` (private recommended for personal finance data)
- `main` branch → GitHub Actions on push:
  1. `npm ci`
  2. `npm run build` (Vite, injects `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from GitHub Secrets)
  3. Deploy `dist/` to `gh-pages` branch using `peaceiris/actions-gh-pages`
- GitHub Pages serves from `gh-pages` branch
- `vite.config.js` sets `base: '/gastos/'` (repo name) for correct asset paths on GitHub Pages

---

## 9. Implementation Phases

All phases built at once (user preference), in dependency order:

1. **Infra setup + CI/CD**: GitHub repo, Supabase project, tables + RLS, GitHub Secrets, configure Supabase Auth redirect URL, GitHub Actions workflow + `gh-pages` deployment. CI/CD is set up here so all subsequent phases can be verified on the live Pages URL.
2. **Auth integration**: `src/supabase.js`, `src/Auth.jsx`, App.jsx session gate (must complete before migration)
3. **Base data migration**: user logs in once → retrieve UUID → run `scripts/migrate-base-data.js --user-id <uuid>`
4. **Data layer**: replace localStorage + embedded data with Supabase reads/writes in Finanzas.jsx
5. **Edge Function**: `supabase/functions/categorize-tx/index.ts` — JWT validation using `createClient(url, anonKey, { global: { headers: { Authorization: \`Bearer ${token}\` } } })` so all DB writes run under user's RLS context; CORS handling; Claude API call
6. **AI categorization UI**: upload flow → categorize → review queue (Revisar tab)
7. **Budget + Audit views**: Presupuesto and Auditoría tabs + settings UI

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
| HashRouter (not BrowserRouter) | GitHub Pages serves static files; server-side routing not available |
| Magic link (not Google OAuth) | Simpler, no OAuth app setup needed for single user |
| Supabase Edge Function for Claude | Keeps API key server-side; free tier sufficient for personal use |
| Edge Function validates JWT | Prevents unauthenticated use of Claude API proxy |
| CORS headers on Edge Function | Required for browser calls from github.io origin |
| Load all data at startup | ~8K rows is small; avoids pagination complexity |
| Vendor hints in settings JSONB | Low-cardinality lookup; no separate table needed |
| Vendor hints require ≥ 5 confirmed tx | Prevents premature auto-assign on thin data |
| `ym` and `year` as GENERATED columns | Ensures consistency with `date`; no app-layer derivation needed |
| `group_id` resolved in app layer | Groups stored in settings JSONB; no separate table or FK needed |
| confidence ≥ 0.75 threshold | Balances automation vs. accuracy; tunable via settings later |
| Migration requires CLI UUID arg | UUID only available after first login; explicit arg prevents hardcoding |
