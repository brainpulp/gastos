import { supabase } from './supabase.js'

// ─── Sources ─────────────────────────────────────────────────────────────────

export async function loadStagingSources() {
  const { data, error } = await supabase
    .from('staging_sources')
    .select('*')
    .order('imported_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Insert a source + all its rows. Returns { source, count }. */
export async function importStagingSource({ name, sourceType, rows }) {
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user.id

  const dates = rows.map(r => r.date).filter(Boolean).sort()
  const { data: source, error: sErr } = await supabase
    .from('staging_sources')
    .insert({
      user_id:    userId,
      name,
      source_type: sourceType,
      date_from:  dates[0] || null,
      date_to:    dates[dates.length - 1] || null,
      row_count:  rows.length,
    })
    .select()
    .single()
  if (sErr) throw sErr

  const CHUNK = 200
  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map(r => ({
      user_id:          userId,
      source_id:        source.id,
      date:             r.date,
      description:      r.description || null,
      orig_description: r.orig_description || null,
      amount:           r.amount,
      currency:         r.currency || 'USD',
      account:          r.account || null,
      category:         r.category || null,
      raw:              r.raw || null,
    }))
    const { error } = await supabase.from('staging_transactions').insert(batch)
    if (error) throw error
    inserted += batch.length
  }

  return { source, count: inserted }
}

export async function deleteStagingSource(sourceId) {
  // ON DELETE CASCADE removes staging_transactions + forensic_links
  const { error } = await supabase
    .from('staging_sources')
    .delete()
    .eq('id', sourceId)
  if (error) throw error
}

// ─── Review queue loading ─────────────────────────────────────────────────────

/**
 * Load staging rows for a source, paged, with their forensic_link (if any).
 * statusFilter: 'all' | 'unreviewed' | 'matched' | 'no_match' | 'new' | 'excluded'
 */
export async function loadStagingPage(sourceId, { page = 0, pageSize = 50, statusFilter = 'all' } = {}) {
  // We fetch all rows for this source with their links
  // (Supabase nested select)
  const from = page * pageSize
  const to   = from + pageSize - 1

  let q = supabase
    .from('staging_transactions')
    .select('*, forensic_links(*)', { count: 'exact' })
    .eq('source_id', sourceId)
    .order('date', { ascending: false })

  // Apply status filter via post-filter (Supabase doesn't support filtering by
  // related table columns in a simple way with count, so we filter in JS)
  const { data, error, count } = await q
  if (error) throw error

  const all = (data ?? []).map(row => ({
    ...row,
    link: row.forensic_links?.[0] ?? null,
  }))

  // Filter by status
  const filtered = filterByStatus(all, statusFilter)

  return {
    rows: filtered.slice(from, from + pageSize),
    total: filtered.length,
    allRows: filtered,
  }
}

/** Load ALL staging rows for a source (for running the auto-matcher). */
export async function loadAllStagingRows(sourceId) {
  const PAGE = 1000
  let all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('staging_transactions')
      .select('*, forensic_links(*)')
      .eq('source_id', sourceId)
      .range(from, from + PAGE - 1)
    if (error) throw error
    all = all.concat((data ?? []).map(row => ({
      ...row,
      link: row.forensic_links?.[0] ?? null,
    })))
    if ((data ?? []).length < PAGE) break
    from += PAGE
  }
  return all
}

function filterByStatus(rows, statusFilter) {
  if (statusFilter === 'all') return rows
  return rows.filter(r => {
    const status = r.link?.status ?? 'unreviewed'
    if (statusFilter === 'unreviewed') return !r.link
    return status === statusFilter
  })
}

// ─── Decisions ───────────────────────────────────────────────────────────────

