/**
 * Extract embedded transactions from old Finanzas.jsx and push directly to Supabase.
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env.local') })

const USER_ID = 'bb4e8106-0de5-4cd0-ab4b-20596f13ff2c'
const OLD_FILE = join(__dirname, 'old_finanzas_backup.jsx')

// ── 1. Read & extract raw values from minified JSX ─────────────────────────
const src = readFileSync(OLD_FILE, 'utf8')

// _D is a quoted string: _D="...data..."
const dMatch = src.match(/_D="([^"]+)"/)
if (!dMatch) throw new Error('Could not find _D in old file')
const _D = dMatch[1]

// _M is a JSON object: _M={...}
const mMatch = src.match(/_M=(\{[^;]+\})/)
if (!mMatch) throw new Error('Could not find _M in old file')
const _M = JSON.parse(mMatch[1])

// _X is a JSON array: _X=[...]
const xMatch = src.match(/_X=(\[[^\]]+\])/)
if (!xMatch) throw new Error('Could not find _X in old file')
const _X = JSON.parse(xMatch[1])

console.log(`Categories: ${_M.c.length}, Banks: ${_M.b.length}`)
console.log('Banks:', _M.b)

// ── 2. Decode ──────────────────────────────────────────────────────────────
const xferSet = new Set(_X)
let dayOffset = 0
const origin = new Date(2020, 0, 1)  // 2020-01-01

const rows = _D.split(';').map((s, i) => {
  const p = s.split(',')
  dayOffset += Number(p[0])
  const d = new Date(origin)
  d.setDate(d.getDate() + dayOffset)
  const date = d.toISOString().slice(0, 10)
  const usd = Number(p[3]) / 100          // stored as usd×100
  const catName = _M.c[Number(p[1])] ?? null
  const bankName = _M.b[Number(p[2])] ?? 'Santander'

  return {
    id: `b_${i}`,
    user_id: USER_ID,
    date,
    cat: catName,
    bank: bankName,
    ars: null,   // original only had USD
    usd,
    usd_rate: null,
    xfer: xferSet.has(i),
    raw_desc: null,
    merchant: null,
    referencia: null,
    notes: null,
    project: null,
    ai_assigned: false,
    needs_review: false,
  }
})

console.log(`Decoded ${rows.length} transactions`)
console.log(`Date range: ${rows[0].date} → ${rows[rows.length - 1].date}`)
console.log(`Sample:`, rows[0])

// ── 3. Upsert to Supabase ──────────────────────────────────────────────────
const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Need VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}
console.log('Using key type:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon')

const sb = createClient(url, key, { auth: { persistSession: false } })

const CHUNK = 200
let done = 0
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK)
  const { error } = await sb.from('transactions').upsert(chunk, { onConflict: 'id' })
  if (error) { console.error('Upsert error:', error.message); process.exit(1) }
  done += chunk.length
  process.stdout.write(`\r${done}/${rows.length}`)
}

console.log('\n✅ Migration complete.')
const byYear = {}
for (const r of rows) {
  const y = r.date.slice(0, 4)
  byYear[y] = (byYear[y] ?? 0) + 1
}
console.log('By year:', byYear)
