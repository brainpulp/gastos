import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  loadTransactions, upsertTransactions, updateTransaction, softDeleteTransaction,
  insertTransaction, bulkUpdateCat, loadSettings, saveSettings, loadBlueRates, loadCatLog,
  loadDeletedTransactions, restoreTransaction,
} from '../db.js'
import { parseXLSX, buildMerchantHistory, resolveCatFromHistory, makeRateLookup } from '../uploadParser.js'
import {
  CATS, BANKS, fmtUSD, fmtUSDk, fmtARS, fmtDate, fmtMonth, dayHeader, isUncat,
  catColor, usdOf, groupBy, TRACE_CATS,
} from '../lib/shared.js'
import { makeT, SF, safeTop } from './mobileTheme.js'
import {
  Sheet, TabBar, LargeTitle, BankAvatar, CatBadge, Chips, Card, Amount,
  MiniBars, Ring, Field, inputStyle, Btn, SwipeRow,
} from './MobileUI.jsx'

const RING_COLORS = ['#6a5cff', '#37c0e0', '#f5a524', '#f6685e', '#34d399', '#b28dff', '#e0709a', '#8a8ba6']

export default function MobileApp({ session, onLogout }) {
  const [dark, setDark] = useState(() => localStorage.getItem('gastos-theme') === 'dark')
  const t = makeT(dark)

  const [txs, setTxs] = useState(null)
  const [settings, setSettings] = useState(null)
  const [blueRates, setBlueRates] = useState({})
  const [tab, setTab] = useState('resumen')
  const [err, setErr] = useState(null)

  // cross-tab filter state (owned here so Resumen can drive Movimientos)
  const EMPTY_FLT = { search: '', bank: 'all', uncat: false, cat: null, month: null, group: null, dateFrom: '', dateTo: '', amtMin: '', amtMax: '' }
  const [flt, setFlt] = useState(EMPTY_FLT)

  // editing / pickers
  const [editTx, setEditTx] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [picker, setPicker] = useState(null) // { onPick, title }

  useEffect(() => {
    localStorage.setItem('gastos-theme', dark ? 'dark' : 'light')
    document.body.style.background = dark ? '#0b0b14' : '#f2f2f7'
  }, [dark])

  useEffect(() => { reloadAll() }, [])
  async function reloadAll() {
    try {
      const [tx, st, br] = await Promise.all([loadTransactions(), loadSettings(), loadBlueRates()])
      setTxs(tx); setSettings(st); setBlueRates(br)
    } catch (e) { setErr(e.message) }
  }

  const availCats = useMemo(() => {
    const base = settings?.cats?.length ? settings.cats : CATS
    return [...new Set(base)].sort((a, b) => a.localeCompare(b))
  }, [settings])

  const reviewTxs = useMemo(() => (txs || []).filter(x => x.needs_review), [txs])

  // ── mutations ──
  function patchLocal(id, fields) {
    setTxs(prev => prev.map(x => x.id === id ? { ...x, ...fields } : x))
  }
  async function saveTx(id, fields) {
    patchLocal(id, fields)
    try { await updateTransaction(id, fields) } catch (e) { setErr(e.message); reloadAll() }
  }
  async function deleteTx(id) {
    setTxs(prev => prev.filter(x => x.id !== id))
    try { await softDeleteTransaction(id) } catch (e) { setErr(e.message); reloadAll() }
  }
  async function addTx(fields) {
    try { await insertTransaction(fields); await reloadAll() } catch (e) { setErr(e.message) }
  }

  function goToCat(cat) { setFlt({ ...EMPTY_FLT, cat }); setTab('movim') }
  function goToMonth(month) { setFlt({ ...EMPTY_FLT, month }); setTab('movim') }
  function goToGroup(group) { setFlt({ ...EMPTY_FLT, group }); setTab('movim') }
  function openCatPicker(onPick, title = 'Elegí categoría') { setPicker({ onPick, title }) }

  const loading = txs === null || settings === null

  const tabs = [
    { key: 'resumen', label: 'Resumen', icon: '◧' },
    { key: 'movim',   label: 'Movim.',  icon: '≣' },
    { key: 'revisar', label: 'Revisar', icon: '✓', badge: reviewTxs.length },
    { key: 'forense', label: 'Forense', icon: '◫', accent: t.cyan },
    { key: 'config',  label: 'Config',  icon: '⚙' },
  ]

  return (
    <div style={{
      fontFamily: SF, height: '100dvh', display: 'flex', flexDirection: 'column',
      background: t.bg, color: t.ink, overflow: 'hidden', WebkitFontSmoothing: 'antialiased',
    }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: t.muted }}>Cargando…</div>
        ) : (
          <>
            {tab === 'resumen' && <ResumenTab {...{ txs, settings, t, goToCat, goToMonth, goToGroup, reviewCount: reviewTxs.length, setTab }} />}
            {tab === 'movim'   && <MovimientosTab {...{ txs, t, flt, setFlt, emptyFlt: EMPTY_FLT, groups: settings.expense_groups || [], availCats, onEdit: setEditTx, onDelete: deleteTx, openCatPicker, saveTx, onAdd: () => setAddOpen(true) }} />}
            {tab === 'revisar' && <RevisarTab {...{ reviewTxs, t, saveTx, openCatPicker }} />}
            {tab === 'forense' && <ForenseTab {...{ txs, t, onEdit: setEditTx }} />}
            {tab === 'config'  && <ConfigTab {...{ txs, settings, setSettings, t, dark, setDark, availCats, session, onLogout, blueRates, reloadAll, setErr }} />}
          </>
        )}
      </div>

      <TabBar tabs={tabs} active={tab} onChange={setTab} t={t} />

      {/* Edit sheet */}
      <TxSheet tx={editTx} open={!!editTx} onClose={() => setEditTx(null)} {...{ t, saveTx, deleteTx, openCatPicker }} />
      {/* Add sheet */}
      <TxSheet open={addOpen} isNew onClose={() => setAddOpen(false)} {...{ t, addTx, openCatPicker }} />
      {/* Category picker */}
      <CatPicker open={!!picker} onClose={() => setPicker(null)} title={picker?.title} cats={availCats} t={t}
        onPick={c => { picker?.onPick(c); setPicker(null) }} />

      {err && (
        <div onClick={() => setErr(null)} style={{ position: 'fixed', left: 16, right: 16, bottom: 70, zIndex: 300, background: t.neg, color: '#fff', padding: '10px 14px', borderRadius: 12, fontSize: 13, boxShadow: t.shadow }}>
          {err} · tocá para cerrar
        </div>
      )}
    </div>
  )
}