/** Upsert a forensic decision for one staging row. */
export async function saveDecision(stagingId, { mainId = null, status, notes = null }) {
  const { data: { user } } = await supabase.auth.getUser()
  const payload = {
    user_id:    user.id,
    staging_id: stagingId,
    main_id:    mainId || null,
    status,
    auto_match: false,
    notes,
    decided_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('forensic_links')
    .upsert(payload, { onConflict: 'staging_id' })
  if (error) throw error
}

/** Persist auto-match results in bulk (status = 'pending' so user still reviews). */
export async function saveAutoMatches(matches) {
  if (!matches.length) return
  const { data: { user } } = await supabase.auth.getUser()
  const CHUNK = 200
  for (let i = 0; i < matches.length; i += CHUNK) {
    const batch = matches.slice(i, i + CHUNK).map(m => ({
      user_id:    user.id,
      staging_id: m.stagingId,
      main_id:    m.mainId || null,
      status:     'pending',
      confidence: m.confidence,
      auto_match: true,
      decided_at: null,
    }))
    const { error } = await supabase
      .from('forensic_links')
      .upsert(batch, { onConflict: 'staging_id' })
    if (error) throw error
  }
}

/** Bulk-confirm all pending rows above a confidence threshold. */
export async function bulkConfirmHighConfidence(sourceId, minConfidence = 0.8) {
  const { data: { user } } = await supabase.auth.getUser()
  // Get all pending links for this source's staging rows
  const { data: stagingIds, error: siErr } = await supabase
    .from('staging_transactions')
    .select('id')
    .eq('source_id', sourceId)
  if (siErr) throw siErr

  const ids = (stagingIds ?? []).map(r => r.id)
  if (!ids.length) return 0

  const { data: links, error: lErr } = await supabase
    .from('forensic_links')
    .select('id, confidence, main_id')
    .in('staging_id', ids)
    .eq('status', 'pending')
    .not('main_id', 'is', null)
    .gte('confidence', minConfidence)
  if (lErr) throw lErr

  if (!links?.length) return 0

  const CHUNK = 200
  for (let i = 0; i < links.length; i += CHUNK) {
    const { error } = await supabase
      .from('forensic_links')
      .update({ status: 'matched', auto_match: false, decided_at: new Date().toISOString() })
      .in('id', links.slice(i, i + CHUNK).map(l => l.id))
    if (error) throw error
  }
  return links.length
}

// ─── Merge ───────────────────────────────────────────────────────────────────

const XFER_CATEGORIES = new Set(['Transfer', 'Credit Card Payment'])

/**
 * Insert staging rows marked 'new' into the main transactions table.
 * @param newRows  — staging_transaction rows already filtered to status='new' (with .link)
 * @param sourceType — 'mint' | 'personal_capital' | etc (used as bank field)
 * @param blueRates  — { 'YYYY-MM-DD': rate } for ars/usd_rate lookup
 * @returns count of rows inserted
 */
export async function mergeStagingNew(newRows, sourceType, blueRates = {}) {
  if (!newRows.length) return 0
  const { data: { user } } = await supabase.auth.getUser()

  const txRows = newRows.map(row => {
    const rate = blueRates[row.date] ?? null
    const usd  = row.amount ?? 0
    return {
      id:          `f_${row.id}`,
      user_id:     user.id,
      date:        row.date,
      usd:         +usd.toFixed(2),
      usd_rate:    rate,
      ars:         rate != null ? +(usd * rate).toFixed(2) : null,
      raw_desc:    row.orig_description || row.description || null,
      merchant:    row.description || null,
      bank:        sourceType,
      cat:         null,
      xfer:        XFER_CATEGORIES.has(row.category),
      needs_review: false,
      ai_assigned: false,
      notes:       row.account ? `Account: ${row.account}` : null,
    }
  })

  // Upsert in chunks (safe to re-run — on conflict id, update in place)
  const CHUNK = 200
  for (let i = 0; i < txRows.length; i += CHUNK) {
    const { error } = await supabase
      .from('transactions')
      .upsert(txRows.slice(i, i + CHUNK), { onConflict: 'id' })
    if (error) throw error
  }

  // Mark forensic_links as 'merged'
  const linkIds = newRows.map(r => r.link?.id).filter(Boolean)
  if (linkIds.length) {
    for (let i = 0; i < linkIds.length; i += CHUNK) {
      const { error } = await supabase
        .from('forensic_links')
        .update({ status: 'merged', decided_at: new Date().toISOString() })
        .in('id', linkIds.slice(i, i + CHUNK))
      if (error) throw error
    }
  }

  return txRows.length
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function loadSourceStats(sourceId) {
  const { data, error } = await supabase
    .from('staging_transactions')
    .select('forensic_links(status)')
    .eq('source_id', sourceId)
  if (error) throw error

  const counts = { unreviewed: 0, pending: 0, matched: 0, no_match: 0, new: 0, excluded: 0, merged: 0 }
  for (const row of data ?? []) {
    const status = row.forensic_links?.[0]?.status ?? 'unreviewed'
    counts[status] = (counts[status] || 0) + 1
  }
  return counts
}
