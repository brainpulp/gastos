// ─── Staging parsers — external source imports ────────────────────────────────
// These parsers return { date, description, orig_description, amount, currency,
// account, category, raw } objects, ready for staging_transactions insert.
// Amount sign convention: negative = outflow (expense), positive = inflow.

// ─── CSV line parser (handles quoted fields with commas inside) ───────────────

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim()); current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^﻿/, '')) // strip BOM
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i])
    if (vals.every(v => !v)) continue
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = vals[idx] ?? '' })
    rows.push(obj)
  }
  return { headers, rows }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

// M/DD/YYYY or MM/DD/YYYY → YYYY-MM-DD
function mintDate(str) {
  const parts = (str || '').split('/')
  if (parts.length !== 3) return null
  const [m, d, y] = parts
  if (!y || y.length !== 4) return null
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// ─── Mint (Intuit Mint) ───────────────────────────────────────────────────────
// Columns: Date, Description, Original Description, Amount, Transaction Type,
//          Category, Account Name, Labels, Notes
// Amount is always positive; Transaction Type = 'debit' | 'credit'
// Filter: only rows from minDate onward.

export function parseMintCSV(text, minDate = '2020-01-01') {
  const { headers, rows } = parseCSV(text)

  // Accept both exact header names and case-insensitive variants
  const col = (names) => {
    for (const n of names) {
      const h = headers.find(h => h.toLowerCase() === n.toLowerCase())
      if (h) return h
    }
    return names[0] // fallback
  }

  const hDate     = col(['Date'])
  const hDesc     = col(['Description'])
  const hOrig     = col(['Original Description'])
  const hAmount   = col(['Amount'])
  const hType     = col(['Transaction Type'])
  const hCat      = col(['Category'])
  const hAccount  = col(['Account Name'])

  const out = []
  let filteredCount = 0
  for (const r of rows) {
    const date = mintDate(r[hDate])
    if (!date || date < minDate) { filteredCount++; continue }

    const rawAmount = parseFloat(r[hAmount]) || 0
    const isDebit = (r[hType] || '').toLowerCase().trim() === 'debit'
    const amount = isDebit ? -rawAmount : rawAmount

    out.push({
      date,
      description:      r[hDesc] || '',
      orig_description: r[hOrig] || '',
      amount,
      currency: 'USD',
      account:  r[hAccount] || '',
      category: r[hCat] || '',
      raw: r,
    })
  }
  return { rows: out, filteredCount }
}

// ─── Personal Capital / Empower ───────────────────────────────────────────────
// Columns: Date, Account, Description, Category, Tags, Amount
// Amount negative = expense, positive = income (already signed).
// Date format: YYYY-MM-DD or MM/DD/YYYY.

export function parsePersonalCapitalCSV(text, minDate = '2020-01-01') {
  const { headers, rows } = parseCSV(text)

  const col = (names) => {
    for (const n of names) {
      const h = headers.find(h => h.toLowerCase() === n.toLowerCase())
      if (h) return h
    }
    return names[0]
  }

  const hDate    = col(['Date'])
  const hDesc    = col(['Description'])
  const hCat     = col(['Category'])
  const hAccount = col(['Account'])
  const hAmount  = col(['Amount'])

  const out = []
  let filteredCount = 0
  for (const r of rows) {
    // PC uses YYYY-MM-DD; some exports use MM/DD/YYYY
    let date = r[hDate] || ''
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) date = mintDate(date)
    if (!date || date < minDate) { filteredCount++; continue }

    const amount = parseFloat(r[hAmount]) || 0

    out.push({
      date,
      description:      r[hDesc] || '',
      orig_description: '',
      amount,
      currency: 'USD',
      account:  r[hAccount] || '',
      category: r[hCat] || '',
      raw: r,
    })
  }
  return { rows: out, filteredCount }
}

// ─── IBKR Activity Statement (multi-section CSV) ─────────────────────────────
// Export path: Client Portal → Performance & Reports → Statements → Activity →
//   Format: CSV, Period: Custom (full date range) → Run → Download
//
// Format: each line starts with section name, then "Header" or "Data" or "Total"
//   "Deposits & Withdrawals",Header,Currency,Settle Date,Description,Amount
//   "Deposits & Withdrawals",Data,USD,2021-01-15,Electronic Fund Transfer,5000.00
//
// Sign convention: IBKR deposits are positive, withdrawals negative.
// We FLIP sign for D&W (deposit → outflow from bank = negative in staging).
// Dividends/Interest/Tax: keep IBKR sign.

const IBKR_SECTIONS = new Set(['Deposits & Withdrawals', 'Dividends', 'Interest', 'Withholding Tax'])
const IBKR_XFER_SECTIONS = new Set(['Deposits & Withdrawals'])