// scroll container for a tab
function TabScroll({ children, onScrollNearBottom }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!onScrollNearBottom) return
    const el = ref.current
    const h = () => { if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) onScrollNearBottom() }
    el.addEventListener('scroll', h)
    return () => el.removeEventListener('scroll', h)
  }, [onScrollNearBottom])
  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      padding: `calc(${safeTop} + 10px) 16px 20px` }}>
      {children}
    </div>
  )
}

// ═══════════════════════ RESUMEN ═══════════════════════
function ResumenTab({ txs, settings, t, goToCat, goToMonth, goToGroup, reviewCount, setTab }) {
  const now = new Date()
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const nonXfer = useMemo(() => txs.filter(x => !x.xfer), [txs])

  // ym of 12 months ago (inclusive window matching the subtitle)
  const cutoffYm = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 11)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [])
  const last12 = useMemo(() => nonXfer.filter(x => x.ym && x.ym >= cutoffYm), [nonXfer, cutoffYm])

  const month = useMemo(() => {
    const m = nonXfer.filter(x => x.ym === curYm)
    const inc = m.filter(x => usdOf(x) > 0).reduce((s, x) => s + usdOf(x), 0)
    const exp = m.filter(x => usdOf(x) < 0).reduce((s, x) => s + usdOf(x), 0)
    return { inc, exp, net: inc + exp }
  }, [nonXfer, curYm])

  const months = useMemo(() => {
    const map = new Map()
    for (const x of nonXfer) {
      if (!x.ym) continue
      map.set(x.ym, (map.get(x.ym) || 0) + Math.min(0, usdOf(x)))
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
      .map(([ym, v]) => ({ key: ym, value: v, title: `${fmtMonth(ym)}: ${fmtUSDk(v)}` }))
  }, [nonXfer])

  const cats = useMemo(() => {
    const map = new Map()
    for (const x of last12) { if (usdOf(x) < 0) map.set(x.cat || 'Sin categoría', (map.get(x.cat || 'Sin categoría') || 0) + Math.abs(usdOf(x))) }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [last12])
  const catsTotal = cats.reduce((s, c) => s + c[1], 0) || 1

  const groupStats = useMemo(() => {
    const gs = (settings?.expense_groups || []).filter(g => g.showOnDash && g.cats?.length)
    return gs.map(g => {
      const set = new Set(g.cats)
      const total = last12.filter(x => usdOf(x) < 0 && set.has(x.cat)).reduce((s, x) => s + Math.abs(usdOf(x)), 0)
      return { id: g.id, name: g.name, total, avg: total / 12 }
    }).filter(g => g.total > 0)
  }, [settings, last12])

  return (
    <TabScroll t={t}>
      <LargeTitle sub="Últimos 12 meses · USD">Resumen</LargeTitle>

      {/* balance card */}
      <div style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.dark ? '#6a5cff' : '#8a7cff'})`, borderRadius: 20, padding: '16px 18px', color: '#fff', boxShadow: `0 14px 30px -14px ${t.accent}` }}>
        <div style={{ fontSize: 12, opacity: .85, fontWeight: 600 }}>Gasto neto · {fmtMonth(curYm)}</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-.03em', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {month.net < 0 ? '−' : '+'}{fmtUSD(Math.abs(month.net))}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11.5 }}>
          <span style={{ opacity: .92 }}>Ingresos <b>{fmtUSDk(month.inc)}</b></span>
          <span style={{ opacity: .92 }}>Gastos <b>{fmtUSDk(month.exp)}</b></span>
        </div>
      </div>

      {/* monthly bars */}
      <Card t={t} style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Gasto mensual</span>
          <span style={{ fontSize: 11, color: t.muted }}>tocá un mes ›</span>
        </div>
        <MiniBars data={months} t={t} height={70} onClick={d => goToMonth(d.key)} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: t.muted, marginTop: 5 }}>
          <span>{months[0] && fmtMonth(months[0].key)}</span>
          <span>{months.at(-1) && fmtMonth(months.at(-1).key)}</span>
        </div>
      </Card>

      {reviewCount > 0 && (
        <Card t={t} style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }} onClick={() => setTab('revisar')}>
          <span style={{ fontSize: 22 }}>🤖</span>
          <div style={{ flex: 1, fontSize: 13 }}><b>{reviewCount} movimientos</b> esperan revisión</div>
          <span style={{ color: t.accent, fontWeight: 800 }}>›</span>
        </Card>
      )}

      {/* grupos de gastos (showOnDash) */}
      {groupStats.length > 0 && (
        <Card t={t} style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Grupos</div>
          {groupStats.map((g, i) => (
            <div key={g.id} onClick={() => goToGroup(g.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', cursor: 'pointer', borderTop: i > 0 ? `1px solid ${t.lineSoft}` : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{g.name}</div>
                <div style={{ fontSize: 11, color: t.muted }}>{fmtUSDk(-g.avg)}/mes prom.</div>
              </div>
              <b style={{ fontVariantNumeric: 'tabular-nums', color: t.neg }}>{fmtUSDk(-g.total)}</b>
            </div>
          ))}
        </Card>
      )}

      {/* por categoria */}
      <Card t={t} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Por categoría</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Ring slices={cats.map((c, i) => ({ value: c[1], color: RING_COLORS[i % RING_COLORS.length] }))} t={t} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {cats.slice(0, 5).map((c, i) => (
              <div key={c[0]} onClick={() => goToCat(c[0])} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 8, cursor: 'pointer' }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: RING_COLORS[i % RING_COLORS.length], flex: '0 0 9px' }} />
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c[0]}</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(c[1] / catsTotal * 100)}%</b>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </TabScroll>
  )
}

// ═══════════════════════ MOVIMIENTOS ═══════════════════════
function MovimientosTab({ txs, t, flt, setFlt, emptyFlt, groups, availCats, onEdit, onDelete, openCatPicker, saveTx, onAdd }) {
  const [visible, setVisible] = useState(50)
  const [advOpen, setAdvOpen] = useState(false)
  const banksPresent = useMemo(() => ['all', ...BANKS.filter(b => txs.some(x => x.bank === b))], [txs])
  const groupCats = useMemo(() => flt.group ? new Set((groups.find(g => g.id === flt.group)?.cats) || []) : null, [flt.group, groups])

  const filtered = useMemo(() => {
    const s = flt.search.trim().toLowerCase()
    return txs.filter(x => {
      if (flt.cat && (x.cat || 'Sin categoría') !== flt.cat) return false
      if (flt.uncat && !isUncat(x)) return false
      if (flt.bank !== 'all' && x.bank !== flt.bank) return false
      if (flt.month && x.ym !== flt.month) return false
      if (groupCats && !groupCats.has(x.cat)) return false
      if (flt.dateFrom && (!x.date || x.date < flt.dateFrom)) return false
      if (flt.dateTo && (!x.date || x.date > flt.dateTo)) return false
      if (flt.amtMin !== '' && Math.abs(usdOf(x)) < +flt.amtMin) return false
      if (flt.amtMax !== '' && Math.abs(usdOf(x)) > +flt.amtMax) return false
      if (s) {
        const hay = [x.merchant, x.raw_desc, x.cat, x.notes, x.referencia].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [txs, flt, groupCats])

  const shown = filtered.slice(0, visible)
  const dayGroups = useMemo(() => groupBy(shown, x => x.date), [shown])

  const advCount = [flt.group, flt.dateFrom, flt.dateTo, flt.amtMin !== '' ? flt.amtMin : null, flt.amtMax !== '' ? flt.amtMax : null].filter(v => v).length
  const advActive = advCount > 0
  const filterActive = flt.cat || flt.uncat || flt.bank !== 'all' || flt.month || flt.search || advActive
  const sumUsd = filtered.filter(x => !x.xfer).reduce((s, x) => s + usdOf(x), 0)

  return (
    <>
      <TabScroll t={t} onScrollNearBottom={() => setVisible(v => (v < filtered.length ? v + 50 : v))}>
        <LargeTitle sub={`${filtered.length.toLocaleString('es-AR')} movimientos`}>Movimientos</LargeTitle>

        <input value={flt.search} onChange={e => setFlt(f => ({ ...f, search: e.target.value }))}
          placeholder="🔍 Buscar comercio, nota, categoría…"
          style={{ ...inputStyle(t), fontSize: 15, marginBottom: 10 }} />

        <div style={{ marginBottom: 6 }}>
          <Chips t={t} value={flt.bank} onChange={v => setFlt(f => ({ ...f, bank: v }))}
            options={banksPresent.map(b => ({ value: b, label: b === 'all' ? 'Todos' : b }))} />
        </div>
        <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setFlt(f => ({ ...f, uncat: !f.uncat }))}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${flt.uncat ? 'transparent' : t.line}`, background: flt.uncat ? t.accent : t.card, color: flt.uncat ? '#fff' : t.inkSoft }}>
            Sin categoría
          </button>
          <button onClick={() => setAdvOpen(true)}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${advActive ? 'transparent' : t.line}`, background: advActive ? t.accent : t.card, color: advActive ? '#fff' : t.inkSoft }}>
            ⚲ Filtros{advActive ? ` (${advCount})` : ''}
          </button>
          {flt.cat && <Pill t={t} onClear={() => setFlt(f => ({ ...f, cat: null }))}>Cat: {flt.cat}</Pill>}
          {flt.month && <Pill t={t} onClear={() => setFlt(f => ({ ...f, month: null }))}>{fmtMonth(flt.month)}</Pill>}
          {flt.group && <Pill t={t} onClear={() => setFlt(f => ({ ...f, group: null }))}>Grupo: {groups.find(g => g.id === flt.group)?.name || '—'}</Pill>}
          {filterActive && <Pill t={t} onClear={() => setFlt(emptyFlt)}>Limpiar todo</Pill>}
        </div>

        {filterActive && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: t.muted, marginBottom: 10, padding: '0 2px' }}>
            <span>Neto del filtro · {filtered.filter(x => !x.xfer).length}</span>
            <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <b style={{ color: sumUsd < 0 ? t.neg : t.pos, fontVariantNumeric: 'tabular-nums' }}>{fmtUSD(sumUsd)}</b>
              <button onClick={() => exportXLSX(filtered, t, () => {})} style={{ background: 'none', border: 'none', color: t.accent, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>Exportar</button>
            </span>
          </div>
        )}

        {dayGroups.length === 0 && <div style={{ textAlign: 'center', color: t.muted, marginTop: 40 }}>Nada por acá</div>}

        {dayGroups.map(([date, rows]) => (
          <div key={date}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: t.muted, margin: '16px 0 2px' }}>{dayHeader(date)}</div>
            <Card t={t} style={{ padding: '0 15px' }}>
              {rows.map((x, i) => (
                <SwipeRow key={x.id} t={t} actions={[
                  { label: 'Categoría', bg: t.accent, onClick: () => openCatPicker(c => saveTx(x.id, { cat: c, needs_review: false }), 'Categorizar') },
                  { label: 'Borrar', bg: t.neg, width: 66, onClick: () => onDelete(x.id) },
                ]}>
                  <TxRow tx={x} t={t} onClick={() => onEdit(x)} borderTop={i > 0} />
                </SwipeRow>
              ))}
            </Card>
          </div>
        ))}
        {visible < filtered.length && <div style={{ textAlign: 'center', color: t.muted, fontSize: 12, padding: 16 }}>cargando más…</div>}
      </TabScroll>

      <button onClick={onAdd} aria-label="Agregar" style={{
        position: 'absolute', right: 18, bottom: 68, width: 54, height: 54, borderRadius: 27, border: 'none',
        background: t.accent, color: '#fff', fontSize: 30, lineHeight: 1, cursor: 'pointer', boxShadow: `0 8px 20px -6px ${t.accent}`,
      }}>+</button>

      <Sheet open={advOpen} onClose={() => setAdvOpen(false)} title="Filtros" t={t}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Desde" t={t}><input type="date" value={flt.dateFrom} onChange={e => setFlt(f => ({ ...f, dateFrom: e.target.value }))} style={inputStyle(t)} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Hasta" t={t}><input type="date" value={flt.dateTo} onChange={e => setFlt(f => ({ ...f, dateTo: e.target.value }))} style={inputStyle(t)} /></Field></div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Monto mín (USD)" t={t}><input type="number" inputMode="decimal" value={flt.amtMin} onChange={e => setFlt(f => ({ ...f, amtMin: e.target.value }))} style={inputStyle(t)} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Monto máx (USD)" t={t}><input type="number" inputMode="decimal" value={flt.amtMax} onChange={e => setFlt(f => ({ ...f, amtMax: e.target.value }))} style={inputStyle(t)} /></Field></div>
        </div>
        {groups.length > 0 && (
          <Field label="Grupo de gastos" t={t}>
            <select value={flt.group || ''} onChange={e => setFlt(f => ({ ...f, group: e.target.value || null }))} style={{ ...inputStyle(t), background: t.inputBg, color: t.ink }}>
              <option value="">— Todos —</option>
              {groups.map(g => <option key={g.id} value={g.id} style={{ background: t.inputBg, color: t.ink }}>{g.name} ({g.cats?.length || 0})</option>)}
            </select>
          </Field>
        )}
        <div style={{ display: 'flex', gap: 9, marginTop: 6 }}>
          <Btn t={t} variant="plain" onClick={() => setFlt(f => ({ ...emptyFlt, search: f.search, bank: f.bank }))} style={{ flex: 1 }}>Limpiar</Btn>
          <Btn t={t} variant="filled" onClick={() => setAdvOpen(false)} style={{ flex: 1 }}>Ver {filtered.length}</Btn>
        </div>
      </Sheet>
    </>
  )
}

// Build an XLSX from rows and share (native/web) or download.
function exportXLSX(rows, t, done) {
  try {
    const data = rows.map(r => ({
      Fecha: r.date ?? '', Merchant: r.merchant ?? '', 'Descripción': r.raw_desc ?? '',
      'Categoría': r.cat ?? '', Banco: r.bank ?? '', ARS: r.ars ?? '', USD: r.usd ?? '',
      'USD Rate': r.usd_rate ?? '', Notas: r.notes ?? '', Referencia: r.referencia ?? '', ID: r.id ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Gastos')
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const fname = `gastos-${new Date().toISOString().slice(0, 10)}.xlsx`
    const file = new File([blob], fname, { type: blob.type })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Gastos' }).catch(() => {})
    } else {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = fname; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    done?.()
  } catch (e) { done?.(e) }
}

function Pill({ children, onClear, t }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 8px 5px 11px', borderRadius: 999, background: t.accentBg, color: t.accentInk }}>
      {children}
      <span onClick={onClear} style={{ cursor: 'pointer', fontWeight: 800 }}>×</span>
    </span>
  )
}

function TxRow({ tx, t, onClick, borderTop }) {
  const title = tx.merchant || tx.raw_desc || '—'
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0', cursor: 'pointer', borderTop: borderTop ? `1px solid ${t.lineSoft}` : 'none' }}>
      <BankAvatar bank={tx.bank} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ marginTop: 3 }}>
          {/* AI cats already carry a 🤖 in the cat string; only add one if flagged but missing it */}
          {tx.ai_assigned && !(tx.cat || '').includes('🤖') && <span style={{ marginRight: 4 }}>🤖</span>}
          <CatBadge cat={tx.cat} t={t} small />
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <Amount value={usdOf(tx)} t={t} size={14} sub={tx.ars != null ? fmtARS(tx.ars) : (tx.bank === 'Santander' ? null : 'USD')} />
      </div>
    </div>
  )
}

// ═══════════════════════ REVISAR ═══════════════════════
function RevisarTab({ reviewTxs, t, saveTx, openCatPicker }) {
  const [i, setI] = useState(0)
  const idx = Math.min(i, Math.max(0, reviewTxs.length - 1)) // clamp at render, no effect
  const tx = reviewTxs[idx]

  if (!reviewTxs.length) {
    return (
      <TabScroll t={t}>
        <LargeTitle>Revisar</LargeTitle>
        <div style={{ textAlign: 'center', color: t.muted, marginTop: 80 }}>
          <div style={{ fontSize: 46 }}>✓</div>
          <div style={{ marginTop: 10, fontSize: 15 }}>Nada para revisar</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>La cola de la IA está vacía</div>
        </div>
      </TabScroll>
    )
  }

  const accept = () => saveTx(tx.id, { needs_review: false })
  const reject = () => saveTx(tx.id, { cat: null, ai_assigned: false, ai_confidence: null, needs_review: false })
  const change = () => openCatPicker(c => saveTx(tx.id, { cat: c, ai_assigned: false, needs_review: false }), 'Cambiar categoría')

  return (
    <TabScroll t={t}>
      <LargeTitle sub={`${idx + 1} de ${reviewTxs.length} · la IA propuso estas categorías`}>Revisar</LargeTitle>

      <Card t={t} style={{ marginTop: 6, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <BankAvatar bank={tx.bank} size={30} />
          <span style={{ fontSize: 11, color: t.muted, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(tx.date)}</span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', marginTop: 12 }}>{tx.merchant || tx.raw_desc || '—'}</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3, color: usdOf(tx) < 0 ? t.neg : t.pos, fontVariantNumeric: 'tabular-nums' }}>{fmtUSD(usdOf(tx))}{tx.ars != null && <span style={{ fontSize: 12, color: t.muted, fontWeight: 500 }}>  ·  {fmtARS(tx.ars)}</span>}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
          <span style={{ fontSize: 11.5, color: t.muted }}>IA sugiere</span>
          <span style={{ fontWeight: 700, fontSize: 13, background: t.accentBg, color: t.accentInk, padding: '4px 11px', borderRadius: 9 }}>🤖 {(tx.cat || '—').replace('🤖 ', '')}</span>
          {tx.ai_confidence != null && <span style={{ marginLeft: 'auto', fontSize: 11, color: t.pos, fontVariantNumeric: 'tabular-nums' }}>{Math.round(tx.ai_confidence * 100)}%</span>}
        </div>

        <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
          <Btn t={t} variant="pos" onClick={accept} style={{ flex: 1 }}>✓ Aceptar</Btn>
          <Btn t={t} variant="plain" onClick={change} style={{ flex: 1 }}>Cambiar</Btn>
        </div>
        <Btn t={t} variant="danger" onClick={reject} style={{ marginTop: 9 }}>Rechazar (sin categoría)</Btn>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
        <button disabled={idx === 0} onClick={() => setI(idx - 1)} style={navBtn(t, idx === 0)}>‹ Anterior</button>
        <button disabled={idx >= reviewTxs.length - 1} onClick={() => setI(idx + 1)} style={navBtn(t, idx >= reviewTxs.length - 1)}>Siguiente ›</button>
      </div>
    </TabScroll>
  )
}
function navBtn(t, disabled) {
  return { background: 'none', border: 'none', color: disabled ? t.faint : t.accent, fontSize: 14, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', padding: 6 }
}

// ═══════════════════════ FORENSE ═══════════════════════
function ForenseTab({ txs, t, onEdit }) {
  const [win, setWin] = useState('2020')       // '2020' | '2023'
  const [threshold, setThreshold] = useState(5000)

  const from = '2020-01-01'
  const to = win === '2023' ? '2023-12-31' : '9999'

  const scope = useMemo(() => txs.filter(x => !x.xfer && x.date && x.date >= from && x.date <= to), [txs, to])

  const sources = scope.filter(x => usdOf(x) > 0).reduce((s, x) => s + usdOf(x), 0)
  const uses = scope.filter(x => usdOf(x) < 0).reduce((s, x) => s + Math.abs(usdOf(x)), 0)
  const net = sources - uses
  const toTrace = scope.filter(x => usdOf(x) < 0 && (isUncat(x) || TRACE_CATS.includes(x.cat)))
    .reduce((s, x) => s + Math.abs(usdOf(x)), 0)

  const byYear = useMemo(() => {
    const map = new Map()
    for (const x of scope) {
      const y = x.year || x.date?.slice(0, 4)
      if (!y) continue
      if (!map.has(y)) map.set(y, { src: 0, use: 0 })
      const rec = map.get(y)
      if (usdOf(x) > 0) rec.src += usdOf(x); else rec.use += Math.abs(usdOf(x))
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [scope])
  const yearMax = Math.max(1, ...byYear.map(([, r]) => Math.max(r.src, r.use)))

  const bigTickets = useMemo(() =>
    scope.filter(x => Math.abs(usdOf(x)) >= threshold).sort((a, b) => Math.abs(usdOf(b)) - Math.abs(usdOf(a))).slice(0, 60),
    [scope, threshold])

  return (
    <TabScroll t={t}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: t.cyan }}>● Forense</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: t.muted, fontVariantNumeric: 'tabular-nums' }}>{win === '2023' ? '2020 – 2023' : '2020 → hoy'}</span>
      </div>
      <LargeTitle sub="Fuentes y usos · aprox. top-down desde lo bancarizado">Flujo de fondos</LargeTitle>

      <div style={{ marginBottom: 12 }}>
        <Chips t={t} value={win} onChange={setWin} options={[{ value: '2020', label: '2020 → hoy' }, { value: '2023', label: '2020–2023' }]} />
      </div>

      {/* KPI card */}
      <Card t={t}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
          <Kpi t={t} label="Fuentes" value={fmtUSDk(sources)} color={t.pos} />
          <Kpi t={t} label="Usos" value={fmtUSDk(-uses)} color={t.neg} />
          <Kpi t={t} label="Neto" value={fmtUSDk(net)} color={net < 0 ? t.neg : t.pos} />
        </div>
        <div style={{ height: 1, background: t.line, margin: '14px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: t.muted }}>A rastrear (efectivo / sin cat. / transferencias)</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: t.cyan, fontVariantNumeric: 'tabular-nums' }}>{fmtUSDk(-toTrace)}</div>
          </div>
          <div style={{ fontSize: 34 }}>🔍</div>
        </div>
      </Card>

      <p style={{ fontSize: 11.5, color: t.muted, lineHeight: 1.5, margin: '12px 2px' }}>
        Esto suma lo <b style={{ color: t.inkSoft }}>bancarizado</b> en la base. El GAP real (net-worth) requiere
        cargar saldos de activos y grandes movimientos en efectivo — ver <b style={{ color: t.inkSoft }}>FORENSIC.md</b>.
        Las categorías <i>Must trace</i>, <i>cash extraction</i> y transferencias marcan lo que falta reconstruir.
      </p>

      {/* by year */}
      <Card t={t} style={{ marginTop: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Por año</div>
        {byYear.map(([y, r]) => (
          <div key={y} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <b>{y}</b>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}><span style={{ color: t.pos }}>{fmtUSDk(r.src)}</span> · <span style={{ color: t.neg }}>{fmtUSDk(-r.use)}</span></span>
            </div>
            <div style={{ display: 'flex', gap: 3, height: 8 }}>
              <div style={{ width: `${(r.src / yearMax) * 50}%`, background: t.pos, borderRadius: 3 }} />
              <div style={{ width: `${(r.use / yearMax) * 50}%`, background: t.neg, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </Card>

      {/* big tickets */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 2px 8px' }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Grandes movimientos</span>
      </div>
      <div style={{ marginBottom: 10 }}>
        <Chips t={t} value={threshold} onChange={setThreshold} options={[{ value: 5000, label: '≥ $5k' }, { value: 10000, label: '≥ $10k' }, { value: 25000, label: '≥ $25k' }]} />
      </div>
      <Card t={t} style={{ padding: '0 15px' }}>
        {bigTickets.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: t.muted }}>Nada sobre el umbral</div>}
        {bigTickets.map((x, i) => {
          const trace = isUncat(x) || TRACE_CATS.includes(x.cat)
          return (
            <div key={x.id} onClick={() => onEdit(x)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', cursor: 'pointer', borderTop: i > 0 ? `1px solid ${t.lineSoft}` : 'none' }}>
              <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: trace ? t.cyan : 'transparent' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.merchant || x.raw_desc || x.cat || '—'}</div>
                <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>{fmtDate(x.date)} · {x.bank || '—'}{trace && <span style={{ color: t.cyan, fontWeight: 700 }}> · a rastrear</span>}</div>
              </div>
              <Amount value={usdOf(x)} t={t} size={14} />
            </div>
          )
        })}
      </Card>
    </TabScroll>
  )
}
function Kpi({ label, value, color, t }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: t.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color, marginTop: 3, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' }}>{value}</div>
    </div>
  )
}

// ═══════════════════════ CONFIG ═══════════════════════
function ConfigTab({ txs, settings, setSettings, t, dark, setDark, availCats, session, onLogout, blueRates, reloadAll, setErr }) {
  const [budget, setBudget] = useState(settings.monthly_budget_usd || 0)
  const [budgetSaved, setBudgetSaved] = useState(false)
  const [catSheet, setCatSheet] = useState(null)      // category name being edited
  const [renameVal, setRenameVal] = useState('')
  const [iaOpen, setIaOpen] = useState(false)
  const [iaLog, setIaLog] = useState(null)
  const [upMsg, setUpMsg] = useState(null)
  const fileRef = useRef(null)
  const [groupSheet, setGroupSheet] = useState(null)   // 'new' | group object
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashList, setTrashList] = useState(null)
  const [addCatOpen, setAddCatOpen] = useState(false)
  const [newCatVal, setNewCatVal] = useState('')

  const groups = settings.expense_groups || []

  async function saveGroups(next) {
    setSettings(s => ({ ...s, expense_groups: next }))
    try { await saveSettings({ ...settings, expense_groups: next }) } catch (e) { setErr(e.message) }
  }
  async function addCategory() {
    const c = newCatVal.trim(); setAddCatOpen(false); setNewCatVal('')
    if (!c) return
    const base = settings.cats?.length ? settings.cats : availCats
    if (base.includes(c)) return
    const next = [...base, c]
    setSettings(s => ({ ...s, cats: next }))
    try { await saveSettings({ ...settings, cats: next }) } catch (e) { setErr(e.message) }
  }
  async function openTrash() {
    setTrashOpen(true)
    if (!trashList) { try { setTrashList(await loadDeletedTransactions()) } catch { setTrashList([]) } }
  }
  async function doRestore(id) {
    setTrashList(list => list.filter(x => x.id !== id))
    try { await restoreTransaction(id); await reloadAll() } catch (e) { setErr(e.message) }
  }

  const catCounts = useMemo(() => {
    const m = new Map()
    for (const x of txs) if (x.cat) m.set(x.cat, (m.get(x.cat) || 0) + 1)
    return m
  }, [txs])
  const catsWithCounts = useMemo(() => [...new Set([...availCats, ...catCounts.keys()])].sort((a, b) => (catCounts.get(b) || 0) - (catCounts.get(a) || 0)), [availCats, catCounts])

  async function saveBudget() {
    try { await saveSettings({ ...settings, monthly_budget_usd: +budget }); setSettings(s => ({ ...s, monthly_budget_usd: +budget })); setBudgetSaved(true); setTimeout(() => setBudgetSaved(false), 1500) }
    catch (e) { setErr(e.message) }
  }

  async function applyRename() {
    const from = catSheet, to = renameVal.trim()
    setCatSheet(null)
    if (!to || to === from) return
    try { await bulkUpdateCat(from, to); await reloadAll() } catch (e) { setErr(e.message) }
  }
  async function emptyCat() {
    const from = catSheet
    setCatSheet(null)
    try { await bulkUpdateCat(from, null); await reloadAll() } catch (e) { setErr(e.message) }
  }

  async function openIa() {
    setIaOpen(true)
    if (!iaLog) { try { setIaLog(await loadCatLog({ limit: 200 })) } catch { setIaLog([]) } }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUpMsg({ text: 'Procesando archivo…' })
    try {
      const { txs: parsed, count } = await parseXLSX(file)
      const rateFor = makeRateLookup(blueRates)
      const history = buildMerchantHistory(txs)
      const enriched = parsed.map(tx => {
        const rate = rateFor(tx.date)
        if (!rate) throw new Error(`Sin cotización blue para ${tx.date}. Actualizá blue_rates.`)
        const cat = resolveCatFromHistory(tx, history)
        return { ...tx, cat, usd_rate: rate, usd: +(tx.ars / rate).toFixed(2) }
      })
      setUpMsg({ text: `Subiendo ${count}…` })
      const { skipped } = await upsertTransactions(enriched)
      await reloadAll()
      setUpMsg({ text: `✅ ${count} importadas${skipped.length ? ` · ${skipped.length} omitidas` : ''}` })
    } catch (err) { setUpMsg({ text: `❌ ${err.message}`, error: true }) }
  }

  return (
    <TabScroll t={t}>
      <LargeTitle>Config</LargeTitle>

      <Section t={t} title="Apariencia">
        <RowItem t={t} label="Modo oscuro" trailing={<Toggle on={dark} onChange={setDark} t={t} />} />
      </Section>

      <Section t={t} title="Presupuesto mensual (USD)">
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} style={{ ...inputStyle(t), flex: 1 }} />
          <Btn t={t} variant="filled" onClick={saveBudget} style={{ width: 'auto', padding: '11px 18px' }}>{budgetSaved ? '✓' : 'Guardar'}</Btn>
        </div>
      </Section>

      <Section t={t} title="Datos">
        <RowItem t={t} label="Subir XLSX (Santander)" sub={upMsg?.text} onClick={() => fileRef.current?.click()} chevron />
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} style={{ display: 'none' }} />
        <RowItem t={t} label="Exportar / Compartir XLSX" sub={`${txs.length.toLocaleString('es-AR')} movimientos`} onClick={() => exportXLSX(txs, t, e => e && setErr(e.message))} chevron />
        <RowItem t={t} label="Papelera" sub="Ver y restaurar borrados" onClick={openTrash} chevron />
        <RowItem t={t} label="Historial IA" onClick={openIa} chevron />
      </Section>

      <Section t={t} title={`Grupos de gastos (${groups.length})`}>
        {groups.map(g => (
          <RowItem key={g.id} t={t} label={g.name} sub={`${g.cats?.length || 0} categorías${g.showOnDash ? ' · en resumen' : ''}`}
            onClick={() => setGroupSheet(g)} chevron />
        ))}
        <RowItem t={t} label="+ Nuevo grupo" onClick={() => setGroupSheet('new')} />
      </Section>

      <Section t={t} title={`Categorías (${catsWithCounts.length})`}>
        <RowItem t={t} label="+ Agregar categoría" onClick={() => { setNewCatVal(''); setAddCatOpen(true) }} />
        {catsWithCounts.slice(0, 60).map(c => (
          <RowItem key={c} t={t} label={c} sub={`${catCounts.get(c) || 0} movim.`}
            leading={<span style={{ width: 12, height: 12, borderRadius: 4, background: catColor(c, .8), display: 'inline-block' }} />}
            onClick={() => { setCatSheet(c); setRenameVal(c) }} chevron />
        ))}
      </Section>

      <Section t={t} title="Cuenta">
        <RowItem t={t} label="Sesión" sub={session?.user?.email} />
        <Btn t={t} variant="danger" onClick={onLogout} style={{ marginTop: 8 }}>Cerrar sesión</Btn>
      </Section>

      <div style={{ textAlign: 'center', color: t.faint, fontSize: 11, margin: '24px 0 8px' }}>Gastos · versión móvil</div>

      {/* category edit sheet */}
      <Sheet open={!!catSheet} onClose={() => setCatSheet(null)} title={`Categoría · ${catSheet || ''}`} t={t}>
        <Field label="Renombrar o fusionar" t={t}>
          <input value={renameVal} onChange={e => setRenameVal(e.target.value)} list="allcats" style={inputStyle(t)} />
          <datalist id="allcats">{availCats.map(c => <option key={c} value={c} />)}</datalist>
        </Field>
        <div style={{ fontSize: 11.5, color: t.muted, marginBottom: 12 }}>Escribí un nombre existente para fusionar, o uno nuevo para renombrar. Afecta {catCounts.get(catSheet) || 0} movimientos.</div>
        <Btn t={t} variant="filled" onClick={applyRename}>Aplicar</Btn>
        <Btn t={t} variant="danger" onClick={emptyCat} style={{ marginTop: 9 }}>Vaciar categoría (sin cat.)</Btn>
      </Sheet>

      {/* Add category sheet */}
      <Sheet open={addCatOpen} onClose={() => setAddCatOpen(false)} title="Agregar categoría" t={t}>
        <Field label="Nombre" t={t}><input value={newCatVal} onChange={e => setNewCatVal(e.target.value)} autoFocus style={inputStyle(t)} /></Field>
        <Btn t={t} variant="filled" onClick={addCategory}>Agregar</Btn>
      </Sheet>

      {/* Group editor sheet */}
      <GroupSheet open={!!groupSheet} group={groupSheet === 'new' ? null : groupSheet} onClose={() => setGroupSheet(null)}
        t={t} allCats={catsWithCounts}
        onSave={g => { const rest = groups.filter(x => x.id !== g.id); saveGroups([...rest, g]); setGroupSheet(null) }}
        onDelete={id => { saveGroups(groups.filter(x => x.id !== id)); setGroupSheet(null) }} />

      {/* Trash sheet */}
      <Sheet open={trashOpen} onClose={() => setTrashOpen(false)} title="Papelera" t={t}>
        {trashList === null && <div style={{ color: t.muted }}>Cargando…</div>}
        {trashList && trashList.length === 0 && <div style={{ color: t.muted }}>Sin movimientos borrados</div>}
        {trashList && trashList.map(x => (
          <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${t.lineSoft}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.merchant || x.raw_desc || '—'}</div>
              <div style={{ fontSize: 11, color: t.muted }}>{fmtDate(x.date)} · {fmtUSD(usdOf(x))}</div>
            </div>
            <button onClick={() => doRestore(x.id)} style={{ background: t.accentBg, color: t.accentInk, border: 'none', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Restaurar</button>
          </div>
        ))}
      </Sheet>

      {/* IA history sheet */}
      <Sheet open={iaOpen} onClose={() => setIaOpen(false)} title="Historial IA" t={t}>
        {iaLog === null && <div style={{ color: t.muted }}>Cargando…</div>}
        {iaLog && iaLog.length === 0 && <div style={{ color: t.muted }}>Sin registros</div>}
        {iaLog && iaLog.map((l, i) => (
          <div key={l.id || i} style={{ padding: '9px 0', borderBottom: `1px solid ${t.lineSoft}`, fontSize: 12.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <b>{l.cat || l.new_cat || '—'}</b>
              <span style={{ color: t.muted, fontSize: 11 }}>{(l.created_at || '').slice(0, 10)}</span>
            </div>
            <div style={{ color: t.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.merchant || l.raw_desc || l.reason || ''}</div>
          </div>
        ))}
      </Sheet>
    </TabScroll>
  )
}

function Section({ title, children, t }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: t.muted, margin: '0 4px 7px' }}>{title}</div>
      <Card t={t} style={{ padding: '4px 15px' }}>{children}</Card>
    </div>
  )
}
function RowItem({ label, sub, leading, trailing, onClick, chevron, t }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', cursor: onClick ? 'pointer' : 'default', borderBottom: `1px solid ${t.lineSoft}` }}>
      {leading}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: t.muted, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      {trailing}
      {chevron && <span style={{ color: t.faint, fontSize: 18 }}>›</span>}
    </div>
  )
}
function Toggle({ on, onChange, t }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: 50, height: 30, borderRadius: 15, border: 'none', cursor: 'pointer', background: on ? t.pos : t.barTrack, position: 'relative', transition: 'background .2s' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: 12, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
    </button>
  )
}

// ═══════════════════════ shared sheets ═══════════════════════
function CatPicker({ open, onClose, title, cats, onPick, t }) {
  const [q, setQ] = useState('')
  useEffect(() => { if (open) setQ('') }, [open])
  const filtered = cats.filter(c => c.toLowerCase().includes(q.toLowerCase()))
  return (
    <Sheet open={open} onClose={onClose} title={title || 'Elegí categoría'} t={t}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" autoFocus style={{ ...inputStyle(t), marginBottom: 12 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {q.trim() && !cats.some(c => c.toLowerCase() === q.trim().toLowerCase()) && (
          <button onClick={() => onPick(q.trim())} style={{ ...catChip(t), border: `1px dashed ${t.accent}`, color: t.accentInk }}>+ “{q.trim()}”</button>
        )}
        {filtered.map(c => (
          <button key={c} onClick={() => onPick(c)} style={{ ...catChip(t), background: catColor(c, t.dark ? .24 : .16), color: t.dark ? '#eaeaf5' : '#222' }}>{c}</button>
        ))}
      </div>
    </Sheet>
  )
}
function catChip(t) {
  return { border: `1px solid ${t.line}`, background: t.card2, color: t.ink, padding: '9px 13px', borderRadius: 11, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }
}

function GroupSheet({ open, group, onClose, t, allCats, onSave, onDelete }) {
  const [name, setName] = useState('')
  const [showOnDash, setShowOnDash] = useState(false)
  const [cats, setCats] = useState([])
  useEffect(() => {
    if (open) { setName(group?.name || ''); setShowOnDash(!!group?.showOnDash); setCats(group?.cats || []) }
  }, [open, group])
  const toggle = c => setCats(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c])
  function save() {
    if (!name.trim()) return
    const id = group?.id || ('g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5))
    onSave({ id, name: name.trim(), cats, showOnDash })
  }
  return (
    <Sheet open={open} onClose={onClose} title={group ? 'Editar grupo' : 'Nuevo grupo'} t={t}>
      <Field label="Nombre" t={t}><input value={name} onChange={e => setName(e.target.value)} style={inputStyle(t)} /></Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 2px 14px', fontSize: 14 }}>
        <input type="checkbox" checked={showOnDash} onChange={e => setShowOnDash(e.target.checked)} /> Mostrar en Resumen
      </label>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: t.muted, marginBottom: 8 }}>Categorías ({cats.length})</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {allCats.map(c => {
          const on = cats.includes(c)
          return <button key={c} onClick={() => toggle(c)} style={{ ...catChip(t), background: on ? catColor(c, t.dark ? 0.24 : 0.16) : t.card2, color: on ? (t.dark ? '#eaeaf5' : '#222') : t.muted, border: `1px solid ${on ? 'transparent' : t.line}` }}>{on ? '✓ ' : ''}{c}</button>
        })}
      </div>
      <Btn t={t} variant="filled" onClick={save}>Guardar</Btn>
      {group && <Btn t={t} variant="danger" onClick={() => onDelete(group.id)} style={{ marginTop: 9 }}>Eliminar grupo</Btn>}
    </Sheet>
  )
}

function TxSheet({ tx, open, isNew, onClose, t, saveTx, addTx, deleteTx, openCatPicker }) {
  const blank = { date: new Date().toISOString().slice(0, 10), merchant: '', cat: null, bank: 'Santander', usd: '', ars: '', notes: '', xfer: false, needs_review: false }
  const [f, setF] = useState(blank)
  useEffect(() => {
    if (open) setF(isNew ? blank : {
      date: tx.date || '', merchant: tx.merchant || '', cat: tx.cat || null, bank: tx.bank || '',
      usd: tx.usd ?? '', ars: tx.ars ?? '', notes: tx.notes || '', xfer: !!tx.xfer, needs_review: !!tx.needs_review,
    })
  }, [open, tx, isNew])

  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))

  function submit() {
    const fields = {
      date: f.date, merchant: f.merchant || null, cat: f.cat, bank: f.bank || null,
      usd: f.usd === '' ? null : +f.usd, ars: f.ars === '' ? null : +f.ars,
      notes: f.notes || null, xfer: f.xfer, needs_review: f.needs_review,
    }
    if (isNew) addTx(fields); else saveTx(tx.id, fields)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={isNew ? 'Nuevo movimiento' : 'Editar movimiento'} t={t}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Field label="Fecha" t={t}><input type="date" value={f.date} onChange={set('date')} style={inputStyle(t)} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Banco" t={t}>
          <select value={f.bank} onChange={set('bank')} style={{ ...inputStyle(t), background: t.inputBg, color: t.ink }}>
            <option value="">—</option>
            {BANKS.map(b => <option key={b} value={b} style={{ background: t.inputBg, color: t.ink }}>{b}</option>)}
          </select>
        </Field></div>
      </div>

      <Field label="Comercio / descripción" t={t}><input value={f.merchant} onChange={set('merchant')} style={inputStyle(t)} placeholder={tx?.raw_desc || ''} /></Field>

      <Field label="Categoría" t={t}>
        <button onClick={() => openCatPicker(c => setF(p => ({ ...p, cat: c })), 'Elegí categoría')}
          style={{ ...inputStyle(t), textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          {f.cat ? <CatBadge cat={f.cat} t={t} /> : <span style={{ color: t.muted }}>Sin categoría — tocá para elegir</span>}
        </button>
      </Field>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Field label="USD (− gasto)" t={t}><input type="number" inputMode="decimal" value={f.usd} onChange={set('usd')} style={inputStyle(t)} /></Field></div>
        <div style={{ flex: 1 }}><Field label="ARS" t={t}><input type="number" inputMode="decimal" value={f.ars} onChange={set('ars')} style={inputStyle(t)} /></Field></div>
      </div>

      <Field label="Notas" t={t}><input value={f.notes} onChange={set('notes')} style={inputStyle(t)} /></Field>

      <div style={{ display: 'flex', gap: 18, margin: '4px 2px 16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14 }}>
          <input type="checkbox" checked={f.xfer} onChange={e => setF(p => ({ ...p, xfer: e.target.checked }))} /> Transferencia
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14 }}>
          <input type="checkbox" checked={f.needs_review} onChange={e => setF(p => ({ ...p, needs_review: e.target.checked }))} /> Revisar
        </label>
      </div>

      <Btn t={t} variant="filled" onClick={submit}>{isNew ? 'Agregar' : 'Guardar'}</Btn>
      {!isNew && <Btn t={t} variant="danger" onClick={() => { deleteTx(tx.id); onClose() }} style={{ marginTop: 9 }}>Borrar</Btn>}
    </Sheet>
  )
}
