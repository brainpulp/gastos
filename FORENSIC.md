# Gastos — Forensic Accounting Mandate & Plan

> **STATUS: ACTIVE, CENTRAL WORKSTREAM.** This is not routine bookkeeping. Do not
> let this be dropped from context summaries. If you are a new session, read this
> file in full before touching anything related to "forensic", assets, cash, or
> funds-flow.

## 1. The mandate (user's words, paraphrased)

Trace the user's assets and funds flow from **Jan 2020 → today**, with emphasis on
**big transactions** and especially the **2020–2023** period. The user **suspects a
sizable sum may be missing** and wants to investigate where the money went.

Key constraints that shape the whole approach:
- **Not expense-by-expense.** The goal is a **summary / approximation**, top-down,
  focused on **big tickets**, not reconciling every coffee.
- **Cash is a first-class problem.** Many large moves were made in **cash** (real
  estate, big donations, etc.). Documentation for cash is **incomplete or
  non-existent** and must be **reconstructed**.
- **Work from both ends and reconstruct the middle:**
  - **(a) Funds availability** — what was on hand + what came in (sources).
  - **(b) Known uses** — what is known to have been spent, especially big tickets.
  - Reconstruct the in-between until the two ends reconcile (or a residual remains).
- **First establish the big questions to answer**, then determine what actually
  happened: whether nothing is strange, or there is a real, sizable shortfall.
- The DB already holds a large part of the banked history (~7,800 tx). We need the
  **scaffolding** for the investigation, not just more line items.

## 2. Methodology (standard forensic techniques)

Two complementary, well-established methods for reconstructing finances when records
are incomplete:

### Net Worth method
```
NetWorth(end) − NetWorth(start) = Sources − Uses      (over the period)
```
If the change in net worth cannot be explained by known sources minus known uses,
the difference is **unexplained** (hidden income if positive, **missing/unaccounted
outflow if negative**).

### Sources & Uses of Funds (the working equation for this case)
```
Opening assets (Jan 2020)
  + Sources 2020→today        (income, asset sales, loans in, gifts/inheritance in)
  − Known Uses 2020→today     (expenses, asset purchases, donations, taxes, cash-out)
  = EXPECTED closing net worth
```
Compare to **ACTUAL** current net worth:
```
GAP = Expected − Actual
```
- **Expected > Actual** ⇒ a **shortfall**: outflows we haven't accounted for (or funds
  that left and shouldn't have). This is the "missing money" figure.
- We narrow the gap by reconstructing cash/undocumented **big-ticket uses** until it
  closes or a **residual** remains. That residual, with its confidence band, is the
  headline finding.

Because inputs vary in quality, **every figure carries a confidence level**, so the
final gap is a **range**, not a false-precision number.

## 3. Currency basis (decided default — confirm with user)

For a 2020–2023 Argentine trace, **USD is the unit of account** (ARS is meaningless
across that inflation). The app already converts ARS→USD per-date via the **dólar
blue** (`blue_rates`). Forensic default:
- **All forensic sums and net-worth figures in USD.**
- Bank tx keep their per-date blue conversion (already stored).
- Asset valuations (real estate, etc.) entered directly in **USD nominal at the time**.
- **Open question:** blue vs MEP/CCL vs official for any specific reconstruction — blue
  is the app default; revisit only if a specific item demands it.

## 4. Data model / scaffolding (planned)

Principle: **reuse `transactions` for cash & big-ticket items** (user said "I'll add
them to the transaction list as such") so they flow into existing sums, plus a small
set of new tables for the things transactions can't express (asset balances over
time, links, investigation log).

### 4.1 Extend `transactions` (new columns)
- `is_cash` boolean — undocumented/cash move.
- `funds_type` text — classifies direction & nature for Sources/Uses:
  `opening_balance | income | asset_sale | loan_in | gift_in |
   expense | asset_purchase | loan_out | gift_out | tax | cash_withdrawal | unknown`.
  (Sign still encodes in/out; `funds_type` distinguishes e.g. income vs asset sale.)