export function parseIBKRActivityCSV(text, minDate = '2020-01-01') {
  const lines = text.trim().split(/\r?\n/)
  const out = []
  let filteredCount = 0
  let section = null
  let headers = null

  for (const raw of lines) {
    const cols = parseCSVLine(raw)
    if (cols.length < 2) continue
    const sec  = cols[0].replace(/^"|"$/g, '').trim()
    const rtype = cols[1].replace(/^"|"$/g, '').trim()

    if (rtype === 'Header' && IBKR_SECTIONS.has(sec)) {
      section = sec
      headers = cols.slice(2).map(h => h.replace(/^"|"$/g, '').trim())
      continue
    }

    if (rtype !== 'Data' || !section || !headers) continue

    const row = {}
    headers.forEach((h, i) => { row[h] = (cols[i + 2] ?? '').replace(/^"|"$/g, '').trim() })

    // Date field differs by section
    const dateRaw = row['Settle Date'] || row['Date'] || ''
    const date = dateRaw.slice(0, 10) // handles YYYY-MM-DD or YYYY-MM-DD;HH:MM:SS
    if (!date || date < minDate) { filteredCount++; continue }

    const amount = parseFloat(row['Amount']?.replace(/,/g, '')) || 0
    if (amount === 0) continue

    // Skip subtotal/total rows that slip through as Data
    const desc = row['Description'] || ''
    if (/^total/i.test(desc)) continue

    const isXfer = IBKR_XFER_SECTIONS.has(section)
    const stagingAmount = isXfer ? -amount : amount // flip D&W, keep dividends/interest/tax

    let category = 'Other'
    if (section === 'Deposits & Withdrawals') category = 'Transfer'
    else if (section === 'Dividends')         category = 'Dividend'
    else if (section === 'Interest')          category = 'Interest'
    else if (section === 'Withholding Tax')   category = 'Tax'

    out.push({
      date,
      description:      desc || section,
      orig_description: desc,
      amount:           +stagingAmount.toFixed(2),
      currency:         row['Currency'] || 'USD',
      account:          'IBKR',
      category,
      raw: row,
    })
  }

  return { rows: out, filteredCount }
}

// ─── Betterment ───────────────────────────────────────────────────────────────
// Actual export format (from betterment.com Activity → Download):
//   Date Created, Goal Name, Transaction Description, Amount, Date Completed
// Amount: "$1,234.56" or "-$1,234.56" or "—" (em dash = allocation change, skip)
// Date: YYYY-MM-DD
// Key description patterns: "Deposit from ****NNNN", "Withdrawal to ****NNNN",
//   "Withdraw all to ****NNNN", "Dividend Reinvestment", "Advisory Fee",
//   "Automatic Deposit", "Allocation Change, ..." (skipped — no cash flow)

export function parseBettermentCSV(text, minDate = '2020-01-01') {
  const { headers, rows } = parseCSV(text)

  const col = (names) => {
    for (const n of names) {
      const h = headers.find(h => h.trim().toLowerCase() === n.toLowerCase())
      if (h) return h
    }
    return names[0]
  }

  const hDate = col(['Date Created', 'Date'])
  const hDesc = col(['Transaction Description', 'Description'])
  const hAmt  = col(['Amount'])
  const hGoal = col(['Goal Name', 'Account'])

  const out = []
  let filteredCount = 0
  for (const r of rows) {
    const date = (r[hDate] || '').slice(0, 10)
    if (!date || date < minDate) { filteredCount++; continue }

    // Skip allocation changes and other non-cash rows (amount = "—")
    const rawAmt = (r[hAmt] || '').trim()
    if (rawAmt === '—' || rawAmt === '-' || rawAmt === '') continue

    const amount = parseFloat(rawAmt.replace(/[$,]/g, '')) || 0
    if (amount === 0) continue

    const desc = r[hDesc] || ''
    const descLower = desc.toLowerCase()

    // Classify by description
    const isDeposit  = descLower.includes('deposit')
    const isWithdraw = descLower.includes('withdraw')
    const isDividend = descLower.includes('dividend')
    const isFee      = descLower.includes('fee')

    let category = 'Other'
    if (isDeposit || isWithdraw) category = 'Transfer'
    else if (isDividend)         category = 'Dividend'
    else if (isFee)              category = 'Fee'

    out.push({
      date,
      description:      desc || 'Betterment',
      orig_description: desc,
      amount:           +amount.toFixed(2),
      currency: 'USD',
      account:  r[hGoal] || 'Betterment',
      category,
      raw: r,
    })
  }
  return { rows: out, filteredCount }
}

