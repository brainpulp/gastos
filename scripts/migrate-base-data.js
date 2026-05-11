/**
 * One-time script: migrate embedded base transactions from Finanzas.jsx CSV
 * into Supabase.
 *
 * Usage:
 *   node scripts/migrate-base-data.js --user-id <uuid>
 *
 * The UUID is the Supabase auth.users.id for maxi.goldschwartz@gmail.com.
 * Retrieve it after first login: supabase.auth.getUser() in browser console,
 * or from Supabase dashboard → Authentication → Users.
 *
 * Prerequisites:
 *   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in environment
 *   (or .env.local). Service role bypasses RLS for this one-time insert.
 *
 *   npm install @supabase/supabase-js dotenv
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { parse } from 'path'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { config } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env.local') })

const args = process.argv.slice(2)
const userIdFlag = args.indexOf('--user-id')
if (userIdFlag === -1 || !args[userIdFlag + 1]) {
  console.error('Usage: node scripts/migrate-base-data.js --user-id <uuid>')
  process.exit(1)
}
const userId = args[userIdFlag + 1]

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (and VITE_SUPABASE_URL) in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
})

// ---------------------------------------------------------------------------
// Read transactions_clean.csv (8 429 rows, relative to project root)
// ---------------------------------------------------------------------------
const csvPath = join(__dirname, '..', 'transactions_clean.csv')
let csvText
try {
  csvText = readFileSync(csvPath, 'utf8')
} catch {
  console.error(`Could not read ${csvPath}`)
  console.error('Export transactions_clean.csv from the old Finanzas.jsx embedded data first.')
  process.exit(1)
}

const lines = csvText.trim().split('\n')
const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))

function parseRow(line) {
  // Simple CSV parse (no quoted commas in this dataset)
  const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
  const obj = {}
  headers.forEach((h, i) => { obj[h] = vals[i] ?? null })
  return obj
}

const rows = lines.slice(1).map((line, idx) => {
  const r = parseRow(line)
  return {
    id: `b_${idx}`,
    user_id: userId,
    date: r.date || null,
    cat: r.cat || null,
    bank: r.bank || 'Santander',
    ars: r.ars ? parseFloat(r.ars) : null,
    usd: r.usd ? parseFloat(r.usd) : null,
    usd_rate: r.usd_rate ? parseFloat(r.usd_rate) : null,
    xfer: r.xfer === 'true' || r.xfer === '1',
    raw_desc: r.raw_desc || r.rawDesc || null,
    merchant: r.merchant || null,
    referencia: r.referencia || null,
    notes: r.notes || null,
    project: r.project || null,
    ai_assigned: false,
    needs_review: false,
  }
})

console.log(`Migrating ${rows.length} transactions for user ${userId}…`)

const CHUNK = 200
let inserted = 0
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK)
  const { error } = await supabase
    .from('transactions')
    .upsert(chunk, { onConflict: 'id' })
  if (error) {
    console.error(`Error at chunk ${i}:`, error.message)
    process.exit(1)
  }
  inserted += chunk.length
  process.stdout.write(`\r${inserted}/${rows.length}`)
}

console.log('\n✅ Migration complete.')
