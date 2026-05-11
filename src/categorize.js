/**
 * AI categorization logic.
 * Does NOT import supabase.js — accessToken is passed by the caller.
 * Caller (Finanzas.jsx upload flow) gets the token from the session prop.
 */
import { CATS } from './Finanzas.jsx'
import { loadSettings, writeCatLog } from './db.js'

const EDGE_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/categorize-tx`
const CONFIDENCE_THRESHOLD = 0.75

/**
 * Categorize a single transaction via the Edge Function.
 * Returns { cat, confidence, reasoning, usage } or throws on unrecoverable error.
 */
async function callEdgeFn(tx, categories, accessToken) {
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      merchant: tx.merchant,
      rawDesc: tx.raw_desc ?? tx.rawDesc,
      amount: tx.ars,
      availableCategories: categories,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Edge Function ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Categorize an array of transactions.
 *
 * For each tx:
 *  1. Skip if merchant+rawDesc both empty → needs_review = true
 *  2. Check vendor_hints → auto-assign, no API call
 *  3. Check cat_log for same merchant (last 6 months, confirmed/corrected) → reuse
 *  4. Call Edge Function
 *     - confidence ≥ 0.75 → auto-assign
 *     - confidence < 0.75 → needs_review = true
 *     - error → needs_review = true, log ai_error
 *
 * Returns enriched txs with cat, ai_assigned, ai_confidence, needs_review set.
 * Also writes to cat_log for each AI call.
 *
 * @param {object[]} txs         - Transactions to categorize (already normalized)
 * @param {object}   settings    - Loaded settings (vendor_hints)
 * @param {object[]} catLogCache - Recent cat_log entries (pass [] if not available)
 * @param {string}   accessToken - Supabase JWT access token
 * @param {function} onProgress  - Optional callback(done, total)
 */
export async function categorizeTxs(txs, settings, catLogCache, accessToken, onProgress) {
  const vendorHints = settings?.vendor_hints ?? {}
  const categories = CATS

  // Build a map from merchant → last confirmed cat (from cat_log, last 6 months)
  const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString()
  const recentConfirmed = {}
  for (const entry of catLogCache) {
    if (
      entry.created_at > sixMonthsAgo &&
      (entry.action === 'user_confirmed' || entry.action === 'user_corrected') &&
      entry.tx_id
    ) {
      // Key by merchant (we'll look up the merchant from the tx when matching)
      if (entry.cat_after && !recentConfirmed[entry.tx_id]) {
        recentConfirmed[entry.tx_id] = entry.cat_after
      }
    }
  }

  const results = []
  let done = 0

  for (const tx of txs) {
    const merchantKey = tx.merchant || tx.raw_desc || null

    // 1. No identifiable description
    if (!merchantKey) {
      results.push({ ...tx, needs_review: true, ai_assigned: false })
      done++; onProgress?.(done, txs.length)
      continue
    }

    // 2. Vendor hints
    if (vendorHints[merchantKey]) {
      const { cat } = vendorHints[merchantKey]
      results.push({ ...tx, cat, ai_assigned: false, needs_review: false })
      await writeCatLog({ tx_id: tx.id, action: 'ai_assigned', cat_before: tx.cat ?? null, cat_after: cat, confidence: 1, note: 'vendor_hint' })
      done++; onProgress?.(done, txs.length)
      continue
    }

    // 2b. Alina ML — MercadoLibre purchases broken down by assistant.
    //     Sub-categories are unknown; always flag for manual review.
    if (/alina\s*ml/i.test(merchantKey)) {
      results.push({ ...tx, cat: 'Alina ML', ai_assigned: false, needs_review: true })
      done++; onProgress?.(done, txs.length)
      continue
    }

    // 3. Recent confirmed from cat_log (skip API call)
    if (recentConfirmed[tx.id]) {
      const cat = recentConfirmed[tx.id]
      results.push({ ...tx, cat, ai_assigned: false, needs_review: false })
      done++; onProgress?.(done, txs.length)
      continue
    }

    // 4. Call Edge Function
    try {
      const { cat, confidence, reasoning, usage } = await callEdgeFn(tx, categories, accessToken)

      if (confidence >= CONFIDENCE_THRESHOLD) {
        results.push({ ...tx, cat, ai_assigned: true, ai_confidence: confidence, needs_review: false })
        await writeCatLog({
          tx_id: tx.id, action: 'ai_assigned',
          cat_before: tx.cat ?? null, cat_after: cat, confidence,
          prompt_tokens: usage?.prompt_tokens, completion_tokens: usage?.completion_tokens,
          model: usage?.model,
        })
      } else {
        results.push({ ...tx, cat, ai_assigned: true, ai_confidence: confidence, needs_review: true })
        await writeCatLog({
          tx_id: tx.id, action: 'ai_skipped',
          cat_before: tx.cat ?? null, cat_after: cat, confidence,
          note: reasoning,
          prompt_tokens: usage?.prompt_tokens, completion_tokens: usage?.completion_tokens,
          model: usage?.model,
        })
      }
    } catch (err) {
      results.push({ ...tx, ai_assigned: false, needs_review: true })
      await writeCatLog({
        tx_id: tx.id, action: 'ai_error',
        cat_before: tx.cat ?? null, cat_after: null,
        note: err.message,
      }).catch(() => {}) // don't block on log write failure
    }

    done++; onProgress?.(done, txs.length)
  }

  return results
}

/**
 * After user confirms/corrects a category, check if vendor_hints should be updated.
 * Rule: ≥ 5 confirmed entries for same merchant with >80% agreement on one category.
 */
export async function maybeUpdateVendorHint(merchant, confirmedCat, settings, catLog) {
  if (!merchant) return null
  const entries = catLog.filter(e =>
    (e.action === 'user_confirmed' || e.action === 'user_corrected') &&
    e.cat_after
  )
  // We'd need merchant stored in cat_log to do this properly.
  // For now, return null — full implementation in a follow-up.
  return null
}