- `confidence` text — `documented | estimated | reconstructed | guess`.
- `evidence` text — notes / links to documentation (or "none").
- `forensic` boolean — include this row in the forensic analysis (separates the
  investigation set from everyday noise).

### 4.2 New table `assets`
The things whose value we track. `id, name, type, currency, notes`.
`type ∈ {real_estate, bank_account, vehicle, business, crypto, cash, receivable, other}`.
Businesses in scope include Amazon FBA, MercadoLibre, Upwork income streams.

### 4.3 New table `asset_snapshots`
Point-in-time valuations → net worth at any date.
`id, asset_id, date, value_usd, basis, confidence, source`.
Minimum needed: a **Jan 2020 opening** snapshot set and a **current** set; interim
checkpoints (esp. year-ends 2020–2023) improve the trace.

### 4.4 `forensic_links` (table already exists, currently empty — define/confirm schema)
Links related rows to tell the story: e.g. "sold apt X (source) → funded purchase of
Y (use)", "cash withdrawal → donation". `id, from_tx, to_tx, relation, notes`.

### 4.5 New table `forensic_questions` (investigation log)
Drives "establish the big questions first". `id, question, status(open|answered),
hypothesis, findings, related (tx/link ids), priority`.

### 4.6 Forensic grouping
Reuse the existing expense-group machinery but with a forensic lens: **Real Estate,
Travel, Donations, Business capital, Vehicles, Living (approx), Cash-out, Taxes**.
(Implementation TBD: flag on `expense_groups` or a `forensic_groups` list in settings.)

## 5. Phased build plan

- **Phase 0 — Scaffolding.** Add the transactions columns + new tables. Extend the
  add-transaction form to capture cash/big-ticket items (is_cash, funds_type,
  confidence, evidence).
- **Phase 1 — Funds availability.** Assets manager + snapshot timeline; compute net
  worth at Jan 2020, now, and year-end checkpoints.
- **Phase 2 — Sources & Uses classification.** Bulk-tag transactions with
  `funds_type`; forensic groups; a **Big-Ticket ledger** view (all |USD| ≥ threshold,
  cash + banked, sorted, confidence-flagged).
- **Phase 3 — Reconciliation / Gap report.** The per-year Sources & Uses table
  (2020→now) with Expected vs Actual net worth and the **GAP** + confidence band;
  2020–2023 emphasized.
- **Phase 4 — Investigation workspace.** Questions tracker, tx links, narrative
  findings; iterate until the gap is explained or the residual is characterized.

## 6. The big questions (starter set — to be curated with the user first)

1. What was **net worth on Jan 1, 2020** (by asset, in USD)?
2. What is **net worth today**?
3. What are the **top ~20 largest inflows and outflows** 2020→today?
4. What **documented big-ticket uses** exist (real estate, donations, vehicles,
   business capital) and their amounts/dates?
5. How much **cash** was withdrawn/received but **not traced** to a use?
6. Does **Opening + Sources − Uses reconcile to Actual**? What is the **residual** and
   its confidence band?
7. For **2020–2023**, does the gap **concentrate in a particular year** or asset?

## 7. Open decisions (need user input before Phase 0)

- Asset classes actually in scope (real estate / bank / cash / vehicles / businesses /
  crypto / receivables).
- Store cash & big-ticket items **inside `transactions`** (recommended) vs a separate
  ledger.
- Currency basis confirmation (USD via blue — §3).
- Sequencing: build scaffolding now, or first produce a **data inventory** (what the
  existing DB already answers) + curated big-questions list, then scaffold.

## 8. Progress log

- 2026-07-01 — Mandate captured; methodology and phased plan drafted. No schema
  changes yet. Awaiting user decisions in §7. `forensic_links` / `pim_projects` /
  `staging_*` tables exist but are empty; schema to be inspected when Supabase MCP is
  stable and reconciled with this plan.
