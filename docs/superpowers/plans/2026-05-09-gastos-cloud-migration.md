# Gastos Cloud Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Gastos personal finance dashboard from localStorage+embedded-data to GitHub Pages + Supabase (auth, DB, Edge Function for Claude AI categorization), adding Review Queue, Budget, and Audit tabs.

**Architecture:** Single-user Vite/React SPA deployed to GitHub Pages via GitHub Actions. All data lives in Supabase PostgreSQL with RLS. A Supabase Edge Function proxies Claude API calls for AI transaction categorization, protecting the API key. HashRouter handles all SPA routing since GitHub Pages is static-only.

**Tech Stack:** React 19, Vite 8, `@supabase/supabase-js`, `react-router-dom` (HashRouter), Recharts, SheetJS (xlsx), Supabase PostgreSQL + Auth + Edge Functions, Claude API (claude-haiku-4-5), GitHub Actions + GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-05-09-gastos-design.md`

---

## ⚠️ Important: Finanzas.jsx is Minified

`src/Finanzas.jsx` is a large (~2000-line) minified file. **Never edit it blindly by line number.** The only safe workflow is: grep for the exact string you need to replace, verify it appears exactly once, then use the Edit tool with that exact old/new string. All grep commands in Task 7 must be run first — the actual variable names in the minified code differ from any readable guesses.

## ⚠️ Important: Field Name Convention

`uploadParser.js` returns camelCase fields (`rawDesc`, `usdRate`) and includes `ym`/`year`. The Supabase `transactions` table uses snake_case (`raw_desc`, `usd_rate`) and `ym`/`year` are `GENERATED ALWAYS` columns — you cannot insert into them. All data from `uploadParser.js` must pass through `normalizeTx()` (defined in `db.js`) before any Supabase insert.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/001_initial_schema.sql` | Create | DB tables, RLS, indexes |
| `.github/workflows/deploy.yml` | Create | CI/CD: build + deploy to gh-pages |
| `vite.config.js` | Modify | Add `base: '/gastos/'` for GitHub Pages |
| `package.json` | Modify | Add `@supabase/supabase-js`, `react-router-dom` |
| `src/supabase.js` | Create | Supabase client singleton — **only imported by db.js and Auth.jsx** |
| `src/Auth.jsx` | Create | Magic link login screen |
| `src/App.jsx` | Modify | HashRouter + session gate + logout + tab routing |
| `src/db.js` | Create | All Supabase data access + `normalizeTx` field mapper |
| `src/categorize.js` | Create | AI categorization logic (vendor hints, cat_log, edge fn call) |
| `src/Finanzas.jsx` | Modify | Remove embedded data; replace localStorage with db.js calls; add new tabs; add logout |
| `src/views/Revisar.jsx` | Create | Review queue tab |
| `src/views/Presupuesto.jsx` | Create | Budget tab |
| `src/views/Auditoria.jsx` | Create | Audit log tab |
| `supabase/functions/categorize-tx/index.ts` | Create | Edge Function: JWT + CORS + Claude API |
| `scripts/migrate-base-data.js` | Create | One-time: insert base transactions into Supabase |
| `.env.local` (gitignored) | Create | Local dev env vars |
| `.env.example` | Create | Template for env vars |

---

## Task 1: GitHub Repo + Supabase Project Setup

> Manual steps — no code yet. Sets up all external infrastructure.

- [ ] **Step 1.1: Create GitHub repo**

  Go to https://github.com/new. Create a **private** repo named `gastos`. Do NOT initialize with README (we already have a local git repo).

- [ ] **Step 1.2: Push existing code to GitHub**

  ```bash
  cd F:/codetests/cleanup/gastos
  git remote add origin https://github.com/<GITHUB_USERNAME>/gastos.git
  git branch -M main
  git push -u origin main
  ```

- [ ] **Step 1.3: Create Supabase project**

  1. Go to https://supabase.com → New project
  2. Name: `gastos`, region: closest to you, generate a strong DB password (save it)
  3. Wait for project to initialize (~1 min)
  4. Project Settings → API → copy `Project URL` and `anon public` key
  5. Project Settings → API → copy `service_role` key (keep secret, never commit)

- [ ] **Step 1.4: Configure Supabase Auth**

  Supabase dashboard → Authentication → URL Configuration:
  - Site URL: `https://<GITHUB_USERNAME>.github.io/gastos/`
  - Redirect URLs: add `https://<GITHUB_USERNAME>.github.io/gastos/`

- [ ] **Step 1.5: Add GitHub Secrets**

  GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
  - `VITE_SUPABASE_URL` = your Supabase Project URL
  - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key

- [ ] **Step 1.6: Create local env file**

  Create `F:/codetests/cleanup/gastos/.env.local`:
  ```
  VITE_SUPABASE_URL=https://your-project.supabase.co
  VITE_SUPABASE_ANON_KEY=your-anon-key-here
  ```

  Create `.env.example`:
  ```
  VITE_SUPABASE_URL=https://your-project.supabase.co
  VITE_SUPABASE_ANON_KEY=your-anon-key-here
  ```

  Add to `.gitignore`:
  ```bash
  echo ".env.local" >> .gitignore
  echo ".env.*.local" >> .gitignore
  ```

---

## Task 2: Database Schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 2.1: Create migrations directory**

  ```bash
  mkdir -p F:/codetests/cleanup/gastos/supabase/migrations
  ```

- [ ] **Step 2.2: Write the schema**

  Create `supabase/migrations/001_initial_schema.sql`:

  ```sql
  -- transactions
  create table public.transactions (
    id            text primary key,
    user_id       uuid not null references auth.users(id) on delete cascade,
    date          date not null,
    ym            text generated always as (to_char(date, 'YYYY-MM')) stored,
    year          int  generated always as (extract(year from date)::int) stored,
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
    created_at    timestamptz default now()
  );

  create index transactions_user_ym  on public.transactions(user_id, ym);
  create index transactions_user_cat on public.transactions(user_id, cat);

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
  ```

- [ ] **Step 2.3: Apply the schema in Supabase**

  Supabase dashboard → SQL Editor → paste the full SQL above → Run.

  Verify: Table Editor → confirm `transactions`, `settings`, `cat_log` exist.

- [ ] **Step 2.4: Commit**

  ```bash
  cd F:/codetests/cleanup/gastos
  git add supabase/migrations/001_initial_schema.sql .env.example .gitignore
  git commit -m "feat: add DB schema migration and env template"
  ```

---

## Task 3: CI/CD — GitHub Actions + GitHub Pages

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `vite.config.js`

- [ ] **Step 3.1: Update vite.config.js**

  ```js
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  export default defineConfig({
    plugins: [react()],
    server: { port: 5174 },
    base: '/gastos/',
  })
  ```

- [ ] **Step 3.2: Create GitHub Actions workflow**

  ```bash
  mkdir -p F:/codetests/cleanup/gastos/.github/workflows
  ```

  Create `.github/workflows/deploy.yml`:
  ```yaml
  name: Deploy to GitHub Pages

  on:
    push:
      branches: [main]

  permissions:
    contents: write

  jobs:
    deploy:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm

        - run: npm ci

        - run: npm run build
          env:
            VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
            VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}

        - uses: peaceiris/actions-gh-pages@v4
          with:
            github_token: ${{ secrets.GITHUB_TOKEN }}
            publish_dir: ./dist
  ```

- [ ] **Step 3.3: Verify build locally**

  ```bash
  cd F:/codetests/cleanup/gastos
  npm run build
  ```

  Expected: `dist/` created, no errors.

- [ ] **Step 3.4: Enable GitHub Pages**

  GitHub repo → Settings → Pages → Source: `Deploy from a branch` → Branch: `gh-pages` / `/ (root)` → Save.

- [ ] **Step 3.5: Commit and push**

  ```bash
  git add vite.config.js .github/workflows/deploy.yml
  git commit -m "feat: add GitHub Actions deploy workflow and Vite base path"
  git push origin main
  ```

  Go to GitHub → Actions → watch the workflow. Once green, visit `https://<GITHUB_USERNAME>.github.io/gastos/` — app should load (still embedded data at this point).

---

## Task 4: Auth Integration

