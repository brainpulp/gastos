# Gastos — Claude Handoff

Personal finance tracker. Single-page React app, Supabase backend, GitHub Pages deploy.

> ## ⚖️ ACTIVE CENTRAL WORKSTREAM: Forensic accounting
> The user is building **forensic funds-flow reconstruction** into Gastos: trace assets
> from **Jan 2020 → today**, emphasis on **big transactions** and **2020–2023**, to
> investigate a **suspected missing/unaccounted sum**. Approach is **top-down summary /
> approximation** (not expense-by-expense), reconstructing **cash** big-tickets, working
> from both ends (funds availability ↔ known uses) via a **Sources & Uses / Net Worth**
> reconciliation. **See [`FORENSIC.md`](./FORENSIC.md) for the full mandate, methodology,
> data model, and phased plan. Read it before any forensic/assets/cash work.**

## Links
- **Live app**: https://brainpulp.github.io/gastos/
- **GitHub**: https://github.com/brainpulp/gastos
- **Supabase project**: `fnzdkqrkranedtgysqcf` → https://fnzdkqrkranedtgysqcf.supabase.co

## Stack
- React 19 + Vite, HashRouter (hash = active tab in URL)
- Supabase Postgres + Auth (RLS: `auth.uid() = user_id`)
- GitHub Pages via GitHub Actions (push to `main` → auto-deploy)
- `vite.config.js`: `base: '/gastos/'`
- GitHub Secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Key files
| File | Purpose |
|------|---------|
| `src/Finanzas.jsx` | Entire UI — one large file. Grep before editing, never edit by line number |
| `src/db.js` | All Supabase queries |
| `src/uploadParser.js` | XLSX parser (Santander AR only); returns camelCase fields |
| `src/categorize.js` | Client-side AI categorization logic |
| `supabase/functions/categorize-tx/index.ts` | Edge Function: validates JWT, calls Claude API, handles CORS |
| `src/supabase.js` | Supabase client init |

## DB schema — `transactions` table (full)
```
id, date, ym (GENERATED), year (GENERATED), cat, bank,
ars, usd, usd_rate, xfer, raw_desc, merchant, referencia,
notes, project, group_id, ai_assigned, ai_confidence,
needs_review, deleted_at, created_at, user_id
```
- `ym` and `year` are GENERATED ALWAYS — never insert them
- ARS/USD sign: **negative = expense, positive = income**
- Soft delete only (`deleted_at`); never hard-delete
- `loadTransactions()` paginates in 1000-row chunks (7,800+ rows)
- `normalizeTx()` in db.js: strips camelCase (`rawDesc→raw_desc`, `usdRate→usd_rate`), passes `merchant`+`referencia` through `...rest`

## Transaction ID prefixes & description status
- `b_*` — base migration from old minified app. ALL 7,751 rows are `b_*`.
  - `raw_desc`: populated for 7,471 rows (Santander format: `"TX TYPE \t MERCHANT"`)
  - `merchant`: was null; **fixed 2026-05-18** via SQL — extracted from tab-separated raw_desc, stripped card numbers and CUIT suffixes. 1,684 rows now have merchant.
  - Remaining rows without merchant: US bank format raw_desc (`"Debit Card Purchase #8381 ..."`) — display falls back to raw_desc correctly.
- `u_*` — Santander XLSX uploads. Currently 0 rows — no XLSX files have been uploaded yet.

## CRITICAL: description display in dark mode
**Previously broken, fixed 2026-05-18.** The `raw_desc` display used hardcoded `color: '#1a1a2e'` (dark navy) when no merchant — invisible against dark card background.

**Rule: never hardcode light-mode colors in inline styles inside TxsTab/RevisarTab.** Use `color: 'inherit'` or `S.td.color` or theme-conditional colors:
```jsx
// WRONG — invisible in dark mode:
color: tx.merchant ? '#666' : '#1a1a2e'

// RIGHT:
color: tx.merchant ? (dark ? '#8a8aaa' : '#666') : 'inherit'
```

## CRITICAL: inline `<select>` in dark mode
`iStyle` sets `color: 'inherit'` + `background: 'transparent'`. For `<select>` elements the native dropdown popup ignores these — it renders with OS/browser defaults (light background), inheriting the dark-mode text color → illegible text.

**Always add explicit colors to any `<select>` that uses iStyle:**
```jsx
style={{ ...iStyle, background: dark ? '#1a1a2e' : '#fff', color: dark ? '#e0e0e0' : '#1a1a2e' }}
```
This is already applied to bank and category selects in TxsTab.

