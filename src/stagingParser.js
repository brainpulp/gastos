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
  for (const r of rows) {
    const date = mintDate(r[hDate])
    if (!date || date < minDate) continue

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
  return out
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
  for (const r of rows) {
    // PC uses YYYY-MM-DD; some exports use MM/DD/YYYY
    let date = r[hDate] || ''
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) date = mintDate(date)
    if (!date || date < minDate) continue

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
  return out
}

// ─── Source type auto-detect ──────────────────────────────────────────────────

export function detectSourceType(text) {
  const firstLine = text.slice(0, 400).toLowerCase()
  if (firstLine.includes('transaction type') && firstLine.includes('original description')) return 'mint'
  if (firstLine.includes('account') && firstLine.includes('category') && firstLine.includes('tags')) return 'personal_capital'
  return 'unknown'
}

export function parseStaging(text, sourceType, minDate = '2020-01-01') {
  if (sourceType === 'mint') return parseMintCSV(text, minDate)
  if (sourceType === 'personal_capital') return parsePersonalCapitalCSV(text, minDate)
  throw new Error(`Formato no reconocido: ${sourceType}`)
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