// ─── Source type auto-detect ──────────────────────────────────────────────────

export function detectSourceType(text) {
  const sample = text.slice(0, 600).toLowerCase()
  if (sample.includes('transaction type') && sample.includes('original description')) return 'mint'
  if (sample.includes('account') && sample.includes('category') && sample.includes('tags')) return 'personal_capital'
  if (sample.includes('deposits & withdrawals') || sample.includes('statement of funds')) return 'ibkr'
  // Betterment: has "fees" column but no tags/transaction type
  if (sample.includes('fees') && !sample.includes('tags') && !sample.includes('transaction type')) return 'betterment'
  return 'unknown'
}

/** Parse a staging CSV and return rows + stats.
 *  Returns { rows, stats: { kept, filtered, total, dateFrom, dateTo } }
 *  filtered = rows excluded because date < minDate (only applies to Mint data post-2020)
 */
export function parseStaging(text, sourceType, minDate = '2020-01-01') {
  let result
  if (sourceType === 'mint')             result = parseMintCSV(text, minDate)
  else if (sourceType === 'personal_capital') result = parsePersonalCapitalCSV(text, minDate)
  else if (sourceType === 'ibkr')        result = parseIBKRActivityCSV(text, minDate)
  else if (sourceType === 'betterment')  result = parseBettermentCSV(text, minDate)
  else throw new Error(`Formato no reconocido: ${sourceType}`)

  const { rows, filteredCount } = result
  const dates = rows.map(r => r.date).filter(Boolean).sort()
  return {
    rows,
    stats: {
      kept:     rows.length,
      filtered: filteredCount,
      total:    rows.length + filteredCount,
      dateFrom: dates[0] || null,
      dateTo:   dates[dates.length - 1] || null,
    },
  }
}

// ─── Client-side auto-matcher ─────────────────────────────────────────────────
// Runs against the already-loaded `txs` array. Returns matches array:
// [{ stagingId, mainId, confidence }]  confidence ∈ [0, 1]

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function wordSet(str) {
  return new Set(
    (str || '').toLowerCase().split(/[\s*\/\-_.,]+/).filter(w => w.length > 2)
  )
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0
  const intersection = [...a].filter(w => b.has(w)).length
  return intersection / (a.size + b.size - intersection)
}

function scoreMatch(stg, tx) {
  // Amount must be in the same ballpark to be a match at all
  const txUSD = tx.usd ?? 0
  if (txUSD === 0 && stg.amount !== 0) return 0

  const pctDiff = Math.abs(stg.amount - txUSD) / (Math.abs(txUSD) || 1)
  if (pctDiff > 0.20) return 0 // >20% off → not a match

  let score = 0

  // Date proximity (0–40 pts)
  const daysDiff = Math.abs(
    (new Date(stg.date + 'T12:00:00') - new Date(tx.date + 'T12:00:00')) / 86400000
  )
  if (daysDiff === 0) score += 40
  else if (daysDiff === 1) score += 30
  else if (daysDiff === 2) score += 20
  else if (daysDiff <= 3) score += 10

  // Amount proximity (0–40 pts)
  if (pctDiff < 0.01)       score += 40
  else if (pctDiff < 0.05)  score += 28
  else if (pctDiff < 0.10)  score += 16
  else                      score += 6

  // Description similarity (0–20 pts)
  const stgWords = wordSet((stg.description || '') + ' ' + (stg.orig_description || ''))
  const txWords  = wordSet((tx.merchant || '') + ' ' + (tx.raw_desc || ''))
  score += Math.round(jaccard(stgWords, txWords) * 20)

  return score
}

export function autoMatch(stagingRows, mainTxs) {
  // Build date-range index: date → [tx, ...]
  const byDate = {}
  for (const tx of mainTxs) {
    if (!tx.date || tx.deleted_at) continue
    for (let d = -3; d <= 3; d++) {
      const dt = shiftDate(tx.date, d)
      if (!byDate[dt]) byDate[dt] = []
      byDate[dt].push(tx)
    }
  }

  const results = []
  for (const stg of stagingRows) {
    if (!stg.date) continue
    const candidates = byDate[stg.date] || []

    let bestTx = null
    let bestScore = 0
    for (const tx of candidates) {
      const s = scoreMatch(stg, tx)
      if (s > bestScore) { bestScore = s; bestTx = tx }
    }

    // Only emit a match if score is meaningful (≥40 means at least date + rough amount)
    if (bestTx && bestScore >= 40) {
      results.push({
        stagingId:  stg.id,
        mainId:     bestTx.id,
        confidence: Math.min(bestScore / 100, 1),
      })
    }
    // Rows with no candidate get no forensic_link at all — shown as "unreviewed"
  }
  return results
}