## Other DB tables
| Table | Purpose |
|-------|---------|
| `settings` | Per-user: `cats` (category list), `expense_groups`, `monthly_budget_usd`, `vendor_hints` |
| `cat_log` | AI categorization audit log |
| `blue_rates` | Historical ARS/USD dólar blue rates `{date, rate}` |

## Component map (Finanzas.jsx)
```
Finanzas (root)
  ├── MultiSelectFilter          — reusable multi-select dropdown
  ├── DashTab                    — Dashboard: stats, stacked monthly chart, top-cat bar chart, scatter, Por categoría inline table
  ├── TxsTab                     — Transacciones: paginated table, inline row editing
  ├── RevisarTab                 — AI review queue (needs_review=true)
  ├── AuditoriaTab               — cat_log history
  └── SettingsTab
        ├── CategoryGroupsSection   — expense group management
        └── CategoryMgmtSection     — add/rename/merge/delete categories
```

## Tabs
`Dashboard` | `Transacciones` | `Revisar (N)` | `Historial IA` | `⚙ Config`

No Presupuesto tab (removed). No separate Totales tab — totals table is inlined at the bottom of Dashboard.

## State (root Finanzas component)
```js
// Data
txs, settings, blueRates

// Filters
selYears, dateFrom, dateTo, catFs, bankFs, search, showUncatOnly
amountMin, amountMax, amountCur  // amount range filter

// UI
activeTab, dark, uploadMsg

// Derived
filtered             // txs after all filters (xfer excluded)
filterActive         // bool — any filter on?
filterSummary        // { out, inc } USD totals of filtered set
expenseTxs           // filtered, non-xfer
totalesData          // per-cat {cat, usd, ars, count} sorted by |usd|
catChart             // top 12 cats for bar chart
monthlyStackedChart  // {data, cats} for stacked bar
dashGroupStats       // per expense-group avg/total
```

## Key behaviors
- **Click category badge** (Por categoría table or cat bar chart) → `goToCat(cat)` → sets `catFs=[cat]` + switches to Transacciones tab
- **Click month bar** → `goToMonth(ym)` → sets `dateFrom`/`dateTo` to that month (stays on Dashboard)
- **Filter summary bar** appears below filters when any filter is active; shows count, Gastos, Ingresos, Neto
- **Dark mode** toggle (◑), persisted in `localStorage('gastos-theme')`; `ThemeCtx` propagates via context to all sub-components; `makeS(dark)` builds all styles
- **Upload** XLSX (Santander AR) → parse → enrich with blueRates → categorize → upsert. Re-uploading same file is safe (deduplication on `id`).
- **Inline row editing** in TxsTab: double-click or ✎ icon. `saveEdit` diffs all fields → `onUpdate`. `saveField` saves single field immediately (bank, cat dropdowns).
- **AI categorize** button → calls Edge Function `categorize-tx` with JWT

## Category management
- Live list in `settings.cats`; `CATS` constant is the fallback
- `bulkUpdateCat(oldCat, newCat)` handles rename/merge/delete across all transactions
- **Known duplicates in DB**: `Roca deptos` and `deptos Roca` — user may want to merge
- **AI-assigned categories are prefixed with 🤖** (e.g. `"🤖 Dining"`). This is intentional — makes them visually distinct in the UI. The `ai_assigned = true` flag is the DB-level signal; the emoji is the UI-level signal. To undo all AI cats: `UPDATE transactions SET cat = NULL, ai_assigned = false, ai_confidence = NULL, needs_review = false WHERE ai_assigned = true AND deleted_at IS NULL`

## Recharts pattern (v3.8.1)
- `onClick` on `<Bar>`, not `<BarChart>`
- Stacked bar: one `<Bar>` per category, `stackId="s"`
- `onClick={(data) => { if (data?.ym) onMonthClick(data.ym) }}`
- Cat bar click: `onClick={(data) => { if (data?.cat) onCatClick(data.cat) }}`

## Deploy workflow
```bash
# Any push to main triggers GitHub Actions → Vite build → gh-pages branch
git add src/Finanzas.jsx
git commit -m "..."
git push origin main
# Supabase Edge Function (only when supabase/functions/* changed):
supabase functions deploy categorize-tx
```
**Always push to GitHub immediately after every change — no asking, no confirming.**

## Known issues / open questions
- Upload parser only supports Santander Argentina XLSX format
- `Roca deptos` / `deptos Roca` are duplicate categories — user is aware
- ~6,000 rows have US-bank-format raw_desc with no merchant extracted yet (shows raw_desc as fallback — readable but verbose)
- `ars` field for Santander/Alina ML records was null until migration (May 2026)

## Local path
`F:\code\gastos\`
