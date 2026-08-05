// ---------------------------------------------------------------------------
// Shared pure helpers & constants — used by both the desktop (Finanzas.jsx)
// and the mobile app (src/mobile/*). No React, no side effects.
// Keep CATS / BANK_STYLE in sync with Finanzas.jsx (runtime source of truth
// for categories is settings.cats; this is only the fallback list).
// ---------------------------------------------------------------------------

export const CATS = [
  'Amazon FBA', 'AR taxes', 'Arcos', 'Boat maintenance',
  'Business expense', 'Car maintenance', 'Carhué obra', 'Carhué operacion', 'cash extraction', 'Clothing',
  'contribution to Sol', 'Delta', 'deptos Roca', 'Dining', 'earn out incoming', 'El Dorado', 'Entertainment',
  'Food', 'from Vida', 'Gas', 'Gifts',
  'Healthcare', 'Home utilities',
  'Interbank incoming', 'Interbank outgoing', 'Legal fees', 'Loans given',
  'misc fees', 'Mocoreta', 'Must trace', 'pets',
  'Puente to Santander', 'Roca deptos', 'Shopping', 'sports and exercise',
  'Topozoids', 'transportation', 'Travel', 'Uncategorized Expenses', 'Upwork', 'US taxes',
]

export const BANKS = ['BofA', 'Cash', 'Chase', 'Citibank', 'Santander', 'Wells Fargo']

// Bank chip / avatar colors (background + text)
export const BANK_STYLE = {
  'BofA':        { background: '#e8f0fe', color: '#1a56db' },
  'Cash':        { background: '#e8f5e9', color: '#2e7d32' },
  'Chase':       { background: '#fff3e0', color: '#b45309' },
  'Citibank':    { background: '#e0f2fe', color: '#0369a1' },
  'Santander':   { background: '#fce4ec', color: '#b91c1c' },
  'Wells Fargo': { background: '#fef9c3', color: '#92400e' },
  'Upwork':      { background: '#e7f7ee', color: '#108a45' },
}

// Categories that flag funds needing forensic tracing
export const TRACE_CATS = [
  'Must trace', 'cash extraction', 'Loans given',
  'Interbank outgoing', 'Interbank incoming', 'Puente to Santander',
]

export const isUncat = (t) =>
  !t.cat || t.cat.trim() === '' || t.cat === 'Uncategorized Expenses'

// AI-assigned cats carry a 🤖 in the UI; detect either signal
export const isAiCat = (t) => !!t.ai_assigned || (t.cat || '').includes('🤖')

// Deterministic per-category hue (matches desktop catColor)
export function catColor(cat, alpha = 1) {
  let h = 0
  for (let i = 0; i < (cat || '').length; i++) h = (h * 31 + cat.charCodeAt(i)) % 360
  return `hsla(${h},60%,50%,${alpha})`
}

// Two-letter bank initials for avatars
export function bankInitials(bank) {
  if (!bank) return '—'
  const parts = bank.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return bank.slice(0, 2)
}

// ---- Formatting ----------------------------------------------------------

export const fmtUSD = (n, decimals = 0) => {
  if (n == null || Number.isNaN(+n)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n)
}

export const fmtARS = (n) => {
  if (n == null || Number.isNaN(+n)) return '—'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n)
}

// Compact: US$1.2k / US$3.4M
export const fmtUSDk = (n) => {
  if (n == null || Number.isNaN(+n)) return '—'
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1_000_000) return `${sign}US$${(a / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${sign}US$${(a / 1_000).toFixed(1)}k`
  return `${sign}US$${Math.round(a)}`
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// 'YYYY-MM-DD' -> '5 ago 2026'
export const fmtDate = (s) => {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return `${d} ${MONTHS_ES[m - 1]} ${y}`
}

// 'YYYY-MM' -> 'ago 26'
export const fmtMonth = (ym) => {
  if (!ym) return '—'
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_ES[m - 1]} ${String(y).slice(2)}`
}

// Relative day header: Hoy / Ayer / full date
export const dayHeader = (s) => {
  if (!s) return '—'
  const today = new Date()
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const diff = Math.round((t - date) / 86400000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Ayer'
  return fmtDate(s)
}

// Signed USD of a tx (negative = expense). Falls back to 0.
export const usdOf = (t) => +t.usd || 0

// Group an array by a key function -> [[key, items], ...] preserving first-seen order
export function groupBy(arr, keyFn) {
  const map = new Map()
  for (const item of arr) {
    const k = keyFn(item)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(item)
  }
  return [...map.entries()]
}
