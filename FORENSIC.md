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

## 4A. Adopted analysis model — money-flow graph (supersedes §4 for the analysis layer)

The forensic layer is a **directed graph of money flow 2020→today**, whose job is not
a tidy ledger but to **surface and rank the gaps** where the hard end (recorded money
leaving accounts) and the soft end (remembered destinations) fail to meet — so we
always know the single highest-value question to answer next. **The value is in the
loose ends.** The existing `transactions` table (9,000+ rows) is the **hard-data
substrate**; the graph is layered on top, mostly *derived* from it (see adaptation #1).

### Three primitives
- **Nodes** — accounts, assets, buckets, people, destinations. Types: `bank`, `cash`,
  `asset` (property/investment), `person`, `bucket` (aggregated, e.g. "living
  2020–2024"), `external`, and **`unknown`** (placeholder for "went somewhere not yet
  remembered"). Each: currency, optional opening/closing balance.
- **Flows (edges)** — `{from, to, amount, currency, date | period{start,end}, kind,
  confidence, evidence, note}`.
  - `kind`: `transaction` (single recorded) · `aggregate` (a known sum of many small
    ones over a period, with count) · `inferred`.
  - **`conserving` vs `terminal`** flag — the fix for transfer triple-counting: A→B→C
    is the *same* money moving; only **terminal** flows + closing balances count on the
    "where did it end up" side. (The inventory found $8M of 2020 "uses" were internal
    conserving transfers — this flag is essential, not optional.)
  - `confidence`: `recorded | remembered | estimated` — what makes it forensic/auditable.
- **Anchors** — flagged nodes: the **source set** (hard) and **destination set** (soft),
  plus a **required opening balance sheet (Jan 2020)** and **closing destinations (now)**
  that bound the search. (We currently have neither — top gap, §9.)

### Reconciliation engine (the detective's dashboard)
- **Per node:** `Σin − Σout − retained = residual`. Nonzero residual = unexplained leak
  (money that entered and vanished, or an asset with no traced funding).
- **Global:** Σsources vs Σdestinations, and a **"% of funds traced"** headline.
- Main screen = **ranked list of the biggest unexplained gaps**; **Unknown nodes**
  absorb everything unmatched and their running size **is** the headline metric. Case
  "closes" when Unknowns are below the materiality threshold or documented as genuinely
  unexplained.
- Two red flags fall out automatically: **timeline infeasibility** (a destination
  funded before any source could supply it ⇒ missing earlier source) and **unmatched
  ends** (big outflow with no destination; asset with no funding).

### Dilemmas & resolutions (design rules)
- **Fungibility/commingling** → reconcile at **balance level per node**, never assert
  dollar-identity by default; a specific source→sink link requires evidence (matching
  amount+date, wire memo). FIFO/pro-rata only as an optional hypothesis helper.
- **Materiality** → configurable threshold (start ~USD 5k). Above = traced
  individually; below = rolled into periodic **aggregate buckets** so books balance
  without entering noise. Directly serves the "not expense-by-expense" mandate.
- **Confidence** → three evidence tiers on every node/flow; reconcile at a confidence
  floor; color-code so we see how much rests on memory.
- **Currency/FX** → store native amount+currency; normalize to **USD at the flow's
  date** (blue table already exists). Reconcile in USD, show native on hover.
- **Splits/many-to-many** → flows can split into child allocations that must sum to the
  parent; each allocation is a hypothesis with its own confidence.

### Two adaptations for Gastos (my criteria, grounded in §9 data)
1. **Do NOT re-enter the 9,000 transactions as flows.** Accounts become nodes;
   reconcile at **balance level per account-node** using transaction *sums* (already
   computed in §9). Only **promote material / cross-perimeter items** to explicit
   flows (e.g. the $3.96M money-market sweep → an `unknown` node). Small stuff → period
   buckets. This keeps it tractable and top-down.
2. **`xfer` is too coarse.** Conserving vs terminal must be **node-aware**: a transfer
   to an account *inside* the perimeter is conserving; a transfer to an account
   *outside* it (money market, brokerage) leaves visibility → terminal into an
   `unknown` node until that account is added. Recompute the current `xfer` rows under
   this lens.

Build discipline: carry a **reconciliation invariant** with assertions (Σsources −
Σterminal-uses − Σclosing-balances = 0 within tolerance) as a self-check, mirroring the
app's existing patterns. Build as a **sibling "Forensic" module** reusing the Supabase
persistence and table UI, not a rewrite of the projector.

## 5. Phased build plan (graph/engine-first)

- **Phase 0 — Graph schema + reconciliation engine.** Tables: `nodes`, `flows`
  (with `kind`, `conserving/terminal`, `confidence`, `evidence`, `period`),
  `node_balances` (opening/closing anchors). Derive account-nodes and per-account net
  flows from existing `transactions` (no re-entry). Implement the reconciliation math
  (per-node residual, global % traced) **with a self-test invariant**.
- **Phase 1 — Anchors & funds availability.** Capture the **Jan 2020 opening balance
  sheet** and **current closing destinations**; add the missing perimeter nodes
  (money-market/brokerage, etc.). Node types incl. asset/cash/person/unknown.
- **Phase 2 — Promote material flows + buckets.** Auto-surface all |USD| ≥ threshold
  items (banked + cash) as candidate flows; classify each as terminal/conserving and
  assign a destination node (or `unknown`). Roll sub-threshold activity into period
  **buckets**. Reconstruct pre-2024 cash big-tickets as `estimated`/`remembered` flows.
- **Phase 3 — Reconciliation dashboard.** Ranked **biggest-unexplained-gaps** list,
  per-node worksheet (in/out/retained/residual), **% funds traced** headline, timeline-
  infeasibility & unmatched-end red flags; 2020–2023 emphasized. Optional **Sankey**
  viz (may need a small lib — Recharts v3 has no first-class Sankey).
- **Phase 4 — Hypothesis tooling & investigation log.** Propose low-confidence bridging
  flows; tool tests them for amount/timing plausibility; promote to confirmed as
  evidence surfaces; `forensic_questions` tracker + `forensic_links`. Iterate until
  Unknowns are below threshold or logged as genuinely unexplained.

**Detective workflow the tool supports:** frame case (period, base ccy, materiality) →
anchor (2020 opening + current destinations) → enter recorded big sources → enter
remembered destinations → reconcile (surfaces residuals/conflicts) → hypothesize bridges
→ promote as evidence appears → iterate until the gap is below threshold or documented.

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
  changes yet. `forensic_links` / `pim_projects` / `staging_*` tables exist but are
  empty; schema to be inspected and reconciled with this plan.
- 2026-07-01 — **Read-only data inventory run (see §9).** Defaults adopted: cash
  inside `transactions`, USD via blue.

## 9. Data inventory — first findings (2026-07-01, read-only)

All USD. "External" = non-transfer rows (internal transfers netted out).

### External funds flow by year (internal transfers excluded)
| Year | Ext in | Ext out | Internal xfer vol | Ext net |
|------|-------:|--------:|------------------:|--------:|
| 2020 | 4,280,392 | −807,984 | 8,001,151 | +3,472,409 |
| 2021 | 1,365,893 | −1,745,080 | 143,051 | −379,187 |
| 2022 | **0** | −313,857 | 394,938 | −313,857 |
| 2023 | 224,250 | −481,035 | 1,006,670 | −256,785 |
| 2024 | ~0 | −265,505 | 867,316 | −265,211 |
| 2025 | ~0 | −354,070 | 163,681 | −353,481 |
| 2026 | 53,106 | −155,317 | 145,012 | −102,212 |

- **Cumulative external ≈ +$1.8M** ($5.92M in, $4.12M out) over 2020→now, banked data only.

### The anchor event
- **2020-02-04: +$4,044,080 from "Vida Systems"** (Citibank; the dominant inflow —
  likely a business sale/payout). Immediately **2020-03-16: −$3,960,522 "Transfer to
  Money Market"** — swept to an account **not in the dataset**. Also large 2020 wires
  "to Maximiliano Goldschwartz" / "to Checking" (self). The ~$4M leaving the visible
  perimeter into a money-market account is the primary thread to trace.
- Secondary inflows: "Indiavidual/Individual Learning Limited" +$428k ×2 (2021).

### Account perimeter (banks present)
| Bank | n | First | Last | Net USD |
|------|--:|-------|------|--------:|
| Santander (ARS) | 6997 | 2020-10-15 | 2026-06 | −615,089 |
| Citibank (USD) | 2050 | 2020-01-02 | 2026-02 | −4,819,189 |
| Cash | 212 | **2024-07-15** | 2026-05 | −222,213 |
| Upwork | 182 | 2020-01 | 2023-11 | −87,706 |
| Alina ML | 115 | 2024-08 | 2026-02 | +841 |
| Chase | 38 | **2022-06** | 2024-07 | −817,019 |
| BoFA | 45 | 2023 | 2023 | −95,284 |
| Wells Fargo | 25 | 2023-24 | | −20,197 |
| Capital One | 25 | 2023-24 | | −59,828 |

### Perimeter gaps (must be filled to close the trace)
1. **No opening balances** at Jan 1 2020 for any account.
2. **Money-market account** that received ~$3.96M in 2020 is **not in the dataset**.
3. **Cash only exists from 2024-07** — all pre-2024 cash big-tickets need reconstruction.
4. **Santander starts 2020-10** — Jan–Sep 2020 ARS missing.
5. **Chase appears 2022-06 (−$817k net)** — where did Chase's funds originate? Likely
   downstream of the 2020 money-market sweep; the link is not yet in the data.
6. Pre-existing forensic breadcrumbs already in the data: category **"Must trace"** on
   several 2021 Citibank wires (−$250k, −$220k, −$200k…); a **"Transfers"** category.

### Refined big questions (supersede/augment §6)
- Q1. Where did the **~$4M money-market sweep (Mar 2020)** go, and what fed **Chase**?
- Q2. What are the **opening balances (Jan 2020)** across all accounts + the
  money-market/brokerage not yet in the DB?
- Q3. **2021 external outflows −$1.75M** — itemize; resolve the **"Must trace"** wires.
- Q4. **2022 shows $0 external income** despite 1,273 tx — real, or missing income feed?
- Q5. Reconstruct **pre-2024 cash** big-tickets (real estate, donations).
- Q6. Net-worth **now** vs Jan 2020 → does +$1.8M banked-net reconcile to actual
  assets, or is a chunk of that $4M unaccounted?