**Files:**
- Install: `@supabase/supabase-js`, `react-router-dom`
- Create: `src/supabase.js`, `src/Auth.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 4.1: Install dependencies**

  ```bash
  cd F:/codetests/cleanup/gastos
  npm install @supabase/supabase-js react-router-dom
  ```

- [ ] **Step 4.2: Create Supabase client singleton**

  Create `src/supabase.js`:
  ```js
  import { createClient } from '@supabase/supabase-js'

  export const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  )
  ```

- [ ] **Step 4.3: Create Auth login screen**

  Create `src/Auth.jsx`:
  ```jsx
  import { useState } from 'react'
  import { supabase } from './supabase.js'

  export default function Auth() {
    const [email, setEmail] = useState('maxi.goldschwartz@gmail.com')
    const [sent, setSent] = useState(false)
    const [error, setError] = useState(null)

    async function sendMagicLink(e) {
      e.preventDefault()
      setError(null)
      const redirectTo = window.location.origin + (import.meta.env.BASE_URL || '/')
      const { error: err } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
      if (err) setError(err.message)
      else setSent(true)
    }

    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#1a1a2e', color:'#e0e0e0', fontFamily:'system-ui,sans-serif' }}>
        <div style={{ width:340, padding:32, background:'#16213e', borderRadius:12 }}>
          <h2 style={{ margin:'0 0 24px', fontSize:22, fontWeight:700 }}>Gastos</h2>
          {sent ? (
            <p style={{ color:'#4ade80' }}>Magic link enviado a <strong>{email}</strong>. Revisá tu correo.</p>
          ) : (
            <form onSubmit={sendMagicLink}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                style={{ width:'100%', padding:'10px 12px', marginBottom:16, background:'#0f3460', border:'1px solid #334', borderRadius:8, color:'#e0e0e0', fontSize:14, boxSizing:'border-box' }} />
              <button type="submit" style={{ width:'100%', padding:'10px 0', background:'#4f46e5', border:'none', borderRadius:8, color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer' }}>
                Enviar magic link
              </button>
              {error && <p style={{ color:'#f87171', marginTop:12, fontSize:13 }}>{error}</p>}
            </form>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 4.4: Rewrite App.jsx with session gate, HashRouter, and logout**

  Replace `src/App.jsx` entirely:
  ```jsx
  import { useEffect, useState } from 'react'
  import { HashRouter } from 'react-router-dom'
  import { supabase } from './supabase.js'
  import Auth from './Auth.jsx'
  import Finanzas from './Finanzas.jsx'

  export default function App() {
    const [session, setSession] = useState(undefined) // undefined = loading

    useEffect(() => {
      supabase.auth.getSession().then(({ data }) => setSession(data.session))
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
      return () => subscription.unsubscribe()
    }, [])

    if (session === undefined) return null
    if (!session) return <Auth />

    return (
      <HashRouter>
        <Finanzas session={session} onLogout={() => supabase.auth.signOut()} />
      </HashRouter>
    )
  }
  ```

- [ ] **Step 4.5: Add logout button to Finanzas.jsx**

  In Finanzas.jsx, the component now receives `onLogout` as a prop. Find where the header/nav bar is rendered (grep for the existing tab buttons), and add a small logout button:

  ```bash
  # Find prop destructuring at the top of the Finanzas function
  grep -o 'function Finanzas([^)]*)\|({[^}]*})' src/Finanzas.jsx | head -3
  ```

  Update the function signature to accept `onLogout`, then add a button in the nav area:
  ```jsx
  <button onClick={onLogout} style={{ marginLeft:'auto', background:'transparent', border:'1px solid #444', color:'#888', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:12 }}>
    Salir
  </button>
  ```

- [ ] **Step 4.6: Verify auth flow**

  ```bash
  npm run dev
  ```

  1. Visit http://localhost:5174 → should see login form
  2. Submit email → "magic link enviado" message appears
  3. Click link in email → redirected back → app loads with existing embedded data
  4. Logout button appears → click it → returns to login screen

- [ ] **Step 4.7: Commit**

  ```bash
  git add src/supabase.js src/Auth.jsx src/App.jsx src/Finanzas.jsx package.json package-lock.json
  git commit -m "feat: add Supabase auth with magic link, logout button"
  git push origin main
  ```

---

## Task 5: Base Data Migration

> Run after Task 4 is complete and you have logged in at least once.

**Files:**
- Create: `scripts/migrate-base-data.js`

- [ ] **Step 5.1: Get your Supabase user UUID**

  After logging into the app locally, open browser console:
  ```js
  (await (await fetch('/gastos/src/supabase.js')).text())
  // Or: Supabase dashboard → Authentication → Users → copy UUID
  ```

  Simpler: Supabase dashboard → Authentication → Users → your email row → copy UUID.

- [ ] **Step 5.2: Install csv-parse**

  ```bash
  cd F:/codetests/cleanup/gastos
  npm install --save-dev csv-parse
  ```

- [ ] **Step 5.3: Create the migration script**

  Note: the CSV is at `F:/google drive/My Drive/CURRENT/code/gastos/transactions_clean.csv`.
  The script is at `F:/codetests/cleanup/gastos/scripts/migrate-base-data.js`.
  From `scripts/`, four `../` levels up reaches `F:/`.

  ```bash
  mkdir -p F:/codetests/cleanup/gastos/scripts
  ```

  Create `scripts/migrate-base-data.js`:
  ```js
  import { createClient } from '@supabase/supabase-js'
  import { createReadStream } from 'fs'
  import { parse } from 'csv-parse'
  import { fileURLToPath } from 'url'
  import path from 'path'

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  const USER_ID = process.argv.find(a => a.startsWith('--user-id='))?.split('=')[1]
  const DRY_RUN = process.argv.includes('--dry-run')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars'); process.exit(1)
  }
  if (!USER_ID) {
    console.error('Pass --user-id=<uuid>'); process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Script is at gastos/scripts/, CSV is at F:/google drive/...
  // Four levels up from scripts/ reaches F:/
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const CSV_PATH = path.join(__dirname, '../../../../google drive/My Drive/CURRENT/code/gastos/transactions_clean.csv')

  async function run() {
    const rows = []
    await new Promise((resolve, reject) => {
      createReadStream(CSV_PATH)
        .pipe(parse({ columns: true, skip_empty_lines: true }))
        .on('data', row => rows.push(row))
        .on('end', resolve)
        .on('error', reject)
    })
    console.log(`Read ${rows.length} rows from CSV`)

    const txs = rows.map((row, i) => ({
      id: `b_${i}`,
      user_id: USER_ID,
      date: row.date || row.fecha || row.Date,
      cat: row.cat || row.category || row.Category || null,
      bank: row.bank || 'Santander',
      ars: parseFloat(row.ars || row.amount || 0),
      usd: parseFloat(row.usd || 0),
      usd_rate: parseFloat(row.usd_rate || row.usdRate || 1050),
      xfer: row.xfer === 'true' || row.xfer === true || false,
      raw_desc: row.raw_desc || row.rawDesc || row.description || '',
      merchant: row.merchant || '',
      referencia: row.referencia || '',
      notes: null,
      project: null,
      ai_assigned: false,
      needs_review: false,
      // Do NOT include ym or year — they are GENERATED ALWAYS AS columns
    })).filter(t => t.date)

    console.log(`Prepared ${txs.length} transactions`)
    if (DRY_RUN) {
      console.log('DRY RUN — first 3:', JSON.stringify(txs.slice(0, 3), null, 2)); return
    }

    const CHUNK = 500
    for (let i = 0; i < txs.length; i += CHUNK) {
      const chunk = txs.slice(i, i + CHUNK)
      const { error } = await supabase.from('transactions').upsert(chunk, { onConflict: 'id' })
      if (error) { console.error(`Chunk ${i}:`, error.message); process.exit(1) }
      console.log(`Inserted rows ${i}–${Math.min(i + CHUNK, txs.length) - 1}`)
    }

    // Create settings row
    const { error: sErr } = await supabase.from('settings').upsert({ user_id: USER_ID }, { onConflict: 'user_id' })
    if (sErr) console.warn('Settings:', sErr.message)
    else console.log('Settings row created.')
    console.log('Migration complete!')
  }

  run()
  ```

- [ ] **Step 5.4: Dry run**

  ```bash
  cd F:/codetests/cleanup/gastos
  SUPABASE_URL=https://your-project.supabase.co \
  SUPABASE_SERVICE_KEY=your-service-role-key \
  node scripts/migrate-base-data.js --user-id=your-uuid --dry-run
  ```

  Expected: row count + first 3 objects printed with snake_case fields, no `ym` or `year`.

- [ ] **Step 5.5: Run the real migration**

  ```bash
  SUPABASE_URL=https://your-project.supabase.co \
  SUPABASE_SERVICE_KEY=your-service-role-key \
  node scripts/migrate-base-data.js --user-id=your-uuid
  ```

  Expected: `Migration complete!` with chunk logs.

- [ ] **Step 5.6: Verify in Supabase**

  Table Editor → `transactions` → confirm ~8,400 rows, `ym` column is populated (generated), `user_id` matches your UUID.

- [ ] **Step 5.7: Commit**

  ```bash
  git add scripts/migrate-base-data.js package.json package-lock.json
  git commit -m "feat: add base data migration script"
  ```

---

## Task 6: Data Layer (db.js)

**Files:**
- Create: `src/db.js`

`db.js` is the **only** file allowed to import from `./supabase.js`. All other files import from `./db.js`.

- [ ] **Step 6.1: Create src/db.js**

  Create `src/db.js`:
  ```js
  import { supabase } from './supabase.js'

  // ─── Field normalizer ─────────────────────────────────────────────────────────
  // uploadParser.js returns camelCase; Supabase table uses snake_case.
  // ym and year are GENERATED ALWAYS — never insert them.

  // Synchronous once userId is known — call normalizeTx(tx, userId) inside upsertTransactions.
  function normalizeTx(tx, userId) {
    const { ym, year, rawDesc, usdRate, ...rest } = tx
    return {
      ...rest,
      user_id: userId,
      raw_desc: rawDesc ?? rest.raw_desc,
      usd_rate: usdRate ?? rest.usd_rate,
    }
  }

  // ─── Transactions ─────────────────────────────────────────────────────────────

  export async function loadTransactions() {
    const { data, error } = await supabase
      .from('transactions').select('*').order('date', { ascending: false })
    if (error) throw error
    return data
  }

  export async function upsertTransactions(txs) {
    // getUser() once — not N times — then map synchronously
    const { data: { user } } = await supabase.auth.getUser()
    const normalized = txs.map(tx => normalizeTx(tx, user.id))
    for (let i = 0; i < normalized.length; i += 200) {
      const { error } = await supabase
        .from('transactions')
        .upsert(normalized.slice(i, i + 200), { onConflict: 'id' })
      if (error) throw error
    }
  }

  export async function updateTransaction(id, fields) {
    const { error } = await supabase.from('transactions').update(fields).eq('id', id)
    if (error) throw error
  }

  export async function loadReviewQueue() {
    const { data, error } = await supabase
      .from('transactions').select('*').eq('needs_review', true).order('date', { ascending: false })
    if (error) throw error
    return data
  }

  // ─── Settings ─────────────────────────────────────────────────────────────────

  export async function loadSettings() {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('settings').select('*').eq('user_id', user.id).maybeSingle()
    if (error) throw error
    return data ?? {
      user_id: user.id, monthly_budget_usd: 0,
      category_budgets: {}, groups: [], vendor_hints: {}, usd_rate: 1050,
    }
  }

  export async function saveSettings(settings) {
    const { error } = await supabase
      .from('settings').upsert(settings, { onConflict: 'user_id' })
    if (error) throw error
  }

  // ─── Cat Log ──────────────────────────────────────────────────────────────────

  export async function appendCatLog(entry) {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('cat_log').insert({ ...entry, user_id: user.id })
    if (error) throw error
  }

  export async function loadCatLog({ limit = 500 } = {}) {
    const { data, error } = await supabase
      .from('cat_log').select('*').order('created_at', { ascending: false }).limit(limit)
    if (error) throw error
    return data
  }

  // Returns the most recent confirmed category for a specific merchant (last 6 months).
  export async function recentCatForMerchant(merchant, monthsBack = 6) {
    if (!merchant) return null
    const since = new Date()
    since.setMonth(since.getMonth() - monthsBack)

    // We join via tx_id: find cat_log entries where the tx has this merchant.
    // Simpler: query cat_log joined through transactions.
    // Since Supabase doesn't do cross-table filter easily in one call,
    // we look up tx_ids for this merchant first, then check cat_log.
    const { data: txIds } = await supabase
      .from('transactions')
      .select('id')
      .eq('merchant', merchant)
      .limit(100)

    if (!txIds?.length) return null
    const ids = txIds.map(t => t.id)

    const { data, error } = await supabase
      .from('cat_log')
      .select('cat_after')
      .in('action', ['user_confirmed', 'user_corrected'])
      .is('note', null)          // .is() is correct for IS NULL in Supabase JS v2
      .in('tx_id', ids)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !data?.length) return null
    return data[0].cat_after
  }

  // Returns all confirmed/corrected cat_log entries for a specific merchant (for vendor hint check).
  export async function loadCatLogForMerchant(merchant) {
    if (!merchant) return []
    const { data: txIds } = await supabase
      .from('transactions').select('id').eq('merchant', merchant).limit(200)
    if (!txIds?.length) return []
    const ids = txIds.map(t => t.id)
    const { data, error } = await supabase
      .from('cat_log')
      .select('cat_after')
      .in('action', ['user_confirmed', 'user_corrected'])
      .is('note', null)
      .in('tx_id', ids)
    if (error) return []
    return data ?? []
  }
  ```

- [ ] **Step 6.2: Verify db.js loads**

  ```bash
  npm run dev
  ```

  Open browser console, run:
  ```js
  const { loadSettings } = await import('/gastos/src/db.js?v=1')
  console.log(await loadSettings())
  ```

  Expected: settings object with default values.

---

## Task 7: Refactor Finanzas.jsx to Load from Supabase

> Most delicate task. Always grep first, then edit with the exact found strings.

**Files:**
- Modify: `src/Finanzas.jsx`

**Goal:** remove the `_D`/`dec()` embedded data, replace localStorage reads/writes with `db.js` calls. Dashboard/Totals/Transactions UI is unchanged.

- [ ] **Step 7.1: Discover the actual variable names via grep**

  Run all of these before writing any code:

  ```bash
  cd F:/codetests/cleanup/gastos/src

  # Find what the Finanzas function signature looks like
  grep -o 'function Finanzas([^{]*' Finanzas.jsx

  # Find localStorage key constants
  grep -o 'SK[A-Z]\?="[^"]*"' Finanzas.jsx

  # Find all localStorage references
  grep -o 'localStorage\.[a-zA-Z]*([^)]*)[^;]*' Finanzas.jsx

  # Find the _D constant (first 60 chars of the value)
  grep -o 'const _D=".\{0,60\}' Finanzas.jsx

  # Find dec() function signature
  grep -o 'function dec([^)]*)[^{]*{' Finanzas.jsx

  # Find dec() call sites (where the embedded data is consumed)
  grep -o 'dec([^)]*)[^,;]*' Finanzas.jsx | head -5

  # Find the data/useMemo that merges transactions
  grep -o 'return\[\.\.\.d,\.\.\.u\]\|return\[\.\.\.dec[^]]*\]' Finanzas.jsx

  # Find the confirmUpload function
  grep -o 'confirmUpload[^{]*{[^}]*}' Finanzas.jsx | head -3

  # Find uploaded-txs state (the set/get pair)
  grep -o '_u[a-z]*\|sU[A-Z][a-z]*' Finanzas.jsx | sort | uniq
  ```

  **Record the actual names before proceeding.** The replacements in steps below use placeholder names in angle brackets — substitute the real names found by grep.

- [ ] **Step 7.2: Add db.js import to Finanzas.jsx**

  Find the last existing import statement in Finanzas.jsx:
  ```bash
  grep -n '^import' src/Finanzas.jsx | tail -3
  ```

  After the last import, add (using the Edit tool with the exact found import string as `old_string`, and that same string + newline + new import as `new_string`):
  ```js
  import{loadTransactions,upsertTransactions,loadSettings}from"./db.js";
  ```

- [ ] **Step 7.3: Replace the data-loading useEffect**

  Find the useEffect that reads from localStorage on mount (will reference a localStorage key constant). Replace its body with a Supabase load. The new body:

  ```js
  useEffect(()=>{
    loadTransactions()
      .then(txs=>{ /* call the actual state setter found by grep */ })
      .catch(e=>console.error('load txs',e));
    loadSettings()
      .then(s=>{ if(s.usd_rate) /* call the actual USD rate setter */ })
      .catch(()=>{});
  },[]);
  ```

- [ ] **Step 7.4: Replace confirmUpload**

  Find the `confirmUpload` function via grep. Replace its body with:
  ```js
  async function confirmUpload(){
    await upsertTransactions(/* actual preview state variable */);
    const fresh=await loadTransactions();
    /* call actual setTxs and setPreview setters with fresh and [] */
    /* close modal */
  }
  ```

- [ ] **Step 7.5: Remove the ed/gr localStorage state**

  The minified file stores per-transaction category overrides in a state variable keyed to a localStorage constant (grep finds it — likely `SKE`), and group definitions in another (likely `SKG`). After migration, `tx.cat` in Supabase is authoritative and overrides are persisted via `updateTransaction`.

  Find and remove:
  - The `useEffect` that loads `ed` (category edits) from localStorage
  - The `svE` (save edits) function that writes to localStorage
  - The `svG` (save groups) function that writes to localStorage

  For category edits: replace any `ed[id]` override in the render with just `tx.cat` (the Supabase value is authoritative).
  For groups: `settings.groups` from Supabase replaces the localStorage state.

  ```bash
  grep -o 'SKE\|SKG\|svE\|svG\|localStorage\.setItem' src/Finanzas.jsx
  ```

- [ ] **Step 7.6: Remove _D and dec()**

  ```bash
  # Find the byte offsets to identify exact boundaries
  grep -n '_D=' src/Finanzas.jsx | head -3
  grep -n 'function dec(' src/Finanzas.jsx
  ```

  Use the Edit tool to remove:
  1. The `const _D="...huge string..."` assignment (the old_string is `const _D="` through the closing `"` — match enough of the start and end to be unique)
  2. The `function dec(...){...}` definition
  3. Any `dec(_D)` call site in the data useMemo

  After removal, the `data` useMemo should return just the Supabase-loaded transactions state directly.

- [ ] **Step 7.7: Verify**

  ```bash
  npm run dev
  ```

  Log in → all three existing tabs (Dashboard, Totals, Transactions) should display data loaded from Supabase. File count in the browser console should match Supabase row count.

- [ ] **Step 7.8: Commit**

  ```bash
  git add src/Finanzas.jsx src/db.js
  git commit -m "feat: replace embedded data + localStorage with Supabase data layer"
  git push origin main
  ```

---

## Task 8: Edge Function — categorize-tx

**Files:**
- Create: `supabase/functions/categorize-tx/index.ts`

- [ ] **Step 8.1: Create the Edge Function**

  ```bash
  mkdir -p F:/codetests/cleanup/gastos/supabase/functions/categorize-tx
  ```

  Create `supabase/functions/categorize-tx/index.ts`:
  ```typescript
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const GITHUB_PAGES_ORIGIN = Deno.env.get('GITHUB_PAGES_ORIGIN') ?? '*'

  const corsHeaders = {
    'Access-Control-Allow-Origin': GITHUB_PAGES_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let body: { merchant: string; rawDesc: string; amount: number; availableCategories: string[] }
    try { body = await req.json() }
    catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }

    const descriptor = body.merchant || body.rawDesc || '(unknown)'

    const prompt = `You are categorizing a bank transaction for a personal finance app.

Transaction descriptor: "${descriptor}"
Amount (ARS, negative = expense): ${body.amount}
Available categories: ${body.availableCategories.join(', ')}

Reply with ONLY a JSON object (no markdown, no explanation):
{"cat": "<category from the list>", "confidence": <0.0-1.0>, "reasoning": "<one sentence>"}`

    let claudeResponse
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
      claudeResponse = await res.json()
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let parsed
    try { parsed = JSON.parse(claudeResponse.content[0].text.trim()) }
    catch { return new Response(JSON.stringify({ error: 'Malformed Claude response' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }

    return new Response(JSON.stringify({
      cat: parsed.cat, confidence: parsed.confidence, reasoning: parsed.reasoning,
      promptTokens: claudeResponse.usage?.input_tokens,
      completionTokens: claudeResponse.usage?.output_tokens,
      model: claudeResponse.model,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  })
  ```

- [ ] **Step 8.2: Set Supabase secrets**

  Supabase dashboard → Settings → Edge Functions → Secrets:
  - `ANTHROPIC_API_KEY` = your Anthropic API key
  - `GITHUB_PAGES_ORIGIN` = `https://<GITHUB_USERNAME>.github.io`

- [ ] **Step 8.3: Install Supabase CLI and deploy**

  ```bash
  npm install --save-dev supabase
  npx supabase login
  npx supabase link --project-ref your-project-ref
  npx supabase functions deploy categorize-tx
  ```

  The project ref is the subdomain part of your Supabase URL (between `https://` and `.supabase.co`).

- [ ] **Step 8.4: Test the function from browser console**

  While logged in at localhost:5174:
  ```js
  const { supabase } = await import('/gastos/src/supabase.js?v=1')
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env?.VITE_SUPABASE_URL ?? 'https://your-project.supabase.co'}/functions/v1/categorize-tx`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant: 'YPF', rawDesc: 'DEBITO | YPF PALERMO', amount: -15000,
      availableCategories: ['Gas','Food','Dining','Healthcare','Transportation','Entertainment','Uncategorized Expenses'] }),
  })
  console.log(await res.json())
  ```

  Expected: `{ cat: "Gas", confidence: 0.95, reasoning: "..." }`

- [ ] **Step 8.5: Commit**

  ```bash
  git add supabase/functions/categorize-tx/index.ts package.json package-lock.json
  git commit -m "feat: add categorize-tx Edge Function with JWT + CORS"
  git push origin main
  ```

---

## Task 9: AI Categorization Logic (categorize.js)

**Files:**
- Create: `src/categorize.js`

Note: `uploadParser.js` gives camelCase fields (`rawDesc`, `usdRate`). After `upsertTransactions` is called, those fields are normalized to snake_case in the DB. But during the categorization step (before insert), the tx objects still have camelCase — so access `tx.rawDesc` and `tx.merchant` directly here.

`categorize.js` does NOT import from `supabase.js` directly (only `db.js` and `Auth.jsx` may). Instead, the caller retrieves the session token once and passes it into `categorizeTx`. This keeps the singleton boundary clean.

- [ ] **Step 9.1: Create src/categorize.js**

  Create `src/categorize.js`:
  ```js
  import { appendCatLog, recentCatForMerchant } from './db.js'

  const EDGE_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/categorize-tx`

  export const AVAILABLE_CATEGORIES = [
    'Dining','Food','Gas','Healthcare','AR taxes','Carhué obra',
    'Boat maintenance','Amazon FBA','transportation','Clothing',
    'Entertainment','Travel','pets','sports and exercise',
    'Home utilities','Shopping','Uncategorized Expenses',
  ]

  /**
   * Categorize a single parsed transaction (camelCase fields from uploadParser).
   * Mutates tx in place. Returns { catBanner: string | null }.
   * @param {string} accessToken  — caller retrieves once via supabase.auth.getSession()
   */
  export async function categorizeTx(tx, settings, accessToken) {
    const merchant = tx.merchant || ''
    const rawDesc = tx.rawDesc || tx.raw_desc || ''
    const key = merchant || rawDesc

    if (!key.trim()) {
      tx.needs_review = true
      tx.cat = 'Uncategorized Expenses'
      return { catBanner: null }
    }

    // vendor_hints check
    const hint = settings.vendor_hints?.[key]
    if (hint) {
      tx.cat = hint.cat
      if (hint.project) tx.project = hint.project
      tx.ai_assigned = false
      tx.needs_review = false
      return { catBanner: null }
    }

    // Recent cat_log check
    const recentCat = await recentCatForMerchant(merchant || rawDesc)
    if (recentCat) {
      tx.cat = recentCat
      tx.ai_assigned = false
      tx.needs_review = false
      return { catBanner: null }
    }

    // Call Edge Function (token passed in by caller — no supabase import needed here)
    let result
    try {
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant, rawDesc, amount: tx.ars,
          availableCategories: AVAILABLE_CATEGORIES,
        }),
      })
      if (!res.ok) throw new Error(`Edge Function ${res.status}`)
      result = await res.json()
      if (result.error) throw new Error(result.error)
    } catch (err) {
      tx.needs_review = true
      tx.ai_assigned = false
      await appendCatLog({ tx_id: tx.id, action: 'ai_error', cat_before: null, cat_after: null, note: String(err) }).catch(() => {})
      return { catBanner: `AI error for "${key}": ${err.message}` }
    }

    const { cat, confidence, reasoning, promptTokens, completionTokens, model } = result
    const catIsValid = AVAILABLE_CATEGORIES.includes(cat)

    if (confidence >= 0.75 && catIsValid) {
      tx.cat = cat; tx.ai_assigned = true; tx.ai_confidence = confidence; tx.needs_review = false
      await appendCatLog({ tx_id: tx.id, action: 'ai_assigned', cat_before: null, cat_after: cat, confidence, note: reasoning, prompt_tokens: promptTokens, completion_tokens: completionTokens, model }).catch(() => {})
    } else {
      tx.cat = cat ?? 'Uncategorized Expenses'; tx.ai_assigned = false; tx.ai_confidence = confidence; tx.needs_review = true
      await appendCatLog({ tx_id: tx.id, action: 'ai_skipped', cat_before: null, cat_after: tx.cat, confidence, note: reasoning, prompt_tokens: promptTokens, completion_tokens: completionTokens, model }).catch(() => {})
    }
    return { catBanner: null }
  }

  /**
   * After user confirms/corrects, check if vendor hint threshold is met.
   * Pass in entries from loadCatLogForMerchant().
   * Returns the category to auto-assign, or null.
   */
  export function shouldAddVendorHint(confirmedEntries) {
    if (confirmedEntries.length < 5) return null
    const counts = {}
    for (const e of confirmedEntries) counts[e.cat_after] = (counts[e.cat_after] || 0) + 1
    const [topCat, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return topCount / confirmedEntries.length > 0.8 ? topCat : null
  }
  ```

- [ ] **Step 9.2: Integrate into upload flow in Finanzas.jsx**

  Add import at top:
  ```js
  import{categorizeTx,AVAILABLE_CATEGORIES}from"./categorize.js";
  ```

  Find `confirmUpload` (already replaced in Task 7). Update it to run categorization before upsert.
  The caller gets the session token once and passes it into each `categorizeTx` call — that way
  `categorize.js` never needs to import from `supabase.js`:

  ```js
  async function confirmUpload(){
    const [settings,{data:{session}}]=await Promise.all([loadSettings(),supabase.auth.getSession()]);
    const errors=[];
    for(const tx of /* actual preview array variable */){
      const{catBanner}=await categorizeTx(tx,settings,session.access_token);
      if(catBanner)errors.push(catBanner);
    }
    await upsertTransactions(/* actual preview array variable */);
    const fresh=await loadTransactions();
    /* update state: setTxs(fresh), close modal, clear preview */
    if(errors.length)alert(`${errors.length} AI error(s):\n${errors.slice(0,3).join('\n')}`);
  }
  ```

- [ ] **Step 9.3: Test upload + categorization**

  1. `npm run dev` → log in → upload a Santander XLSX
  2. Click Confirmar
  3. Check Supabase `cat_log` → `ai_assigned` and/or `ai_skipped` rows appear
  4. Transactions with low confidence should have `needs_review=true`

- [ ] **Step 9.4: Commit**

  ```bash
  git add src/categorize.js src/Finanzas.jsx
  git commit -m "feat: AI categorization on upload via Edge Function"
  git push origin main
  ```

---

## Task 10: Review Queue (Revisar Tab)

**Files:**
- Create: `src/views/Revisar.jsx`
- Modify: `src/Finanzas.jsx` (add tab)

- [ ] **Step 10.1: Create src/views/Revisar.jsx**

  ```bash
  mkdir -p F:/codetests/cleanup/gastos/src/views
  ```

  Create `src/views/Revisar.jsx`:
  ```jsx
  import { useState, useEffect } from 'react'
  import { loadReviewQueue, updateTransaction, appendCatLog, loadSettings, saveSettings, loadCatLogForMerchant } from '../db.js'
  import { AVAILABLE_CATEGORIES, shouldAddVendorHint } from '../categorize.js'

  const S = {
    wrap: { padding:24, color:'#e0e0e0', fontFamily:'system-ui,sans-serif' },
    row: { background:'#16213e', borderRadius:8, padding:16, marginBottom:12 },
    label: { fontSize:11, color:'#888', marginBottom:4 },
    sel: { background:'#0f3460', border:'1px solid #334', borderRadius:6, color:'#e0e0e0', padding:'6px 10px', fontSize:13 },
    btn: (c) => ({ background:c, border:'none', borderRadius:6, color:'#fff', padding:'8px 16px', cursor:'pointer', fontSize:13, fontWeight:600, marginRight:8 }),
  }

  export default function Revisar() {
    const [queue, setQueue] = useState(null)
    const [saving, setSaving] = useState({})

    useEffect(() => {
      loadReviewQueue().then(setQueue).catch(console.error)
    }, [])

    async function confirm(tx, chosenCat, project, notes) {
      setSaving(s => ({ ...s, [tx.id]: true }))
      const action = chosenCat === tx.cat ? 'user_confirmed' : 'user_corrected'

      await updateTransaction(tx.id, {
        cat: chosenCat,
        project: project || tx.project,
        notes: notes || tx.notes,
        needs_review: false,
      })

      await appendCatLog({
        tx_id: tx.id, action,
        cat_before: tx.cat, cat_after: chosenCat,
        confidence: tx.ai_confidence,
      })

      // Vendor pattern learning: use db.js function, never import supabase directly
      const key = tx.merchant || tx.raw_desc || ''
      if (key) {
        const [settings, catLogEntries] = await Promise.all([
          loadSettings(),
          loadCatLogForMerchant(tx.merchant || ''),
        ])
        const topCat = shouldAddVendorHint(catLogEntries)
        if (topCat) {
          const hints = { ...(settings.vendor_hints || {}), [key]: { cat: topCat } }
          await saveSettings({ ...settings, vendor_hints: hints })
        }
      }

      setQueue(q => q.filter(t => t.id !== tx.id))
      setSaving(s => { const n = { ...s }; delete n[tx.id]; return n })
    }

    if (!queue) return <div style={S.wrap}>Cargando...</div>
    if (!queue.length) return <div style={S.wrap}><p style={{ color:'#4ade80' }}>Sin transacciones por revisar ✓</p></div>

    return (
      <div style={S.wrap}>
        <h2 style={{ margin:'0 0 20px', fontSize:18 }}>Revisar ({queue.length})</h2>
        {queue.map(tx => <TxReviewRow key={tx.id} tx={tx} onConfirm={confirm} busy={!!saving[tx.id]} />)}
      </div>
    )
  }

  function TxReviewRow({ tx, onConfirm, busy }) {
    const [cat, setCat] = useState(tx.cat || '')
    const [project, setProject] = useState(tx.project || '')
    const [notes, setNotes] = useState(tx.notes || '')

    return (
      <div style={S.row}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
          <span style={{ fontWeight:600 }}>{tx.merchant || tx.raw_desc}</span>
          <span style={{ color:tx.ars < 0 ? '#f87171':'#4ade80', fontWeight:700 }}>
            {tx.ars?.toLocaleString('es-AR', { style:'currency', currency:'ARS' })}
          </span>
        </div>
        <div style={S.label}>{tx.date} · {tx.bank}</div>
        {tx.raw_desc && <div style={{ color:'#888', fontSize:12, marginBottom:8 }}>{tx.raw_desc}</div>}
        {tx.ai_confidence != null && (
          <div style={{ ...S.label, marginBottom:8 }}>
            AI sugirió: <strong style={{ color:'#e0e0e0' }}>{tx.cat}</strong>{' '}
            (confianza: {Math.round((tx.ai_confidence || 0) * 100)}%)
          </div>
        )}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:10 }}>
          <select value={cat} onChange={e => setCat(e.target.value)} style={S.sel}>
            {AVAILABLE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <input placeholder="Proyecto" value={project} onChange={e => setProject(e.target.value)} style={{ ...S.sel, width:140 }} />
          <input placeholder="Notas" value={notes} onChange={e => setNotes(e.target.value)} style={{ ...S.sel, width:200 }} />
        </div>
        <button onClick={() => onConfirm(tx, cat, project, notes)} disabled={busy} style={S.btn('#4f46e5')}>
          {busy ? 'Guardando...' : 'Confirmar'}
        </button>
      </div>
    )
  }
  ```

- [ ] **Step 10.2: Add Revisar tab to Finanzas.jsx**

  Add import:
  ```js
  import Revisar from"./views/Revisar.jsx";
  ```

  Grep for the tab bar rendering pattern:
  ```bash
  grep -o '"Dashboard"\|"Totals"\|"Transactions"\|dashboard\|totals\|transactions' src/Finanzas.jsx | head -10
  ```

  Add "Revisar" button matching the existing tab style, and render `<Revisar/>` when that tab is active.

- [ ] **Step 10.3: Verify**

  Upload XLSX → confirm upload → click Revisar → review rows appear → confirm one → it disappears. Check `cat_log` in Supabase.

- [ ] **Step 10.4: Commit**

  ```bash
  git add src/views/Revisar.jsx src/Finanzas.jsx
  git commit -m "feat: add Revisar (review queue) tab"
  git push origin main
  ```

---

## Task 11: Budget Tab (Presupuesto)

**Files:**
- Create: `src/views/Presupuesto.jsx`
- Modify: `src/Finanzas.jsx` (add tab, pass `txs` prop)

- [ ] **Step 11.1: Create src/views/Presupuesto.jsx**

  Create `src/views/Presupuesto.jsx`:
  ```jsx
  import { useState, useEffect, useMemo } from 'react'
  import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
  import { loadSettings, saveSettings } from '../db.js'

  const S = {
    wrap: { padding:24, color:'#e0e0e0', fontFamily:'system-ui,sans-serif' },
    section: { background:'#16213e', borderRadius:8, padding:20, marginBottom:20 },
    label: { fontSize:12, color:'#888', marginBottom:6 },
    input: { background:'#0f3460', border:'1px solid #334', borderRadius:6, color:'#e0e0e0', padding:'6px 10px', fontSize:13, width:120 },
    btn: { background:'#4f46e5', border:'none', borderRadius:6, color:'#fff', padding:'8px 16px', cursor:'pointer', fontSize:13, fontWeight:600, marginTop:12 },
  }

  export default function Presupuesto({ txs }) {
    const [settings, setSettings] = useState(null)
    const [budget, setBudget] = useState(0)
    const [catBudgets, setCatBudgets] = useState({})
    const [project, setProject] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
      loadSettings().then(s => {
        setSettings(s); setBudget(s.monthly_budget_usd || 0); setCatBudgets(s.category_budgets || {})
      })
    }, [])

    const currentYear = new Date().getFullYear()

    const monthlyData = useMemo(() => {
      if (!txs) return []
      const months = {}
      for (const tx of txs) {
        if (tx.year !== currentYear || tx.xfer || tx.usd >= 0) continue
        months[tx.ym] = (months[tx.ym] || 0) + Math.abs(tx.usd)
      }
      return Object.entries(months).sort().map(([ym, spent]) => ({ ym, spent: +spent.toFixed(2) }))
    }, [txs, currentYear])

    const cats = useMemo(() => {
      if (!txs) return []
      const acc = {}
      for (const tx of txs) {
        if (tx.xfer || tx.usd >= 0) continue
        acc[tx.cat] = (acc[tx.cat] || 0) + Math.abs(tx.usd)
      }
      return Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([cat, total]) => ({ cat, total: +total.toFixed(2) }))
    }, [txs])

    const projectQuery = useMemo(() => {
      if (!project || !txs) return []
      return txs.filter(tx => {
        if ((tx.project || '').toLowerCase() !== project.toLowerCase()) return false
        if (dateFrom && tx.date < dateFrom) return false
        if (dateTo && tx.date > dateTo) return false
        return true
      })
    }, [txs, project, dateFrom, dateTo])

    const projectTotal = projectQuery.reduce((s, t) => s + Math.abs(t.usd || 0), 0)

    async function save() {
      setSaving(true)
      await saveSettings({ ...settings, monthly_budget_usd: +budget, category_budgets: catBudgets })
      setSaving(false)
    }

    if (!settings) return <div style={S.wrap}>Cargando...</div>

    return (
      <div style={S.wrap}>
        <div style={S.section}>
          <h3 style={{ margin:'0 0 16px' }}>Gasto mensual vs presupuesto ({currentYear})</h3>
          <div style={{ marginBottom:16 }}>
            <div style={S.label}>Presupuesto mensual total (USD)</div>
            <input type="number" value={budget} onChange={e => setBudget(e.target.value)} style={S.input} />
            <button onClick={save} disabled={saving} style={S.btn}>{saving ? 'Guardando...' : 'Guardar'}</button>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyData}>
              <XAxis dataKey="ym" tick={{ fill:'#888', fontSize:11 }} />
              <YAxis tick={{ fill:'#888', fontSize:11 }} />
              <Tooltip contentStyle={{ background:'#16213e', border:'1px solid #334', color:'#e0e0e0' }} />
              <ReferenceLine y={+budget} stroke="#f59e0b" strokeDasharray="4 2" label={{ value:'Budget', fill:'#f59e0b', fontSize:11 }} />
              <Bar dataKey="spent" fill="#4f46e5" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={S.section}>
          <h3 style={{ margin:'0 0 16px' }}>Por categoría (histórico)</h3>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ color:'#888' }}>
                <th style={{ textAlign:'left', padding:'4px 8px' }}>Categoría</th>
                <th style={{ textAlign:'right', padding:'4px 8px' }}>Total USD</th>
                <th style={{ textAlign:'right', padding:'4px 8px' }}>Presupuesto/mes</th>
              </tr>
            </thead>
            <tbody>
              {cats.map(({ cat, total }) => (
                <tr key={cat} style={{ borderTop:'1px solid #334' }}>
                  <td style={{ padding:'6px 8px' }}>{cat}</td>
                  <td style={{ padding:'6px 8px', textAlign:'right' }}>${total.toFixed(0)}</td>
                  <td style={{ padding:'6px 8px', textAlign:'right' }}>
                    <input type="number" value={catBudgets[cat] || ''} placeholder="—"
                      onChange={e => setCatBudgets(b => ({ ...b, [cat]: +e.target.value }))}
                      style={{ ...S.input, width:80, textAlign:'right' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={save} disabled={saving} style={S.btn}>{saving ? 'Guardando...' : 'Guardar presupuestos'}</button>
        </div>

        <div style={S.section}>
          <h3 style={{ margin:'0 0 16px' }}>Gasto por proyecto</h3>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:16 }}>
            <div><div style={S.label}>Proyecto</div><input value={project} onChange={e => setProject(e.target.value)} placeholder="nombre" style={S.input} /></div>
            <div><div style={S.label}>Desde</div><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={S.input} /></div>
            <div><div style={S.label}>Hasta</div><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={S.input} /></div>
          </div>
          {project && (
            <>
              <div style={{ fontWeight:700, marginBottom:12 }}>Total: ${projectTotal.toFixed(2)} USD ({projectQuery.length} transacciones)</div>
              <div style={{ maxHeight:300, overflowY:'auto' }}>
                {projectQuery.map(tx => (
                  <div key={tx.id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #334', fontSize:13 }}>
                    <span>{tx.date} · {tx.merchant || tx.raw_desc}</span>
                    <span style={{ color:'#f87171' }}>${Math.abs(tx.usd || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 11.2: Add Presupuesto tab to Finanzas.jsx**

  ```js
  import Presupuesto from"./views/Presupuesto.jsx";
  ```

  Add tab + render `<Presupuesto txs={data}/>` where `data` is the transactions array already used by other tabs.

- [ ] **Step 11.3: Verify and commit**

  Test: budget persists across reload, project query filters correctly.

  ```bash
  git add src/views/Presupuesto.jsx src/Finanzas.jsx
  git commit -m "feat: add Presupuesto (budget) tab"
  git push origin main
  ```

---

## Task 12: Audit Log Tab (Auditoría)

**Files:**
- Create: `src/views/Auditoria.jsx`
- Modify: `src/Finanzas.jsx` (add tab)

- [ ] **Step 12.1: Create src/views/Auditoria.jsx**

  Create `src/views/Auditoria.jsx`:
  ```jsx
  import { useState, useEffect, useMemo } from 'react'
  import { loadCatLog } from '../db.js'

  const ACTION_COLORS = { ai_assigned:'#4ade80', user_confirmed:'#60a5fa', user_corrected:'#f59e0b', ai_skipped:'#888', ai_error:'#f87171' }
  const S = {
    wrap: { padding:24, color:'#e0e0e0', fontFamily:'system-ui,sans-serif' },
    stats: { display:'flex', gap:16, flexWrap:'wrap', marginBottom:20 },
    stat: { background:'#16213e', borderRadius:8, padding:'12px 20px', minWidth:120 },
    statNum: { fontSize:22, fontWeight:700 },
    statLabel: { fontSize:12, color:'#888', marginTop:4 },
    filter: { background:'#0f3460', border:'1px solid #334', borderRadius:6, color:'#e0e0e0', padding:'6px 10px', fontSize:13 },
    th: { textAlign:'left', padding:'6px 8px', color:'#888', borderBottom:'1px solid #334' },
    td: { padding:'8px 8px', borderBottom:'1px solid #1e2a4a', verticalAlign:'top', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  }

  export default function Auditoria() {
    const [log, setLog] = useState(null)
    const [actionFilter, setActionFilter] = useState('all')
    const [dateFrom, setDateFrom] = useState('')

    useEffect(() => {
      loadCatLog({ limit: 1000 }).then(setLog).catch(console.error)
    }, [])

    const filtered = useMemo(() => {
      if (!log) return []
      return log.filter(e => {
        if (actionFilter !== 'all' && e.action !== actionFilter) return false
        if (dateFrom && e.created_at < dateFrom) return false
        return true
      })
    }, [log, actionFilter, dateFrom])

    const stats = useMemo(() => {
      if (!log) return {}
      const total = log.length
      const aiCalls = log.filter(e => ['ai_assigned','ai_skipped','ai_error'].includes(e.action)).length
      const autoAssigned = log.filter(e => e.action === 'ai_assigned').length
      const errors = log.filter(e => e.action === 'ai_error').length
      const totalTokens = log.reduce((s, e) => s + (e.prompt_tokens || 0) + (e.completion_tokens || 0), 0)
      return { total, aiCalls, autoAssigned, errors, totalTokens, autoRate: aiCalls ? Math.round(autoAssigned/aiCalls*100) : 0 }
    }, [log])

    if (!log) return <div style={S.wrap}>Cargando...</div>

    return (
      <div style={S.wrap}>
        <h2 style={{ margin:'0 0 20px', fontSize:18 }}>Auditoría de categorización</h2>
        <div style={S.stats}>
          <div style={S.stat}><div style={S.statNum}>{stats.total}</div><div style={S.statLabel}>Entradas totales</div></div>
          <div style={S.stat}><div style={S.statNum}>{stats.aiCalls}</div><div style={S.statLabel}>Llamadas AI</div></div>
          <div style={S.stat}><div style={S.statNum}>{stats.autoRate}%</div><div style={S.statLabel}>Auto-asignadas</div></div>
          <div style={S.stat}><div style={S.statNum}>{stats.errors}</div><div style={{ ...S.statLabel, color: stats.errors ? '#f87171':'#888' }}>Errores AI</div></div>
          <div style={S.stat}><div style={S.statNum}>{stats.totalTokens.toLocaleString()}</div><div style={S.statLabel}>Tokens usados</div></div>
        </div>
        <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={S.filter}>
            <option value="all">Todas las acciones</option>
            <option value="ai_assigned">ai_assigned</option>
            <option value="user_confirmed">user_confirmed</option>
            <option value="user_corrected">user_corrected</option>
            <option value="ai_skipped">ai_skipped</option>
            <option value="ai_error">ai_error</option>
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={S.filter} />
          <span style={{ color:'#888', alignSelf:'center', fontSize:13 }}>{filtered.length} entradas</span>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>{['Fecha','TX ID','Acción','Antes','Después','Conf.','Nota','Tokens','Modelo'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td style={S.td}>{e.created_at?.slice(0,16)}</td>
                  <td style={{ ...S.td, color:'#666' }}>{e.tx_id}</td>
                  <td style={{ ...S.td, color:ACTION_COLORS[e.action]||'#888', fontWeight:600 }}>{e.action}</td>
                  <td style={{ ...S.td, color:'#888' }}>{e.cat_before}</td>
                  <td style={S.td}>{e.cat_after}</td>
                  <td style={S.td}>{e.confidence != null ? `${Math.round(e.confidence*100)}%` : '—'}</td>
                  <td style={{ ...S.td, color:'#888' }} title={e.note}>{e.note}</td>
                  <td style={S.td}>{e.prompt_tokens ? `${e.prompt_tokens}+${e.completion_tokens}` : '—'}</td>
                  <td style={{ ...S.td, color:'#666' }}>{e.model}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 12.2: Add Auditoría tab to Finanzas.jsx**

  ```js
  import Auditoria from"./views/Auditoria.jsx";
  ```

  Add tab + render `<Auditoria/>`.

- [ ] **Step 12.3: Verify and commit**

  ```bash
  git add src/views/Auditoria.jsx src/Finanzas.jsx
  git commit -m "feat: add Auditoría (audit log) tab"
  git push origin main
  ```

---

## Task 13: Final End-to-End Verification

- [ ] **Step 13.1: Full flow on localhost**

  1. `npm run dev` → log in → all 6 tabs load
  2. Upload Santander XLSX → AI categorizes → some go to Revisar
  3. Revisar: confirm transactions → disappear from queue, appear in Auditoría
  4. Presupuesto: set budget, query a project label
  5. Auditoría: stats correct, filter by action works
  6. Logout → login screen

- [ ] **Step 13.2: Full flow on GitHub Pages**

  Push to main → wait for Actions → visit `https://<GITHUB_USERNAME>.github.io/gastos/`:
  - Login screen → magic link → app loads
  - All 6 tabs work with real Supabase data
  - Upload XLSX → Edge Function categorizes (check CORS works)

- [ ] **Step 13.3: Final commit**

  ```bash
  git add -A
  git commit -m "chore: cloud migration complete — all 6 tabs verified on Pages + Supabase"
  git tag v1.0.0
  git push origin main --tags
  ```

---

## Task 14: Historical Dólar Blue Exchange Rates

**Problem:** The current code uses a single fixed `usd_rate` (e.g. 1050) for all transactions. This is wrong — the dólar blue rate has varied enormously over 2020–2025. All existing `usd` values in the DB need to be recalculated using the correct historical rate for each transaction date.

**Files:**
- Create: `scripts/fetch-blue-rates.js` — fetch historical dólar blue series from bluelytics API
- Create: `scripts/recalc-usd.js` — recalculate `usd` for every transaction using date-matched blue rate
- Modify: `src/uploadParser.js` — stop accepting a user-entered fixed rate; instead look up the historic rate for the transaction date
- Add: `supabase/migrations/002_blue_rates.sql` — `blue_rates` table (date, rate)
- Modify: `src/db.js` — add `loadBlueRate(date)` function

**Steps:**

- [ ] **Step 14.1: Create blue_rates table**

  Apply via Supabase MCP / SQL Editor:
  ```sql
  create table public.blue_rates (
    date    date primary key,
    rate    numeric not null,  -- ARS per USD, dólar blue
    source  text default 'bluelytics'
  );
  -- No RLS — this is reference data, read by all authenticated users
  alter table public.blue_rates enable row level security;
  create policy "authenticated users can read blue_rates"
    on public.blue_rates for select
    using (auth.role() = 'authenticated');
  ```

- [ ] **Step 14.2: Fetch and populate historical rates**

  Create `scripts/fetch-blue-rates.js`:
  ```js
  // Fetches daily dólar blue rates from bluelytics.com.ar
  // and inserts into Supabase blue_rates table.
  // API: https://api.bluelytics.com.ar/v2/evolution.json (returns full history)
  import { createClient } from '@supabase/supabase-js'

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  async function run() {
    const res = await fetch('https://api.bluelytics.com.ar/v2/evolution.json')
    if (!res.ok) throw new Error(`bluelytics API ${res.status}`)
    const data = await res.json()

    // Response is array of {date, value_sell, value_buy, ...} for blue + oficial
    // Filter to blue only, use value_sell (what you pay to buy USD)
    const rows = data
      .filter(d => d.source === 'Blue')
      .map(d => ({ date: d.date.slice(0, 10), rate: d.value_sell }))
      .filter(d => d.date >= '2020-01-01')

    console.log(`Fetched ${rows.length} blue rate entries`)

    // Upsert in chunks
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('blue_rates').upsert(rows.slice(i, i + 500), { onConflict: 'date' })
      if (error) { console.error(error.message); process.exit(1) }
    }
    console.log('Blue rates populated.')
  }
  run()
  ```

  Run:
  ```bash
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/fetch-blue-rates.js
  ```

  Verify in Supabase: `blue_rates` table should have ~1500+ rows spanning 2020–2025.

- [ ] **Step 14.3: Recalculate all transaction USD values**

  Create `scripts/recalc-usd.js`:
  ```js
  import { createClient } from '@supabase/supabase-js'

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  async function run() {
    // Load all rates into a map for fast lookup
    const { data: rates, error: rErr } = await supabase.from('blue_rates').select('date,rate')
    if (rErr) throw rErr
    const rateMap = {}
    for (const r of rates) rateMap[r.date] = r.rate

    // Helper: find nearest available rate (look back up to 7 days for weekends/holidays)
    function getRateForDate(dateStr) {
      for (let i = 0; i <= 7; i++) {
        const d = new Date(dateStr)
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        if (rateMap[key]) return rateMap[key]
      }
      return null
    }

    // Load all transactions
    const { data: txs, error: tErr } = await supabase.from('transactions').select('id,date,ars')
    if (tErr) throw tErr

    console.log(`Recalculating USD for ${txs.length} transactions...`)
    let updated = 0, noRate = 0

    const updates = []
    for (const tx of txs) {
      const rate = getRateForDate(tx.date)
      if (!rate) { noRate++; continue }
      const usd = tx.ars != null ? +(tx.ars / rate).toFixed(2) : null
      updates.push({ id: tx.id, usd, usd_rate: rate })
    }

    // Batch update in chunks of 200
    for (let i = 0; i < updates.length; i += 200) {
      const chunk = updates.slice(i, i + 200)
      for (const u of chunk) {
        await supabase.from('transactions').update({ usd: u.usd, usd_rate: u.usd_rate }).eq('id', u.id)
      }
      updated += chunk.length
      if (i % 2000 === 0) console.log(`  ${updated}/${updates.length}...`)
    }

    console.log(`Done. Updated: ${updated}, no rate found: ${noRate}`)
  }
  run()
  ```

  Run:
  ```bash
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/recalc-usd.js
  ```

- [ ] **Step 14.4: Add loadBlueRate to db.js**

  Add to `src/db.js`:
  ```js
  // Returns the dólar blue rate for a given date (looks back up to 7 days).
  export async function loadBlueRate(dateStr) {
    for (let i = 0; i <= 7; i++) {
      const d = new Date(dateStr)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const { data } = await supabase.from('blue_rates').select('rate').eq('date', key).maybeSingle()
      if (data) return data.rate
    }
    return null
  }
  ```

- [ ] **Step 14.5: Fix upload flow to use historical rate**

  In `src/uploadParser.js`, change the `usdRate` parameter to be looked up from `blue_rates` per transaction date instead of a user-entered value. The upload UI should no longer show a "tipo de cambio" input — the rate is determined automatically.

  In `parseSantanderAR`, after computing `fecha`, call `loadBlueRate(fecha)` (async) and use the result for `usd` and `usdRate`. If no rate found (future date?), fall back to the most recent available rate.

  Update `parseXLSX` to be async and remove the `usdRate` parameter entirely.

- [ ] **Step 14.6: Commit**

  ```bash
  git add supabase/migrations/002_blue_rates.sql scripts/fetch-blue-rates.js scripts/recalc-usd.js src/db.js src/uploadParser.js
  git commit -m "feat: historical dólar blue rates — recalculate all USD values"
  git push origin main
  ```

---

## Task 15: Filter Improvements + UI Polish

**Files:**
- Modify: `src/Finanzas.jsx` — fix xfer filter, multi-year select, separate filter groups visually

- [ ] **Step 15.1: Fix "con xfers" filter**

  Grep for the xfer filter logic:
  ```bash
  grep -o 'xfer[^;,}]*' src/Finanzas.jsx | head -10
  ```

  The filter likely checks `tx.xfer === true` but uploaded transactions may have `xfer = false` (default) even for transfers, or the filter direction may be inverted. Fix the predicate so:
  - Default view: `xfer = false` transactions only (expenses/income, no transfers)
  - "Con xfers" checked: include all transactions including transfers

- [ ] **Step 15.2: Multi-year select**

  Replace the year radio buttons with checkboxes so multiple years can be selected simultaneously. Keep YTD, mes, trimestre as radio buttons (they are time-range shortcuts, not year selectors). The two filter groups should be visually separated:

  ```
  ┌─ Período ──────────────────────────────────┐
  │  ○ YTD  ○ Mes  ○ Trimestre  ○ Custom      │
  ├─ Año (multi-select) ───────────────────────┤
  │  ☐ 2020  ☐ 2021  ☑ 2024  ☑ 2025          │
  └────────────────────────────────────────────┘
  ┌─ Categoría / Grupo ────────────────────────┐
  │  (group filters here)                      │
  └────────────────────────────────────────────┘
  ┌─ Banco ────────────────────────────────────┐
  │  (bank filters here)                       │
  └────────────────────────────────────────────┘
  ```

  Use subtle `border` or background color difference to separate the three filter zones.

- [ ] **Step 15.3: Commit**

  ```bash
  git add src/Finanzas.jsx
  git commit -m "fix: xfer filter, multi-year select, separate filter sections"
  git push origin main
  ```

---

## Task 16: Group Management UI

**Files:**
- Create or extend: `src/views/Settings.jsx` — group CRUD (create, rename, delete, assign categories)
- Modify: `src/db.js` — settings already has groups JSONB; Settings.jsx saves via `saveSettings`

Groups live in `settings.groups: [{id, name, categories[]}]`. Managing them is pure CRUD on that JSONB field.

- [ ] **Step 16.1: Create src/views/Settings.jsx**

  Create `src/views/Settings.jsx` with a Groups section:
  - List existing groups with their assigned categories
  - "Nuevo grupo" button → text input for name → creates `{id: crypto.randomUUID(), name, categories: []}`
  - Rename: click group name → editable inline
  - Assign categories: multi-select from AVAILABLE_CATEGORIES
  - Delete: trash icon → confirm → removes from array
  - Save: calls `saveSettings({ ...settings, groups: updatedGroups })`

- [ ] **Step 16.2: Add Settings tab to Finanzas.jsx**

  ```js
  import Settings from"./views/Settings.jsx";
  ```

  Add "Configuración" tab.

- [ ] **Step 16.3: Commit**

  ```bash
  git add src/views/Settings.jsx src/Finanzas.jsx
  git commit -m "feat: group management UI in Settings tab"
  git push origin main
  ```

---

## Task 17: Manual Transaction Add/Delete (Soft Delete)

**Files:**
- Modify: `supabase/migrations/003_soft_delete.sql` — add `deleted_at` column to transactions
- Modify: `src/db.js` — add `softDeleteTransaction`, `addManualTransaction`, filter deleted in `loadTransactions`
- Modify: `src/views/Revisar.jsx` or new: `src/views/Transactions.jsx` — UI for manual add + delete button
- Modify: `src/Finanzas.jsx` — hide deleted transactions from all views
- Modify: `src/db.js` — `upsertTransactions` must respect soft-deleted IDs on re-upload

- [ ] **Step 17.1: Add soft delete column**

  ```sql
  alter table public.transactions add column deleted_at timestamptz;
  create index transactions_deleted on public.transactions(user_id, deleted_at) where deleted_at is null;
  ```

- [ ] **Step 17.2: Update loadTransactions to exclude deleted**

  ```js
  export async function loadTransactions() {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .is('deleted_at', null)   // exclude soft-deleted
      .order('date', { ascending: false })
    if (error) throw error
    return data
  }
  ```

- [ ] **Step 17.3: Add softDeleteTransaction**

  ```js
  export async function softDeleteTransaction(id) {
    const { error } = await supabase
      .from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }
  ```

- [ ] **Step 17.4: On re-upload, respect soft-deleted IDs**

  In `upsertTransactions`, after normalizing, query for any of the incoming IDs that are already soft-deleted. Tag those rows with `deleted_at` preserved (don't restore them). Log them as `deleted` in a banner:

  ```js
  export async function upsertTransactions(txs) {
    const { data: { user } } = await supabase.auth.getUser()
    const normalized = txs.map(tx => normalizeTx(tx, user.id))
    const ids = normalized.map(t => t.id)

    // Find which incoming IDs are soft-deleted — skip them
    const { data: deleted } = await supabase
      .from('transactions').select('id').in('id', ids).not('deleted_at', 'is', null)
    const deletedSet = new Set((deleted || []).map(d => d.id))
    const toInsert = normalized.filter(t => !deletedSet.has(t.id))

    for (let i = 0; i < toInsert.length; i += 200) {
      const { error } = await supabase
        .from('transactions').upsert(toInsert.slice(i, i + 200), { onConflict: 'id' })
      if (error) throw error
    }
    return { skippedDeleted: deletedSet.size }
  }
  ```

- [ ] **Step 17.5: Add manual transaction form**

  Add a "Nueva transacción" button to the Transactions tab (or a mini-form in Settings). Fields: date, merchant, amount (ARS), category, notes, project. On submit: calls `upsertTransactions` with `id = manual_${Date.now()}`.

- [ ] **Step 17.6: Add delete button to transaction rows**

  In the Transactions table in Finanzas.jsx, add a small trash/×  button per row. On click: confirm → `softDeleteTransaction(id)` → remove from local state.

- [ ] **Step 17.7: Commit**

  ```bash
  git add src/db.js src/Finanzas.jsx src/views/
  git commit -m "feat: soft delete + manual transaction add"
  git push origin main
  ```

---

## Task 18: Charts — PENDING USER CHOICE

> ⚠️ **Do not implement until user selects chart option (A, B, or C) from the proposal above.**

Once the user picks an option, implement the chosen charts to replace the existing bar charts and line curves in the Dashboard view. Use Recharts components already installed.

---

## Task 19: Alina ML Handling — PENDING CLARIFICATION

> ⚠️ **Do not implement until user answers the Alina ML question.**

Once clarified: implement special handling for Mercado Libre / Mercado Pago transactions that are Alina's purchases — likely by adding a `sub_source` field or a special categorization prompt that asks what each ML item actually was.

---

## Quick Reference

| Task | Command |
|------|---------|
| Local dev | `npm run dev` |
| Build | `npm run build` |
| Deploy Edge Fn | `npx supabase functions deploy categorize-tx` |
| Run migration | `SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/migrate-base-data.js --user-id=<uuid>` |
| Dry run | same + `--dry-run` |
| Supabase logs | Dashboard → Edge Functions → categorize-tx → Logs |
