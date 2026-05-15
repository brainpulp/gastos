import { useState, useEffect, useMemo, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend, CartesianGrid, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
  PieChart, Pie, Cell,
} from 'recharts'
import _ from 'lodash'
import * as XLSX from 'xlsx'
import { parseXLSX } from './uploadParser.js'
import {
  loadTransactions, upsertTransactions, softDeleteTransaction, updateTransaction,
  loadSettings, saveSettings, loadCatLog, loadBlueRates,
} from './db.js'
import { categorizeTxs } from './categorize.js'

// ─── Constants ───────────────────────────────────────────────────────────────

export const CATS = [
  'Amazon FBA', 'AR taxes', 'Arcos', 'Boat maintenance',
  'Business expense', 'Car maintenance', 'Carhué obra', 'Clothing',
  'Delta', 'Dining', 'El Dorado', 'Entertainment', 'Food', 'Gas', 'Gifts',
  'Healthcare', 'Home utilities',
  'Interbank incoming', 'Interbank outgoing', 'Legal fees', 'Loans given',
  'Mocoreta', 'Must trace', 'pets',
  'Puente to Santander', 'Roca deptos', 'Shopping', 'sports and exercise',
  'Topozoids', 'transportation', 'Travel', 'Uncategorized Expenses', 'US taxes',
]

const BANKS = ['BofA', 'Cash', 'Chase', 'Citibank', 'Santander', 'Wells Fargo']

