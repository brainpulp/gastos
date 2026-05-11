import { supabase } from './supabase.js'

// ---------------------------------------------------------------------------
// Field normalization
// uploadParser returns camelCase + includes GENERATED cols (ym, year)
// DB uses snake_case; ym/year are GENERATED ALWAYS — never insert them
// ---------------------------------------------------------------------------
function normalizeTx(tx, userId) {
  // eslint-disable-next-line no-unused-vars
  const { ym, year, rawDesc, usdRate, ...rest } = tx
  return {
    ...rest,
    user_id: userId,
    raw_desc: rawDesc ?? rest.raw_desc ?? null,
    usd_rate: usdRate ?? rest.usd_rate ?? null,
  }
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/** Load all non-deleted transactions for the current user */
export async function loadTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .is('deleted_at', null)
    .order('date', { ascending: false })
  if (error) throw error
  return data
}

/** Upsert an array of transactions (from upload or manual add).
 *  Respects soft-deleted rows — any incoming ID that is already soft-deleted
 *  is skipped and returned in the `skipped` list. */
export async function upsertTransactions(txs) {
  if (!txs.length) return { skipped: [] }

  const { data: { user }, error: uErr } = await supabase.auth.getUser()
  if (uErr) throw uErr

  const normalized = txs.map(tx => normalizeTx(tx, user.id))
  const ids = normalized.map(t => t.id)

  // Find which IDs are already soft-deleted — skip them on re-upload
  const { data: deleted, error: dErr } = await supabase
    .from('transactions')
    .select('id')
    .in('id', ids)
    .not('deleted_at', 'is', null)
  if (dErr) throw dErr

  const deletedSet = new Set((deleted || []).map(r => r.id))
  const toUpsert = normalized.filter(t => !deletedSet.has(t.id))

  // Batch insert in chunks of 200
  const CHUNK = 200
  for (let i = 0; i < toUpsert.length; i += CHUNK) {
    const { error } = await supabase
      .from('transactions')
      .upsert(toUpsert.slice(i, i + CHUNK), { onConflict: 'id' })
    if (error) throw error
  }

  return { skipped: [...deletedSet] }
}

/** Soft-delete a transaction (sets deleted_at, does not physically remove) */
export async function softDeleteTransaction(id) {
  const { error } = await supabase
    .from('transactions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Update arbitrary fields on a transaction */
export async function updateTransaction(id, fields) {
  const { error } = await supabase
    .from('transactions')
    .update(fields)
    .eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function loadSettings() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error

  // Return defaults if no row yet
  return data ?? {
    user_id: user.id,
    monthly_budget_usd: 0,
    category_budgets: {},
    groups: [],
    vendor_hints: {},
    usd_rate: 1050,
  }
}

export async function saveSettings(fields) {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('settings')
    .upsert({ ...fields, user_id: user.id }, { onConflict: 'user_id' })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Cat log
// ---------------------------------------------------------------------------

export async function loadCatLog({ limit = 500 } = {}) {
  const { data, error } = await supabase
    .from('cat_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function writeCatLog(entry) {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('cat_log')
    .insert({ ...entry, user_id: user.id })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Blue rates (historical dólar blue)
// ---------------------------------------------------------------------------

export async function loadBlueRates() {
  const { data, error } = await supabase
    .from('blue_rates')
    .select('date,rate')
    .order('date', { ascending: true })
  if (error) throw error
  // Return as { 'YYYY-MM-DD': rate } map for O(1) lookups
  return Object.fromEntries((data || []).map(r => [r.date, r.rate]))
}

export async function upsertBlueRates(rows) {
  // rows: [{date: 'YYYY-MM-DD', rate: number}]
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('blue_rates')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'date' })
    if (error) throw error
  }
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

export async function loadReviewQueue() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('needs_review', true)
    .is('deleted_at', null)
    .order('date', { ascending: false })
  if (error) throw error
  return data
}