const isUncat = (t) => !t.cat || t.cat.trim() === '' || t.cat === 'Uncategorized Expenses'

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmtDate = (s) => {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const fmtARS = (n) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}
const fmtUSD = (n) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}
const fmtK = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)))

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  app: { fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f4f5f7' },
  nav: {
    display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px',
    background: '#1a1a2e', color: '#fff', height: 48, flexWrap: 'wrap',
  },
  navBtn: (active) => ({
    padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? '#1a1a2e' : '#ccc', fontWeight: active ? 600 : 400, fontSize: 14,
  }),
  logo: { fontWeight: 700, fontSize: 18, marginRight: 8, color: '#fff' },
  spacer: { flex: 1 },
  logoutBtn: {
    padding: '4px 12px', border: '1px solid #555', borderRadius: 6,
    background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 13,
  },
  content: { padding: 16, maxWidth: 1200, margin: '0 auto' },
  card: {
    background: '#fff', borderRadius: 10, padding: 16,
    boxShadow: '0 1px 6px rgba(0,0,0,.08)', marginBottom: 16,
  },
  filterBar: {
    background: '#fff', borderRadius: 10, padding: '10px 16px',
    boxShadow: '0 1px 6px rgba(0,0,0,.08)', marginBottom: 16,
    display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start',
  },
  filterGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
  filterLabel: { fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em' },
  select: { padding: '4px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, background: '#fff' },
  input: { padding: '4px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 },
  statVal: { fontSize: 28, fontWeight: 700, color: '#1a1a2e' },
  statSub: { fontSize: 12, color: '#aaa', marginTop: 3 },
  statLbl: { fontSize: 12, color: '#888', marginTop: 2 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #eee',
    color: '#666', fontWeight: 600, fontSize: 12, textTransform: 'uppercase',
  },
  td: { padding: '7px 10px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'middle' },
  negARS: { color: '#c0392b', fontWeight: 500 },
  posARS: { color: '#27ae60', fontWeight: 500 },
  btn: (variant = 'primary') => ({
    padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
    background: variant === 'primary' ? '#1a1a2e' : '#f0f0f0',
    color: variant === 'primary' ? '#fff' : '#333',
  }),
  btnSm: (variant = 'ghost') => ({
    padding: '3px 8px', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', fontSize: 12,
    background: variant === 'danger' ? '#fee2e2' : variant === 'active' ? '#1a1a2e' : 'transparent',
    color: variant === 'danger' ? '#c0392b' : variant === 'active' ? '#fff' : '#555',
    borderColor: variant === 'active' ? '#1a1a2e' : '#ddd',
  }),
}

function catColor(cat, alpha = 1) {
  let h = 0
  for (let i = 0; i < (cat || '').length; i++) h = (h * 31 + cat.charCodeAt(i)) % 360
  return `hsla(${h},60%,50%,${alpha})`
}

const badge = (cat) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
  background: catColor(cat, 0.15), color: catColor(cat, 0.85),
})


// ─── Multi-select filter dropdown ────────────────────────────────────────────

function MultiSelectFilter({ label, options, selected, onChange, groups = [] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = val => onChange(selected.includes(val) ? selected.filter(x => x !== val) : [...selected, val])
  const groupAllSelected = g => g.cats.length > 0 && g.cats.every(c => selected.includes(c))
  const groupSomeSelected = g => g.cats.some(c => selected.includes(c))
  const toggleGroup = g => {
    if (groupAllSelected(g)) onChange(selected.filter(c => !g.cats.includes(c)))
    else onChange([...new Set([...selected, ...g.cats])])
  }
  const groupedCatSet = new Set(groups.flatMap(g => g.cats))
  const ungroupedOptions = options.filter(o => !groupedCatSet.has(o))

  return (
    <div style={{ ...S.filterGroup, position: 'relative' }} ref={ref}>
      <span style={S.filterLabel}>{label}</span>
      <button onClick={() => setOpen(o => !o)} style={{
        ...S.select, textAlign: 'left', cursor: 'pointer', minWidth: 130,
        background: selected.length ? '#1a1a2e' : '#fff',
        color: selected.length ? '#fff' : '#333',
      }}>
        {selected.length === 0 ? `Todos ▾` : `${selected.length} sel. ▾`}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200,
          background: '#fff', border: '1px solid #ddd', borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.13)', padding: '6px 0',
          minWidth: 220, maxHeight: 340, overflowY: 'auto',
        }}>
          {selected.length > 0 && (
            <div style={{ padding: '4px 12px 6px', borderBottom: '1px solid #f0f0f0' }}>
              <button style={{ fontSize: 11, color: '#888', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => onChange([])}>✕ Limpiar</button>
            </div>
          )}
          {groups.length > 0 && <>
            <div style={{ padding: '6px 12px 3px', fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em' }}>Grupos</div>
            {groups.map(g => (
              <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, userSelect: 'none', background: groupSomeSelected(g) ? '#f3e8ff' : 'transparent' }}>
                <input type="checkbox" checked={groupAllSelected(g)}
                  ref={el => { if (el) el.indeterminate = groupSomeSelected(g) && !groupAllSelected(g) }}
                  onChange={() => toggleGroup(g)} />
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>{g.cats.length}</span>
              </label>
            ))}
            <div style={{ margin: '4px 0', borderTop: '1px solid #f0f0f0' }} />
            <div style={{ padding: '4px 12px 3px', fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em' }}>Categorías</div>
          </>}
          {ungroupedOptions.map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, userSelect: 'none' }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Finanzas({ session, onLogout }) {
  const [txs, setTxs] = useState([])
  const [settings, setSettings] = useState(null)
  const [blueRates, setBlueRates] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [activeTab, setActiveTab] = useState(() => {
    const hash = window.location.hash.replace('#', '')
    const valid = ['dash', 'txs', 'revisar', 'presupuesto', 'auditoria', 'settings']
    return valid.includes(hash) ? hash : 'dash'
  })
  const [uploadMsg, setUploadMsg] = useState(null)
  const fileRef = useRef()

  // Filters
  const [selYears, setSelYears] = useState([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [catFs, setCatFs] = useState([])
  const [bankFs, setBankFs] = useState([])
  const [search, setSearch] = useState('')
  const [showUncatOnly, setShowUncatOnly] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [txData, settingsData, rates] = await Promise.all([
          loadTransactions(), loadSettings(), loadBlueRates(),
        ])
        if (cancelled) return
        setTxs(txData); setSettings(settingsData); setBlueRates(rates)
      } catch (e) {
        if (!cancelled) setLoadErr(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const availYears = useMemo(
    () => [...new Set(txs.map(t => t.date?.slice(0, 4)).filter(Boolean))].sort().reverse(),
    [txs]
  )

  const availCats = useMemo(
    () => [...new Set(txs.map(t => t.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [txs]
  )

  const lastTxDate = useMemo(
    () => txs.length ? txs.reduce((m, t) => (t.date > m ? t.date : m), '') : null,
    [txs]
  )

  const filtered = useMemo(() => txs.filter(t => {
    if (selYears.length && !selYears.includes(t.date?.slice(0, 4))) return false
    if (dateFrom && t.date < dateFrom) return false
    if (dateTo && t.date > dateTo) return false
    if (catFs.length && !catFs.includes(t.cat)) return false
    if (bankFs.length && !bankFs.includes(t.bank)) return false
    if (showUncatOnly && !isUncat(t)) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(t.raw_desc?.toLowerCase().includes(q) || t.merchant?.toLowerCase().includes(q) ||
            t.cat?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q))) return false
    }
    return true
  }), [txs, selYears, dateFrom, dateTo, catFs, bankFs, search, showUncatOnly])

  const filterActive = !!(selYears.length || dateFrom || dateTo || catFs.length || bankFs.length || search || showUncatOnly)

  const filterSummary = useMemo(() => {
    const nonXfer = filtered.filter(t => !t.xfer)
    const out = nonXfer.filter(t => (t.usd ?? 0) < 0).reduce((s, t) => s + (t.usd || 0), 0)
    const inc = nonXfer.filter(t => (t.usd ?? 0) > 0).reduce((s, t) => s + (t.usd || 0), 0)
    return { out, inc }
  }, [filtered])

  // Expense txs: non-transfers with negative amount (drives all KPIs and charts)
  const expenseTxs = useMemo(
    () => filtered.filter(t => !t.xfer && (t.ars != null ? +t.ars < 0 : +t.usd < 0)),
    [filtered]
  )

  const totalUSD = useMemo(() => expenseTxs.reduce((s, t) => s + (+t.usd || 0), 0), [expenseTxs])
  const totalARS = useMemo(() => expenseTxs.reduce((s, t) => s + (+t.ars || 0), 0), [expenseTxs])

  const periodMonths = useMemo(
    () => [...new Set(expenseTxs.map(t => t.ym).filter(Boolean))].length || 1,
    [expenseTxs]
  )
  const perMonthUSD = useMemo(() => Math.abs(totalUSD) / periodMonths, [totalUSD, periodMonths])
  const perMonthARS = useMemo(() => Math.abs(totalARS) / periodMonths, [totalARS, periodMonths])

  // Per-group dashboard KPIs
  const dashGroupStats = useMemo(() => {
    const eg = settings?.expense_groups ?? []
    return eg
      .filter(g => g.showOnDash && g.cats?.length)
      .map(g => {
        const catSet = new Set(g.cats)
        const gTxs = expenseTxs.filter(t => catSet.has(t.cat))
        const months = [...new Set(gTxs.map(t => t.ym).filter(Boolean))].length || 1
        const avg = gTxs.length
          ? Math.abs(gTxs.reduce((s, t) => s + (+t.usd || 0), 0)) / months
          : null
        const avgARS = gTxs.length
          ? Math.abs(gTxs.reduce((s, t) => s + (+t.ars || 0), 0)) / months
          : null
        return { id: g.id, name: g.name, avg, avgARS }
      })
  }, [settings, expenseTxs])

  // Stacked monthly chart: top N cats by spend + Otros
  const STACK_N = 8
  const monthlyStackedChart = useMemo(() => {
    const catTotals = {}
    for (const tx of expenseTxs) {
      const cat = tx.cat || 'Sin cat'
      catTotals[cat] = (catTotals[cat] || 0) + Math.abs(tx.usd || 0)
    }
    const topCats = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, STACK_N)
      .map(([cat]) => cat)

    const byMonth = {}
    for (const tx of expenseTxs) {
      if (!tx.ym) continue
      if (!byMonth[tx.ym]) byMonth[tx.ym] = { ym: tx.ym, label: tx.ym }
      const cat = tx.cat || 'Sin cat'
      const key = topCats.includes(cat) ? cat : 'Otros'
      byMonth[tx.ym][key] = (byMonth[tx.ym][key] || 0) + Math.abs(tx.usd || 0)
    }
    const hasOtros = Object.values(byMonth).some(m => m['Otros'] > 0)
    return {
      data: Object.values(byMonth).sort((a, b) => a.ym.localeCompare(b.ym)),
      cats: hasOtros ? [...topCats, 'Otros'] : topCats,
    }
  }, [expenseTxs])

  const catChart = useMemo(() => {
    const grouped = _.groupBy(expenseTxs, 'cat')
    return Object.entries(grouped)
      .map(([cat, rows]) => ({ cat: cat || 'Sin cat', usd: Math.abs(_.sumBy(rows, 'usd')) }))
      .sort((a, b) => b.usd - a.usd).slice(0, 12)
  }, [expenseTxs])

  const totalesData = useMemo(() => {
    const grouped = _.groupBy(filtered.filter(t => !t.xfer), 'cat')
    return Object.entries(grouped)
      .map(([cat, rows]) => ({ cat: cat || 'Sin cat', usd: _.sumBy(rows, 'usd'), ars: _.sumBy(rows, 'ars'), count: rows.length }))
      .sort((a, b) => a.usd - b.usd)
  }, [filtered])

  // Upload
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadMsg({ loading: true, text: 'Procesando archivo…' })
    try {
      const defaultRate = settings?.usd_rate ?? 1050
      const { txs: parsed, count } = await parseXLSX(file, defaultRate)
      const enriched = parsed.map(tx => {
        const rate = blueRates[tx.date] ?? tx.usdRate ?? defaultRate
        return { ...tx, usd_rate: rate, usd: +(tx.ars / rate).toFixed(2) }
      })
      setUploadMsg({ loading: true, text: `Categorizando ${count} transacciones…` })
      const catLog = await loadCatLog({ limit: 1000 })
      const categorized = await categorizeTxs(
        enriched,
        settings,
        catLog,
        session?.access_token,
        (done, total) => setUploadMsg({ loading: true, text: `Categorizando ${done}/${total}…` }),
      )
      setUploadMsg({ loading: true, text: `Subiendo ${count} transacciones…` })
      const { skipped } = await upsertTransactions(categorized)
      const fresh = await loadTransactions()
      setTxs(fresh)
      const skipMsg = skipped.length ? ` (${skipped.length} omitidas — borradas previamente)` : ''
      setUploadMsg({ loading: false, text: `✅ ${count} transacciones importadas${skipMsg}` })
    } catch (err) {
      setUploadMsg({ loading: false, text: `❌ ${err.message}`, error: true })
    }
  }

  const goToMonth = (ym) => {
    if (!ym) return
    const [y, m] = ym.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    setDateFrom(`${ym}-01`)
    setDateTo(`${ym}-${String(last).padStart(2, '0')}`)
    setActiveTab('txs')
    window.location.hash = 'txs'
  }

  const updateCat = async (id, cat) => {
    await updateTransaction(id, { cat, ai_assigned: false })
    setTxs(prev => prev.map(t => t.id === id ? { ...t, cat } : t))
  }
  const updateNote = async (id, notes) => {
    await updateTransaction(id, { notes })
    setTxs(prev => prev.map(t => t.id === id ? { ...t, notes } : t))
  }
  const deleteTx = async (id) => {
    if (!confirm('¿Ocultar esta transacción? (soft delete — no se pierde el historial)')) return
    await softDeleteTransaction(id)
    setTxs(prev => prev.filter(t => t.id !== id))
  }
  const resetFilters = () => {
    setSelYears([]); setDateFrom(''); setDateTo('')
    setCatFs([]); setBankFs([]); setSearch(''); setShowUncatOnly(false)
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#888' }}>Cargando datos…</div>
  if (loadErr) return <div style={{ padding: 32, color: '#c00', fontFamily: 'sans-serif' }}>Error: {loadErr}</div>

  const reviewCount = txs.filter(t => t.needs_review && !t.deleted_at).length
  const uncatCount = txs.filter(isUncat).length

  const TABS = [
    { id: 'dash', label: 'Dashboard' },
    { id: 'txs', label: 'Transacciones' },
    { id: 'revisar', label: `Revisar${reviewCount ? ` (${reviewCount})` : ''}` },
    { id: 'presupuesto', label: 'Presupuesto' },
    { id: 'auditoria', label: 'Historial IA' },
    { id: 'settings', label: '⚙ Config' },
  ]

  return (
    <div style={S.app}>
      <nav style={S.nav}>
        <span style={S.logo}>💸 Gastos</span>
        {TABS.map(t => <button key={t.id} style={S.navBtn(activeTab === t.id)} onClick={() => { setActiveTab(t.id); window.location.hash = t.id }}>{t.label}</button>)}
        <span style={S.spacer} />
        <label style={{ padding: '5px 12px', fontSize: 13, cursor: 'pointer', color: '#ccc', border: '1px solid #555', borderRadius: 6 }}>
          📥 Subir XLSX
          <input type="file" accept=".xlsx" ref={fileRef} onChange={handleUpload} style={{ display: 'none' }} />
        </label>
        <button style={{ ...S.logoutBtn, marginLeft: 8 }} onClick={onLogout}>Salir</button>
      </nav>

      {uploadMsg && (
        <div style={{ padding: '8px 20px', background: uploadMsg.error ? '#fee2e2' : '#d1fae5', color: uploadMsg.error ? '#991b1b' : '#065f46', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{uploadMsg.loading ? '⏳ ' : ''}{uploadMsg.text}</span>
          {!uploadMsg.loading && <button onClick={() => setUploadMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>}
        </div>
      )}

      <div style={S.content}>
        {!['auditoria', 'settings'].includes(activeTab) && (
          <div style={S.filterBar}>
            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Período</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="date" style={{ ...S.input, width: 130 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                <span style={{ fontSize: 12, color: '#aaa' }}>→</span>
                <input type="date" style={{ ...S.input, width: 130 }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
            <MultiSelectFilter label="Año" options={availYears.map(String)} selected={selYears} onChange={setSelYears} />
            <MultiSelectFilter label="Categoría" options={availCats} selected={catFs} onChange={setCatFs} groups={settings?.expense_groups ?? []} />
            <MultiSelectFilter label="Banco" options={BANKS} selected={bankFs} onChange={setBankFs} />
            <div style={{ ...S.filterGroup, flex: 1, minWidth: 180 }}>
              <span style={S.filterLabel}>Buscar</span>
              <input style={{ ...S.input, width: '100%' }} placeholder="descripción, comercio, notas…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div style={{ ...S.filterGroup, justifyContent: 'flex-end' }}>
              <span style={S.filterLabel}>Sin cat</span>
              <button
                style={{ ...S.btnSm(showUncatOnly ? 'active' : 'ghost'), padding: '4px 10px', whiteSpace: 'nowrap' }}
                onClick={() => setShowUncatOnly(s => !s)}
              >
                {showUncatOnly ? '✓ ' : ''}{uncatCount} sin categoría
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button style={S.btnSm()} onClick={resetFilters}>Limpiar</button>
            </div>
          </div>
        )}

        {filterActive && !['auditoria', 'settings'].includes(activeTab) && (
          <div style={{
            background: '#1a1a2e', color: '#fff', borderRadius: 10, padding: '8px 16px',
            marginBottom: 16, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', fontSize: 13,
          }}>
            <span style={{ color: '#888', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {filtered.length} transacciones
            </span>
            {filterSummary.out !== 0 && (
              <span style={{ color: '#ff7675' }}>
                Gastos: <strong>{fmtUSD(filterSummary.out)}</strong>
              </span>
            )}
            {filterSummary.inc !== 0 && (
              <span style={{ color: '#55efc4' }}>
                Ingresos: <strong>{fmtUSD(filterSummary.inc)}</strong>
              </span>
            )}
            {filterSummary.out !== 0 && filterSummary.inc !== 0 && (
              <span style={{ color: '#74b9ff' }}>
                Neto: <strong>{fmtUSD(filterSummary.out + filterSummary.inc)}</strong>
              </span>
            )}
          </div>
        )}

        {activeTab === 'dash' && (
          <DashTab
            expenseTxs={expenseTxs}
            totalUSD={totalUSD} totalARS={totalARS}
            perMonthUSD={perMonthUSD} perMonthARS={perMonthARS}
            periodMonths={periodMonths}
            monthlyStackedChart={monthlyStackedChart}
            catChart={catChart}
            dashGroupStats={dashGroupStats}
            lastTxDate={lastTxDate}
            totalesData={totalesData}
            badge={badge}
            onMonthClick={goToMonth}
          />
        )}
        {activeTab === 'txs' && <TxsTab txs={filtered} onCatChange={updateCat} onNoteChange={updateNote} onDelete={deleteTx} badge={badge} />}
        {activeTab === 'revisar' && <RevisarTab txs={txs} setTxs={setTxs} badge={badge} />}
        {activeTab === 'presupuesto' && <PresupuestoTab settings={settings} setSettings={setSettings} monthlyStackedChart={monthlyStackedChart} />}
        {activeTab === 'auditoria' && <AuditoriaTab badge={badge} />}
        {activeTab === 'settings' && <SettingsTab
          settings={settings}
          onSaveExpenseGroups={async (eg) => { await saveSettings({ expense_groups: eg }); setSettings(s => ({ ...s, expense_groups: eg })) }}
        />}
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const SCATTER_COLORS = ['#e74c3c', '#3498db', '#f39c12', '#27ae60', '#9b59b6', '#1abc9c']

function DashTab({ expenseTxs, totalUSD, totalARS, perMonthUSD, perMonthARS, periodMonths, monthlyStackedChart, catChart, dashGroupStats, lastTxDate, totalesData, badge, onMonthClick }) {
  const [showScatter, setShowScatter] = useState(false)

  const scatterData = useMemo(() => {
    if (!showScatter || expenseTxs.length === 0) return []
    const top5 = _.chain(expenseTxs).groupBy('cat').toPairs()
      .orderBy(([, arr]) => arr.length, 'desc').take(5).map(([cat]) => cat).value()
    return expenseTxs
      .filter(t => t.date && t.usd != null)
      .map(t => ({
        x: new Date(t.date).getTime(),
        y: Math.abs(t.usd),
        colorIdx: top5.indexOf(t.cat ?? ''),
        label: `${t.date} · ${t.merchant || t.cat || '—'} · ${fmtUSD(Math.abs(t.usd))}`,
      }))
  }, [showScatter, expenseTxs])

  const scatterSeries = useMemo(() => {
    if (!showScatter) return []
    const top5 = _.chain(expenseTxs).groupBy('cat').toPairs()
      .orderBy(([, arr]) => arr.length, 'desc').take(5).map(([cat]) => cat).value()
    const groups = {}
    for (const pt of scatterData) {
      const key = pt.colorIdx >= 0 ? top5[pt.colorIdx] : 'Otros'
      if (!groups[key]) groups[key] = []
      groups[key].push(pt)
    }
    return Object.entries(groups).map(([name, data], i) => ({
      name, data,
      color: i < SCATTER_COLORS.length ? SCATTER_COLORS[i] : '#bbb',
    }))
  }, [showScatter, scatterData, expenseTxs])

  return (
    <div>
      {/* KPI pills */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ ...S.card, flex: 1.5, minWidth: 200, textAlign: 'center', marginBottom: 0 }}>
          <div style={{ ...S.statVal, color: '#e67e22' }}>{fmtUSD(perMonthUSD)}</div>
          <div style={S.statSub}>{fmtARS(perMonthARS)} ARS</div>
          <div style={S.statLbl}>Prom/mes · {periodMonths} mes{periodMonths !== 1 ? 'es' : ''}</div>
        </div>
        <div style={{ ...S.card, flex: 1, minWidth: 150, textAlign: 'center', marginBottom: 0 }}>
          <div style={{ ...S.statVal, color: '#1a1a2e' }}>{expenseTxs.length}</div>
          {lastTxDate && <div style={S.statSub}>última: {lastTxDate}</div>}
          <div style={S.statLbl}>Transacciones</div>
        </div>
        {dashGroupStats.map(g => g.avg != null && (
          <div key={g.id} style={{ ...S.card, flex: 1, minWidth: 160, textAlign: 'center', marginBottom: 0 }}>
            <div style={{ ...S.statVal, color: '#8e44ad' }}>{fmtUSD(g.avg)}</div>
            {g.avgARS != null && <div style={S.statSub}>{fmtARS(g.avgARS)} ARS</div>}
            <div style={S.statLbl}>{g.name} / mes</div>
          </div>
        ))}
      </div>

      {/* Stacked monthly bar chart */}
      {monthlyStackedChart.data.length > 0 && (
        <div style={S.card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14, color: '#555' }}>Gastos por mes (USD)</h3>
          <p style={{ margin: '0 0 12px', fontSize: 11, color: '#aaa' }}>Click en una barra para ver las transacciones de ese mes</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyStackedChart.data} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}
              style={{ cursor: 'pointer' }}
              onClick={({ activePayload }) => { if (activePayload?.[0]?.payload?.ym) onMonthClick(activePayload[0].payload.ym) }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
              <Tooltip formatter={(v, name) => [fmtUSD(v), name]} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              {monthlyStackedChart.cats.map(cat => (
                <Bar key={cat} dataKey={cat} stackId="stack" fill={catColor(cat, 0.82)} name={cat} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Horizontal bar + pie side by side */}
      {catChart.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ ...S.card, flex: 2, minWidth: 300, marginBottom: 0 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>Top 12 categorías (USD)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={catChart} layout="vertical" margin={{ top: 4, right: 60, left: 110, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtK} />
                <YAxis type="category" dataKey="cat" tick={{ fontSize: 11 }} width={106} />
                <Tooltip formatter={(v) => fmtUSD(v)} />
                <Bar dataKey="usd" fill="#e67e22" radius={[0, 3, 3, 0]} name="USD" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...S.card, flex: 1, minWidth: 280, marginBottom: 0 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>Distribución por categoría</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={catChart}
                  dataKey="usd"
                  nameKey="cat"
                  cx="50%" cy="50%"
                  outerRadius="65%"
                  label={({ cat, percent }) => percent > 0.04 ? `${cat.split(' ')[0]} ${(percent * 100).toFixed(0)}%` : ''}
                  labelLine={false}
                >
                  {catChart.map((entry) => (
                    <Cell key={entry.cat} fill={catColor(entry.cat, 0.75)} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmtUSD(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Scatter — collapsible */}
      <div style={S.card}>
        <button
          onClick={() => setShowScatter(s => !s)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#555', fontWeight: 600, padding: 0 }}
        >
          {showScatter ? '▼' : '▶'} Scatter de gastos individuales
        </button>
        {showScatter && scatterSeries.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="x" type="number" domain={['auto', 'auto']} scale="time"
                  tick={{ fontSize: 10 }} tickFormatter={v => new Date(v).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })}
                  name="Fecha"
                />
                <YAxis dataKey="y" type="number" tick={{ fontSize: 10 }} tickFormatter={fmtK} name="USD" />
                <ZAxis range={[20, 20]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (!payload?.length) return null
                    const pt = payload[0]?.payload
                    return <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>{pt.label}</div>
                  }}
                />
                <Legend />
                {scatterSeries.map(s => (
                  <Scatter key={s.name} name={s.name} data={s.data} fill={s.color} fillOpacity={0.65} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Totales table — merged in */}
      <div style={S.card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>Por categoría</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Categoría</th>
                <th style={{ ...S.th, textAlign: 'right' }}>USD</th>
                <th style={{ ...S.th, textAlign: 'right' }}>ARS</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Txs</th>
              </tr>
            </thead>
            <tbody>
              {totalesData.map(row => (
                <tr key={row.cat}>
                  <td style={S.td}><span style={badge(row.cat)}>{row.cat}</span></td>
                  <td style={{ ...S.td, textAlign: 'right', ...(row.usd < 0 ? S.negARS : S.posARS) }}>{fmtUSD(row.usd)}</td>
                  <td style={{ ...S.td, textAlign: 'right', ...(row.ars < 0 ? S.negARS : S.posARS) }}>{fmtARS(row.ars)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: '#888' }}>{row.count}</td>
                </tr>
              ))}
              {totalesData.length === 0 && <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', color: '#aaa' }}>Sin datos</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Transacciones ────────────────────────────────────────────────────────────

function TxsTab({ txs, onCatChange, onNoteChange, onDelete, badge }) {
  const [editNote, setEditNote] = useState(null)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' })
  const PAGE = 100

  const sorted = useMemo(() => {
    const { col, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    return [...txs].sort((a, b) => {
      let av = a[col], bv = b[col]
      if (col === 'usd' || col === 'ars') { av = Math.abs(av ?? 0); bv = Math.abs(bv ?? 0) }
      if (av == null) return 1
      if (bv == null) return -1
      return av < bv ? -mul : av > bv ? mul : 0
    })
  }, [txs, sort])

  const visible = sorted.slice(0, page * PAGE)

  const SortTh = ({ col, label, align }) => {
    const active = sort.col === col
    return (
      <th style={{ ...S.th, textAlign: align, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
        onClick={() => { setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' })); setPage(1) }}>
        {label} <span style={{ opacity: active ? 1 : 0.25 }}>{active && sort.dir === 'asc' ? '↑' : '↓'}</span>
      </th>
    )
  }

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: '#555' }}>{txs.length} transacciones</h3>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <SortTh col="date" label="Fecha" />
              <th style={S.th}>Comercio / Descripción</th>
              <SortTh col="bank" label="Banco" />
              <SortTh col="cat" label="Categoría" />
              <SortTh col="ars" label="ARS" align="right" />
              <SortTh col="usd" label="USD" align="right" />
              <th style={S.th}>Notas</th>
              <th style={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(tx => (
              <tr key={tx.id}>
                <td style={{ ...S.td, whiteSpace: 'nowrap', color: '#888', fontSize: 12 }}>{fmtDate(tx.date)}</td>
                <td style={{ ...S.td, maxWidth: 280 }}>
                  {tx.merchant && <div style={{ fontWeight: 600, fontSize: 13 }}>{tx.merchant}</div>}
                  {tx.raw_desc && <div style={{ fontSize: 12, color: tx.merchant ? '#666' : '#1a1a2e', fontWeight: tx.merchant ? 400 : 500, marginTop: tx.merchant ? 2 : 0 }}>{tx.raw_desc}</div>}
                  {tx.referencia && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{tx.referencia}</div>}
                </td>
                <td style={{ ...S.td, fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>{tx.bank || '—'}</td>
                <td style={S.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {tx.ai_assigned && <span title="Categoría asignada automáticamente" style={{ fontSize: 13, lineHeight: 1 }}>🤖</span>}
                    <select value={tx.cat || ''} onChange={e => onCatChange(tx.id, e.target.value)} style={{ ...S.select, maxWidth: 170, fontSize: 12 }}>
                      <option value="">—</option>
                      {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </td>
                <td style={{ ...S.td, textAlign: 'right', ...(tx.ars < 0 ? S.negARS : S.posARS), fontSize: 13 }}>{fmtARS(tx.ars)}</td>
                <td style={{ ...S.td, textAlign: 'right', color: '#555', fontSize: 12 }}>{fmtUSD(tx.usd)}</td>
                <td style={S.td}>
                  {editNote?.id === tx.id ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input style={{ ...S.input, width: 120, fontSize: 12 }} value={editNote.value}
                        onChange={e => setEditNote({ ...editNote, value: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') { onNoteChange(tx.id, editNote.value); setEditNote(null) } if (e.key === 'Escape') setEditNote(null) }}
                        autoFocus />
                      <button style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }} onClick={() => { onNoteChange(tx.id, editNote.value); setEditNote(null) }}>✓</button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: tx.notes ? '#333' : '#bbb', cursor: 'pointer' }} onClick={() => setEditNote({ id: tx.id, value: tx.notes || '' })}>
                      {tx.notes || '+ nota'}
                    </span>
                  )}
                </td>
                <td style={S.td}>
                  <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#e74c3c', fontSize: 16 }} onClick={() => onDelete(tx.id)} title="Eliminar">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length < txs.length && (
        <div style={{ textAlign: 'center', padding: 12 }}>
          <button style={S.btn('secondary')} onClick={() => setPage(p => p + 1)}>
            Ver más ({txs.length - visible.length} restantes)
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Revisar ──────────────────────────────────────────────────────────────────

function RevisarTab({ txs, setTxs, badge }) {
  const queue = txs.filter(t => t.needs_review && !t.deleted_at)

  const confirm = async (tx, cat) => {
    await updateTransaction(tx.id, { cat, needs_review: false, ai_assigned: false })
    setTxs(prev => prev.map(t => t.id === tx.id ? { ...t, cat, needs_review: false } : t))
  }

  if (!queue.length) return (
    <div style={{ ...S.card, textAlign: 'center', padding: 40, color: '#888' }}>
      ✅ Sin transacciones pendientes de revisión.
    </div>
  )

  return (
    <div style={S.card}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>{queue.length} transacciones por revisar</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Fecha</th>
              <th style={S.th}>Comercio / Descripción</th>
              <th style={S.th}>Sugerencia AI</th>
              <th style={{ ...S.th, textAlign: 'right' }}>ARS</th>
              <th style={S.th}>Confirmar / Corregir</th>
            </tr>
          </thead>
          <tbody>
            {queue.map(tx => (
              <tr key={tx.id}>
                <td style={{ ...S.td, color: '#888', fontSize: 12 }}>{fmtDate(tx.date)}</td>
                <td style={{ ...S.td, maxWidth: 280 }}>
                  {tx.merchant && <div style={{ fontWeight: 600, fontSize: 13 }}>{tx.merchant}</div>}
                  {tx.raw_desc && <div style={{ fontSize: 12, color: tx.merchant ? '#666' : '#1a1a2e', fontWeight: tx.merchant ? 400 : 500, marginTop: tx.merchant ? 2 : 0 }}>{tx.raw_desc}</div>}
                  {tx.referencia && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{tx.referencia}</div>}
                </td>
                <td style={S.td}>
                  {tx.cat ? <span style={badge(tx.cat)}>{tx.cat}</span> : <span style={{ color: '#aaa' }}>—</span>}
                  {tx.ai_confidence != null && <span style={{ fontSize: 10, color: '#888', marginLeft: 4 }}>{Math.round(tx.ai_confidence * 100)}%</span>}
                </td>
                <td style={{ ...S.td, textAlign: 'right', ...(tx.ars < 0 ? S.negARS : S.posARS) }}>{fmtARS(tx.ars)}</td>
                <td style={S.td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {tx.cat && <button style={S.btn()} onClick={() => confirm(tx, tx.cat)}>✓ Confirmar</button>}
                    <select defaultValue="" onChange={e => { if (e.target.value) confirm(tx, e.target.value) }} style={{ ...S.select, fontSize: 12 }}>
                      <option value="">Corregir…</option>
                      {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Presupuesto ──────────────────────────────────────────────────────────────

function PresupuestoTab({ settings, setSettings, monthlyStackedChart }) {
  const [editing, setEditing] = useState(false)
  const [budget, setBudget] = useState(settings?.monthly_budget_usd ?? 0)
  const budgetUSD = settings?.monthly_budget_usd ?? 0

  const monthlyTotals = useMemo(() =>
    monthlyStackedChart.data.map(row => ({
      ym: row.ym,
      label: row.label,
      total: monthlyStackedChart.cats.reduce((s, cat) => s + (row[cat] || 0), 0),
    })),
  [monthlyStackedChart])

  const save = async () => {
    const val = parseFloat(budget) || 0
    await saveSettings({ monthly_budget_usd: val })
    setSettings(s => ({ ...s, monthly_budget_usd: val }))
    setEditing(false)
  }

  return (
    <div>
      <div style={{ ...S.card, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Presupuesto mensual (USD)</div>
          {editing ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" value={budget} onChange={e => setBudget(e.target.value)} style={{ ...S.input, width: 120 }} autoFocus />
              <button style={S.btn()} onClick={save}>Guardar</button>
              <button style={S.btn('secondary')} onClick={() => setEditing(false)}>Cancelar</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 26, fontWeight: 700 }}>{budgetUSD ? fmtUSD(budgetUSD) : '—'}</span>
              <button style={S.btn('secondary')} onClick={() => { setBudget(budgetUSD); setEditing(true) }}>Editar</button>
            </div>
          )}
        </div>
      </div>

      {monthlyTotals.length > 0 && (
        <div style={S.card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>Gastos vs presupuesto (USD/mes)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyTotals} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
              <Tooltip formatter={(v) => [fmtUSD(v), 'Gasto']} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="total" name="Gasto"
                fill="#e67e22"
                radius={[3, 3, 0, 0]}
                label={budgetUSD ? { position: 'top', formatter: v => v > budgetUSD ? '⚠' : '', fontSize: 12 } : false}
              />
              {budgetUSD > 0 && (
                <ReferenceLine y={budgetUSD} stroke="#c0392b" strokeDasharray="5 3" strokeWidth={2}
                  label={{ value: `Presupuesto ${fmtUSD(budgetUSD)}`, position: 'insideTopRight', fontSize: 11, fill: '#c0392b' }} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ─── Historial IA ─────────────────────────────────────────────────────────────

function AuditoriaTab({ badge }) {
  const [log, setLog] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { loadCatLog({ limit: 500 }).then(d => { setLog(d); setLoading(false) }) }, [])
  if (loading) return <div style={{ padding: 32, color: '#888' }}>Cargando log…</div>

  return (
    <div style={S.card}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, color: '#555' }}>Historial IA ({log?.length ?? 0} entradas)</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#aaa' }}>
        Registra cada decisión de categorización: asignaciones automáticas, confirmaciones manuales y correcciones.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Fecha</th>
              <th style={S.th}>Tx ID</th>
              <th style={S.th}>Acción</th>
              <th style={S.th}>Categoría</th>
              <th style={S.th}>Confianza</th>
              <th style={S.th}>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {(log || []).map(row => (
              <tr key={row.id}>
                <td style={{ ...S.td, fontSize: 11, color: '#888' }}>{row.created_at?.slice(0, 16)}</td>
                <td style={{ ...S.td, fontSize: 11, color: '#aaa' }}>{row.tx_id}</td>
                <td style={S.td}><span style={badge(row.action)}>{row.action}</span></td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  {row.cat_before && <span style={{ color: '#888' }}>{row.cat_before}</span>}
                  {row.cat_before && row.cat_after && <span style={{ margin: '0 4px' }}>→</span>}
                  {row.cat_after && <strong>{row.cat_after}</strong>}
                  {row.note && <div style={{ fontSize: 11, color: '#aaa' }}>{row.note}</div>}
                </td>
                <td style={{ ...S.td, fontSize: 12, color: '#888' }}>{row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '—'}</td>
                <td style={{ ...S.td, fontSize: 11, color: '#aaa' }}>{row.prompt_tokens != null ? `${row.prompt_tokens}+${row.completion_tokens}` : '—'}</td>
              </tr>
            ))}
            {(!log || !log.length) && <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: '#aaa' }}>Sin entradas aún</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Category Groups ──────────────────────────────────────────────────────────

function CategoryGroupsSection({ expenseGroups, onSave }) {
  const [groups, setGroups] = useState(expenseGroups ?? [])
  const [newName, setNewName] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => { setGroups(expenseGroups ?? []); setDirty(false) }, [expenseGroups])

  const update = (fn) => { setGroups(g => { const next = fn(g); setDirty(true); return next }) }
  const addGroup = () => {
    const name = newName.trim(); if (!name) return
    update(g => [...g, { id: crypto.randomUUID(), name, cats: [], showOnDash: false }])
    setNewName('')
  }
  const removeGroup = (id) => update(g => g.filter(x => x.id !== id))
  const renameGroup = (id, name) => update(g => g.map(x => x.id === id ? { ...x, name } : x))
  const toggleCat = (id, cat) => update(g => g.map(x => x.id === id
    ? { ...x, cats: x.cats.includes(cat) ? x.cats.filter(c => c !== cat) : [...x.cats, cat] }
    : x))
  const toggleDash = (id) => update(g => g.map(x => x.id === id ? { ...x, showOnDash: !x.showOnDash } : x))

  return (
    <div style={S.card}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Grupos de categorías</h3>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>
        Agrupá categorías bajo un nombre. Activá 📊 Dashboard para que ese grupo aparezca como KPI en el panel principal.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input style={{ ...S.input, flex: 1, maxWidth: 280 }} placeholder="Nombre del grupo…"
          value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addGroup()} />
        <button style={S.btn()} onClick={addGroup}>Agregar</button>
      </div>
      {groups.map(g => (
        <div key={g.id} style={{ marginBottom: 12, padding: '10px 14px', background: '#f8f8f8', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input style={{ ...S.input, flex: 1, maxWidth: 240, fontWeight: 600 }} value={g.name}
              onChange={e => renameGroup(g.id, e.target.value)} />
            <span style={{ fontSize: 12, color: '#aaa' }}>{g.cats.length} cats</span>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer',
              padding: '4px 10px', borderRadius: 14,
              border: `1px solid ${g.showOnDash ? '#8e44ad' : '#ddd'}`,
              background: g.showOnDash ? '#f3e8ff' : '#fff',
              color: g.showOnDash ? '#8e44ad' : '#888',
              userSelect: 'none',
            }}>
              <input type="checkbox" checked={!!g.showOnDash} onChange={() => toggleDash(g.id)} style={{ accentColor: '#8e44ad' }} />
              📊 Dashboard
            </label>
            <button style={S.btnSm('danger')} onClick={() => removeGroup(g.id)}>✕</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
            {CATS.map(cat => (
              <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={g.cats.includes(cat)} onChange={() => toggleCat(g.id, cat)} />
                {cat}
              </label>
            ))}
          </div>
        </div>
      ))}
      {!groups.length && <p style={{ color: '#aaa', fontSize: 13 }}>Todavía no hay grupos.</p>}
      {dirty && (
        <button style={{ ...S.btn(), marginTop: 8 }} onClick={() => { onSave(groups); setDirty(false) }}>
          💾 Guardar grupos
        </button>
      )}
    </div>
  )
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsTab({ settings, onSaveExpenseGroups }) {
  return (
    <div>
      <CategoryGroupsSection expenseGroups={settings?.expense_groups ?? []} onSave={onSaveExpenseGroups} />
      <div style={S.card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Tipo de cambio histórico</h3>
        <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
          El tipo de cambio se obtiene automáticamente de Bluelytics (dólar blue) al importar cada archivo.
          Tasa de referencia actual:{' '}
          <strong>ARS {settings?.usd_rate ?? '—'} / USD</strong>
        </p>
      </div>
    </div>
  )
}
