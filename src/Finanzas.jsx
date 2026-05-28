import { useState, useEffect, useMemo, useRef, useContext, createContext } from 'react'
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
  bulkUpdateCat, bulkUpdateByIds, insertTransaction, loadSettings, saveSettings, loadCatLog, loadBlueRates,
} from './db.js'
import { categorizeTxs } from './categorize.js'

const ThemeCtx = createContext(false)
const useTheme = () => useContext(ThemeCtx)

// ─── Constants ───────────────────────────────────────────────────────────────

export const CATS = [
  'Amazon FBA', 'AR taxes', 'Arcos', 'Boat maintenance',
  'Business expense', 'Car maintenance', 'Carhué obra', 'Carhué operacion', 'cash extraction', 'Clothing',
  'contribution to Sol', 'Delta', 'deptos Roca', 'Dining', 'earn out incoming', 'El Dorado', 'Entertainment',
  'Food', 'from Vida', 'Gas', 'Gifts',
  'Healthcare', 'Home utilities',
  'Interbank incoming', 'Interbank outgoing', 'Legal fees', 'Loans given',
  'misc fees', 'Mocoreta', 'Must trace', 'pets',
  'Puente to Santander', 'Roca deptos', 'Shopping', 'sports and exercise',
  'Topozoids', 'transportation', 'Travel', 'Uncategorized Expenses', 'US taxes',
]

const BANKS = ['BofA', 'Cash', 'Chase', 'Citibank', 'Santander', 'Wells Fargo']

const BANK_STYLE = {
  'BofA':        { background: '#e8f0fe', color: '#1a56db' },
  'Cash':        { background: '#e8f5e9', color: '#2e7d32' },
  'Chase':       { background: '#fff3e0', color: '#b45309' },
  'Citibank':    { background: '#e0f2fe', color: '#0369a1' },
  'Santander':   { background: '#fce4ec', color: '#b91c1c' },
  'Wells Fargo': { background: '#fef9c3', color: '#92400e' },
}

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

function makeS(dark) {
  const bg       = dark ? '#0f0f1a' : '#f4f5f7'
  const card     = dark ? '#1a1a2e' : '#fff'
  const border   = dark ? '#2a2a3e' : '#eee'
  const borderSoft = dark ? '#2a2a3e' : '#f0f0f0'
  const text     = dark ? '#e0e0e0' : '#1a1a2e'
  const muted    = dark ? '#8a8aaa' : '#888'
  const inputBg  = dark ? '#12121f' : '#fff'
  const inputBdr = dark ? '#2a2a3e' : '#ddd'
  const shadow   = dark ? '0 1px 6px rgba(0,0,0,.5)' : '0 1px 6px rgba(0,0,0,.08)'
  return {
    app: { fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: bg, color: text },
    nav: { display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px', background: '#1a1a2e', color: '#fff', height: 48, flexWrap: 'wrap' },
    navBtn: (active) => ({
      padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
      background: active ? '#fff' : 'transparent',
      color: active ? '#1a1a2e' : '#ccc', fontWeight: active ? 600 : 400, fontSize: 14,
    }),
    themeBtn: { padding: '4px 10px', border: '1px solid #555', borderRadius: 6, background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 15, lineHeight: 1 },
    logo: { fontWeight: 700, fontSize: 18, marginRight: 8, color: '#fff' },
    spacer: { flex: 1 },
    logoutBtn: { padding: '4px 12px', border: '1px solid #555', borderRadius: 6, background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 13 },
    content: { padding: 16, maxWidth: 1200, margin: '0 auto' },
    card: { background: card, borderRadius: 10, padding: 16, boxShadow: shadow, marginBottom: 16 },
    filterBar: { background: card, borderRadius: 10, padding: '10px 16px', boxShadow: shadow, marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' },
    filterGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
    filterLabel: { fontSize: 11, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '.04em' },
    select: { padding: '4px 8px', border: `1px solid ${inputBdr}`, borderRadius: 6, fontSize: 13, background: inputBg, color: text },
    input:  { padding: '4px 8px', border: `1px solid ${inputBdr}`, borderRadius: 6, fontSize: 13, background: inputBg, color: text },
    statVal: { fontSize: 28, fontWeight: 700, color: text },
    statSub: { fontSize: 12, color: muted, marginTop: 3 },
    statLbl: { fontSize: 12, color: muted, marginTop: 2 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', padding: '8px 10px', borderBottom: `2px solid ${border}`, color: muted, fontWeight: 600, fontSize: 12, textTransform: 'uppercase' },
    td: { padding: '4px 8px', borderBottom: `1px solid ${borderSoft}`, verticalAlign: 'middle', color: text },
    negARS: { color: dark ? '#e05252' : '#c0392b', fontWeight: 500 },
    posARS: { color: '#27ae60', fontWeight: 500 },
    btn: (variant = 'primary') => ({
      padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
      background: variant === 'primary' ? (dark ? '#5555aa' : '#1a1a2e') : (dark ? '#2a2a3e' : '#f0f0f0'),
      color: variant === 'primary' ? '#fff' : (dark ? '#ccc' : '#333'),
    }),
    btnSm: (variant = 'ghost') => ({
      padding: '3px 8px', border: `1px solid ${inputBdr}`, borderRadius: 4, cursor: 'pointer', fontSize: 12,
      background: variant === 'danger' ? (dark ? '#3a1010' : '#fee2e2') : variant === 'active' ? '#1a1a2e' : 'transparent',
      color: variant === 'danger' ? (dark ? '#e05252' : '#c0392b') : variant === 'active' ? '#fff' : (dark ? '#aaa' : '#555'),
      borderColor: variant === 'active' ? '#1a1a2e' : inputBdr,
    }),
  }
}
const S = makeS(false)

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
  const dark = useTheme()
  const S = makeS(dark)
  const inputBg  = dark ? '#12121f' : '#fff'
  const inputBdr = dark ? '#2a2a3e' : '#ddd'
  const text     = dark ? '#e0e0e0' : '#1a1a2e'
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
  const allOptions = options

  return (
    <div style={{ ...S.filterGroup, position: 'relative' }} ref={ref}>
      <span style={S.filterLabel}>{label}</span>
      <button onClick={() => setOpen(o => !o)} style={{
        ...S.select, textAlign: 'left', cursor: 'pointer', minWidth: 130,
        background: selected.length ? '#1a1a2e' : inputBg,
        color: selected.length ? '#fff' : text,
      }}>
        {selected.length === 0 ? `Todos ▾` : `${selected.length} sel. ▾`}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200,
          background: inputBg, border: `1px solid ${inputBdr}`, borderRadius: 8,
          boxShadow: dark ? '0 4px 20px rgba(0,0,0,0.5)' : '0 4px 20px rgba(0,0,0,0.13)', padding: '6px 0',
          minWidth: 220, maxHeight: 340, overflowY: 'auto', color: text,
        }}>
          {selected.length > 0 && (
            <div style={{ padding: '4px 12px 6px', borderBottom: `1px solid ${inputBdr}` }}>
              <button style={{ fontSize: 11, color: '#888', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => onChange([])}>✕ Limpiar</button>
            </div>
          )}
          {groups.length > 0 && <>
            <div style={{ padding: '6px 12px 3px', fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em' }}>Grupos</div>
            {groups.map(g => (
              <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, userSelect: 'none', background: groupSomeSelected(g) ? (dark ? '#2a1a3e' : '#f3e8ff') : 'transparent' }}>
                <input type="checkbox" checked={groupAllSelected(g)}
                  ref={el => { if (el) el.indeterminate = groupSomeSelected(g) && !groupAllSelected(g) }}
                  onChange={() => toggleGroup(g)} />
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>{g.cats.length}</span>
              </label>
            ))}
            <div style={{ margin: '4px 0', borderTop: `1px solid ${inputBdr}` }} />
            <div style={{ padding: '4px 12px 3px', fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em' }}>Categorías</div>
          </>}
          {allOptions.map(opt => (
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
    const valid = ['dash', 'txs', 'revisar', 'auditoria', 'settings', 'ml']
    return valid.includes(hash) ? hash : 'dash'
  })

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '')
      const valid = ['dash', 'txs', 'revisar', 'auditoria', 'settings', 'ml']
      if (valid.includes(hash)) setActiveTab(hash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
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
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [amountCur, setAmountCur] = useState('usd')
  const [dark, setDark] = useState(() => localStorage.getItem('gastos-theme') === 'dark')
  useEffect(() => { localStorage.setItem('gastos-theme', dark ? 'dark' : 'light') }, [dark])
  const S = makeS(dark)

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
    if (amountMin !== '' || amountMax !== '') {
      const val = Math.abs(t[amountCur] ?? 0)
      if (amountMin !== '' && val < parseFloat(amountMin)) return false
      if (amountMax !== '' && val > parseFloat(amountMax)) return false
    }
    return true
  }), [txs, selYears, dateFrom, dateTo, catFs, bankFs, search, showUncatOnly, amountMin, amountMax, amountCur])

  const filterActive = !!(selYears.length || dateFrom || dateTo || catFs.length || bankFs.length || search || showUncatOnly || amountMin !== '' || amountMax !== '')

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
      const cat = (tx.cat && tx.cat !== 'null') ? tx.cat : 'Sin cat'
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
      const cat = (tx.cat && tx.cat !== 'null') ? tx.cat : 'Sin cat'
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
      .map(([cat, rows]) => ({ cat: (cat && cat !== 'null') ? cat : 'Sin cat', usd: Math.abs(_.sumBy(rows, 'usd')) }))
      .sort((a, b) => b.usd - a.usd).slice(0, 12)
  }, [expenseTxs])

  const totalesData = useMemo(() => {
    const grouped = _.groupBy(filtered.filter(t => !t.xfer), 'cat')
    return Object.entries(grouped)
      .map(([cat, rows]) => ({ cat: (cat && cat !== 'null') ? cat : 'Sin cat', usd: _.sumBy(rows, 'usd'), ars: _.sumBy(rows, 'ars'), count: rows.length }))
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
  }

  const goToCat = (cat) => {
    if (!cat) return
    setCatFs([cat])
    setActiveTab('txs')
  }

  const cats = useMemo(
    () => settings?.cats ?? CATS,
    [settings]
  )

  const updateTx = async (id, changes) => {
    await updateTransaction(id, changes)
    setTxs(prev => prev.map(t => t.id === id ? { ...t, ...changes } : t))
  }
  const addTx = async (fields) => {
    const id = await insertTransaction(fields)
    const newRow = { ...fields, id, created_at: new Date().toISOString(), deleted_at: null }
    setTxs(prev => [newRow, ...prev])
  }
  const bulkUpdateTxs = async (ids, fields) => {
    const idSet = new Set(ids)
    await bulkUpdateByIds(ids, fields)
    setTxs(prev => prev.map(t => idSet.has(t.id) ? { ...t, ...fields } : t))
  }
  const deleteTx = async (id) => {
    if (!confirm('¿Ocultar esta transacción? (soft delete — no se pierde el historial)')) return
    await softDeleteTransaction(id)
    setTxs(prev => prev.filter(t => t.id !== id))
  }

  const renameCat = async (oldCat, newCat) => {
    await bulkUpdateCat(oldCat, newCat)
    const newCats = cats.map(c => c === oldCat ? newCat : c)
    await saveSettings({ cats: newCats })
    setSettings(s => ({ ...s, cats: newCats }))
    setTxs(prev => prev.map(t => t.cat === oldCat ? { ...t, cat: newCat } : t))
  }

  const deleteCatFromList = async (cat, reassignTo) => {
    if (reassignTo) await bulkUpdateCat(cat, reassignTo)
    else await bulkUpdateCat(cat, null)
    const newCats = cats.filter(c => c !== cat)
    await saveSettings({ cats: newCats })
    setSettings(s => ({ ...s, cats: newCats }))
    setTxs(prev => prev.map(t => t.cat === cat ? { ...t, cat: reassignTo ?? null } : t))
  }

  const addCat = async (name) => {
    const newCats = [...cats, name].sort((a, b) => a.localeCompare(b))
    await saveSettings({ cats: newCats })
    setSettings(s => ({ ...s, cats: newCats }))
  }

  const resetFilters = () => {
    setSelYears([]); setDateFrom(''); setDateTo('')
    setCatFs([]); setBankFs([]); setSearch(''); setShowUncatOnly(false)
    setAmountMin(''); setAmountMax('')
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#888' }}>Cargando datos…</div>
  if (loadErr) return <div style={{ padding: 32, color: '#c00', fontFamily: 'sans-serif' }}>Error: {loadErr}</div>

  const reviewCount = txs.filter(t => t.needs_review && !t.deleted_at).length
  const uncatCount = txs.filter(isUncat).length

  const TABS = [
    { id: 'dash', label: 'Dashboard' },
    { id: 'txs', label: 'Transacciones' },
    { id: 'revisar', label: `Revisar${reviewCount ? ` (${reviewCount})` : ''}` },
    { id: 'auditoria', label: 'Historial IA' },
    { id: 'ml', label: '📦 ML Import' },
    { id: 'settings', label: '⚙ Config' },
  ]

  return (
    <ThemeCtx.Provider value={dark}>
    <div style={S.app}>
      <nav style={S.nav}>
        <span style={S.logo}>💸 Gastos</span>
        {TABS.map(t => <button key={t.id} style={S.navBtn(activeTab === t.id)} onClick={() => { setActiveTab(t.id); window.location.hash = t.id }}>{t.label}</button>)}
        <span style={S.spacer} />
        <button style={S.themeBtn} onClick={() => setDark(d => !d)} title="Cambiar tema">
          {dark ? '☀️' : '🌙'}
        </button>
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
        {!['auditoria', 'settings', 'ml'].includes(activeTab) && (
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
            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Monto</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <select style={{ ...S.select, padding: '4px 6px', fontWeight: 600 }} value={amountCur} onChange={e => setAmountCur(e.target.value)}>
                  <option value="usd">USD</option>
                  <option value="ars">ARS</option>
                </select>
                <input type="number" style={{ ...S.input, width: 80 }} placeholder="min" value={amountMin} onChange={e => setAmountMin(e.target.value)} />
                <span style={{ fontSize: 12, color: '#aaa' }}>—</span>
                <input type="number" style={{ ...S.input, width: 80 }} placeholder="max" value={amountMax} onChange={e => setAmountMax(e.target.value)} />
              </div>
            </div>
            <div style={{ ...S.filterGroup, flex: 1, minWidth: 180 }}>
              <span style={S.filterLabel}>Buscar</span>
              <input style={{ ...S.input, width: '100%' }} placeholder="descripción, comercio, notas…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div style={{ ...S.filterGroup, justifyContent: 'flex-end' }}>
              <span style={S.filterLabel}>Sin cat</span>
              <button
                style={{ ...S.btnSm(showUncatOnly ? 'active' : 'ghost'), padding: '4px 10px', whiteSpace: 'nowrap' }}
                onClick={() => { if (!showUncatOnly) setCatFs([]); setShowUncatOnly(s => !s) }}
              >
                {showUncatOnly ? '✓ ' : ''}{uncatCount} sin categoría
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button style={S.btnSm()} onClick={resetFilters}>Limpiar</button>
            </div>
          </div>
        )}

        {filterActive && !['auditoria', 'settings', 'ml'].includes(activeTab) && (
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
            onCatClick={goToCat}
          />
        )}
        {activeTab === 'txs' && <TxsTab txs={filtered} onUpdate={updateTx} onDelete={deleteTx} onBulkUpdate={bulkUpdateTxs} onAdd={addTx} badge={badge} cats={cats} />}
        {activeTab === 'revisar' && <RevisarTab txs={txs} setTxs={setTxs} badge={badge} cats={cats} />}
        {activeTab === 'auditoria' && <AuditoriaTab badge={badge} />}
        {activeTab === 'ml' && <MLImportTab onImport={txs => setTxs(prev => [...txs, ...prev])} />}
        {activeTab === 'settings' && <SettingsTab
          settings={settings}
          cats={cats}
          txs={txs}
          onAddCat={addCat}
          onRenameCat={renameCat}
          onDeleteCat={deleteCatFromList}
          onSaveExpenseGroups={async (eg) => { await saveSettings({ expense_groups: eg }); setSettings(s => ({ ...s, expense_groups: eg })) }}
        />}
      </div>
    </div>
    </ThemeCtx.Provider>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const SCATTER_COLORS = ['#e74c3c', '#3498db', '#f39c12', '#27ae60', '#9b59b6', '#1abc9c']

function DashTab({ expenseTxs, totalUSD, totalARS, perMonthUSD, perMonthARS, periodMonths, monthlyStackedChart, catChart, dashGroupStats, lastTxDate, totalesData, badge, onMonthClick, onCatClick }) {
  const dark = useTheme()
  const S = makeS(dark)
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
            <BarChart data={monthlyStackedChart.data} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
              <Tooltip formatter={(v, name) => [fmtUSD(v), name]} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              {monthlyStackedChart.cats.map(cat => (
                <Bar key={cat} dataKey={cat} stackId="stack" fill={catColor(cat, 0.82)} name={cat}
                  style={{ cursor: 'pointer' }}
                  onClick={(data) => { if (data?.ym) onMonthClick(data.ym) }} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Horizontal bar + pie side by side */}
      {catChart.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ ...S.card, flex: 2, minWidth: 300, marginBottom: 0 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, color: '#555' }}>Top 12 categorías (USD)</h3>
            <p style={{ margin: '0 0 8px', fontSize: 11, color: '#aaa' }}>Click para filtrar por categoría</p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={catChart} layout="vertical" margin={{ top: 4, right: 60, left: 110, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtK} />
                <YAxis type="category" dataKey="cat" tick={{ fontSize: 11 }} width={106} />
                <Tooltip formatter={(v) => fmtUSD(v)} />
                <Bar dataKey="usd" radius={[0, 3, 3, 0]} name="USD"
                  style={{ cursor: 'pointer' }}
                  onClick={(data) => { if (data?.cat) onCatClick(data.cat) }}>
                  {catChart.map(entry => <Cell key={entry.cat} fill={catColor(entry.cat, 0.82)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...S.card, flex: 1, minWidth: 280, marginBottom: 0 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, color: '#555' }}>Distribución por categoría</h3>
            <p style={{ margin: '0 0 8px', fontSize: 11, color: '#aaa' }}>Click para filtrar por categoría</p>
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
                    <Cell key={entry.cat} fill={catColor(entry.cat, 0.75)}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onCatClick(entry.cat)} />
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
                  <td style={S.td}><span style={{ ...badge(row.cat), cursor: 'pointer' }} onClick={() => onCatClick(row.cat)}>{row.cat}</span></td>
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

function TxsTab({ txs, onUpdate, onDelete, onBulkUpdate, onAdd, badge, cats }) {
  const dark = useTheme()
  const S = makeS(dark)
  const [editingId, setEditingId] = useState(null)
  const [focusField, setFocusField] = useState(null)
  const [editState, setEditState] = useState({})
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkCat, setBulkCat] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [newTx, setNewTx] = useState({})
  const [saving, setSaving] = useState(false)
  const [bulkApplying, setBulkApplying] = useState(false)
  const rowRefs = useRef({})
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' })
  const PAGE = 100

  const sorted = useMemo(() => {
    const { col, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    return [...txs].sort((a, b) => {
      let av = a[col], bv = b[col]
      if (col === 'usd' || col === 'ars') { av = av ?? 0; bv = bv ?? 0 }
      if (av == null) return 1
      if (bv == null) return -1
      return av < bv ? -mul : av > bv ? mul : 0
    })
  }, [txs, sort])

  const visible = sorted.slice(0, page * PAGE)

  const startEdit = (tx, field = 'merchant') => {
    // Lock the row height before swapping content so it can't jump
    const el = rowRefs.current[tx.id]
    if (el) el.style.height = el.getBoundingClientRect().height + 'px'
    setEditingId(tx.id)
    setFocusField(field)
    setEditState({
      date: tx.date || '',
      merchant: tx.merchant || '',
      raw_desc: tx.raw_desc || '',
      bank: tx.bank || '',
      cat: tx.cat || '',
      ars: tx.ars != null ? tx.ars : '',
      usd: tx.usd != null ? tx.usd : '',
      notes: tx.notes || '',
    })
  }

  const unlockRow = (id) => { const el = rowRefs.current[id]; if (el) el.style.height = '' }
  const cancelEdit = () => { unlockRow(editingId); setEditingId(null); setFocusField(null) }

  const saveEdit = async (tx) => {
    const changes = {}
    const numFields = new Set(['ars', 'usd'])
    for (const f of ['date', 'merchant', 'raw_desc', 'ars', 'usd', 'notes']) {
      const orig = tx[f] != null ? String(tx[f]) : ''
      const next = String(editState[f] ?? '')
      if (next !== orig) {
        changes[f] = numFields.has(f) ? (editState[f] === '' ? null : parseFloat(editState[f])) : (editState[f] || null)
      }
    }
    if (Object.keys(changes).length > 0) await onUpdate(tx.id, changes)
    unlockRow(tx.id)
    setEditingId(null)
    setFocusField(null)
  }

  const set = (field) => (e) => setEditState(s => ({ ...s, [field]: e.target.value }))
  const onEnter = (tx) => (e) => { if (e.key === 'Enter') saveEdit(tx); else if (e.key === 'Escape') cancelEdit() }
  const saveField = async (tx, field, value) => {
    const changes = { [field]: value || null }
    if (field === 'cat') changes.ai_assigned = false
    await onUpdate(tx.id, changes)
    unlockRow(tx.id)
    setEditingId(null); setFocusField(null)
  }
  const clickCell = (tx, field) => (e) => { e.stopPropagation(); if (editingId !== tx.id) startEdit(tx, field) }
  const iStyle = { padding: 0, margin: 0, border: 'none', borderBottom: `1px solid ${dark ? '#3a3a5e' : '#bbb'}`, borderRadius: 0, background: 'transparent', color: 'inherit', width: '100%', outline: 'none', fontFamily: 'inherit', lineHeight: '1.4', height: '1.4em', boxSizing: 'content-box', display: 'block' }

  // ── Bulk selection ─────────────────────────────────────────────────────────
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next
  })
  const allVisibleSelected = visible.length > 0 && visible.every(tx => selectedIds.has(tx.id))
  const someVisibleSelected = visible.some(tx => selectedIds.has(tx.id))
  const selectAllVisible = () => setSelectedIds(prev => { const next = new Set(prev); visible.forEach(tx => next.add(tx.id)); return next })
  const selectAllFiltered = () => setSelectedIds(new Set(txs.map(t => t.id)))
  const clearSelection = () => setSelectedIds(new Set())
  const applyBulkCat = async () => {
    if (!bulkCat || !selectedIds.size) return
    setBulkApplying(true)
    try {
      await onBulkUpdate([...selectedIds], { cat: bulkCat, ai_assigned: false })
      clearSelection(); setBulkCat('')
    } finally { setBulkApplying(false) }
  }

  const SortTh = ({ col, label, align }) => {
    const active = sort.col === col
    return (
      <th style={{ ...S.th, textAlign: align, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
        onClick={() => { setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' })); setPage(1) }}>
        {label} <span style={{ opacity: active ? 1 : 0.25 }}>{active && sort.dir === 'asc' ? '↑' : '↓'}</span>
      </th>
    )
  }

  const cellStyle = (extra) => ({ ...S.td, cursor: 'text', ...extra })

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: '#555' }}>{txs.length} transacciones</h3>
        <span style={{ fontSize: 11, color: '#bbb' }}>click en cualquier campo para editar · Enter para guardar</span>
      </div>

      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 12px', background: dark ? '#1a2040' : '#e8f0fe', borderRadius: 8, flexWrap: 'wrap', border: `1px solid ${dark ? '#2a3a7e' : '#c5d8fc'}` }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: dark ? '#a0c0ff' : '#1a56db' }}>{selectedIds.size} seleccionadas</span>
          <button style={{ ...S.btnSm(), fontSize: 11 }} onClick={clearSelection}>✕ Limpiar</button>
          {selectedIds.size < txs.length && (
            <button style={{ ...S.btnSm(), fontSize: 11 }} onClick={selectAllFiltered}>Seleccionar todas ({txs.length})</button>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: dark ? '#aaa' : '#555' }}>Cambiar categoría:</span>
          <select value={bulkCat} onChange={e => setBulkCat(e.target.value)}
            style={{ ...S.select, fontSize: 12, padding: '3px 8px', background: dark ? '#1a1a2e' : '#fff', color: dark ? '#e0e0e0' : '#1a1a2e' }}>
            <option value="">— elegir —</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button disabled={!bulkCat || bulkApplying}
            style={{ ...S.btn('primary'), padding: '4px 14px', fontSize: 12, opacity: (!bulkCat || bulkApplying) ? 0.5 : 1, cursor: (!bulkCat || bulkApplying) ? 'default' : 'pointer' }}
            onClick={applyBulkCat}>{bulkApplying ? 'Aplicando…' : 'Aplicar'}</button>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 32, paddingRight: 4, paddingLeft: 8 }}>
                <input type="checkbox"
                  checked={allVisibleSelected}
                  ref={el => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected }}
                  onChange={e => e.target.checked ? selectAllVisible() : clearSelection()}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <SortTh col="date" label="Fecha" />
              <th style={S.th}>Comercio / Descripción</th>
              <SortTh col="bank" label="Banco" />
              <SortTh col="cat" label="Categoría" />
              <SortTh col="ars" label="ARS" align="right" />
              <SortTh col="usd" label="USD" align="right" />
              <th style={S.th}>Notas</th>
              <th style={{ ...S.th, width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(tx => {
              const editing = editingId === tx.id
              const bs = BANK_STYLE[tx.bank]
              const selected = selectedIds.has(tx.id)
              return (
                <tr key={tx.id} ref={el => rowRefs.current[tx.id] = el} style={{ background: editing ? (dark ? '#1a1f3a' : '#f0f7ff') : selected ? (dark ? '#121d35' : '#f0f4ff') : undefined }}>

                  <td style={{ ...S.td, width: 32, paddingRight: 4, paddingLeft: 8 }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected} onChange={() => toggleSelect(tx.id)} style={{ cursor: 'pointer' }} />
                  </td>

                  <td style={cellStyle({ whiteSpace: 'nowrap', color: '#888', fontSize: 12 })} onClick={clickCell(tx, 'date')}>
                    {editing
                      ? <input type="text" style={{ ...iStyle, fontSize: 12, width: 100 }} value={editState.date} onChange={set('date')} onKeyDown={onEnter(tx)} autoFocus={focusField === 'date'} placeholder="YYYY-MM-DD" />
                      : fmtDate(tx.date)}
                  </td>

                  <td style={cellStyle({ maxWidth: 320 })} onClick={clickCell(tx, 'merchant')}>
                    {editing ? (<>
                      <input style={{ ...iStyle, fontWeight: 600, fontSize: 13 }} value={editState.merchant} onChange={set('merchant')} onKeyDown={onEnter(tx)} autoFocus={focusField === 'merchant'} />
                      {tx.raw_desc && <div style={{ fontSize: 12, color: dark ? '#8a8aaa' : '#666', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.raw_desc}</div>}
                      {tx.referencia && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.referencia}</div>}
                    </>) : (<>
                      {tx.merchant && <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.merchant}</div>}
                      {tx.raw_desc && <div style={{ fontSize: 12, color: tx.merchant ? (dark ? '#8a8aaa' : '#666') : 'inherit', fontWeight: tx.merchant ? 400 : 500, marginTop: tx.merchant ? 2 : 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.raw_desc}</div>}
                      {tx.referencia && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.referencia}</div>}
                    </>)}
                  </td>

                  <td style={cellStyle({ whiteSpace: 'nowrap' })}>
                    {/* Bank — always a select so row height never changes */}
                    <select
                      value={editing ? editState.bank : (tx.bank || '')}
                      onChange={(e) => saveField(tx, 'bank', e.target.value)}
                      onKeyDown={(e) => e.key === 'Escape' && cancelEdit()}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: 11, fontWeight: 600, borderRadius: 10,
                        padding: '2px 6px', border: 'none', outline: 'none', cursor: 'pointer',
                        ...(tx.bank ? (bs ?? { background: '#f0f0f0', color: '#555' }) : { background: 'transparent', color: dark ? '#666' : '#bbb' }),
                      }}
                    >
                      <option value="">—</option>
                      {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>

                  <td style={cellStyle({ whiteSpace: 'nowrap' })}>
                    {/* Cat — always a select so row height never changes */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {tx.ai_assigned && <span title="Categoría asignada automáticamente" style={{ fontSize: 13, lineHeight: 1 }}>🤖</span>}
                      <select
                        value={editing ? editState.cat : (tx.cat || '')}
                        onChange={(e) => saveField(tx, 'cat', e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && cancelEdit()}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: 11, fontWeight: 500, borderRadius: 10,
                          padding: '2px 6px', border: 'none', outline: 'none', cursor: 'pointer',
                          maxWidth: 170,
                          background: tx.cat ? catColor(tx.cat, 0.15) : (dark ? '#1a1a2e' : 'transparent'),
                          color: tx.cat ? catColor(tx.cat, 0.85) : (dark ? '#555' : '#bbb'),
                        }}
                      >
                        <option value="">—</option>
                        {cats.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </td>

                  <td style={cellStyle({ textAlign: 'right', ...(tx.ars < 0 ? S.negARS : S.posARS), fontSize: 13 })} onClick={clickCell(tx, 'ars')}>
                    {editing
                      ? <input type="number" style={{ ...iStyle, width: 110, textAlign: 'right', fontSize: 13 }} value={editState.ars} onChange={set('ars')} onKeyDown={onEnter(tx)} autoFocus={focusField === 'ars'} />
                      : fmtARS(tx.ars)}
                  </td>

                  <td style={cellStyle({ textAlign: 'right', color: '#555', fontSize: 12 })} onClick={clickCell(tx, 'usd')}>
                    {editing
                      ? <input type="number" style={{ ...iStyle, width: 90, textAlign: 'right', fontSize: 12 }} value={editState.usd} onChange={set('usd')} onKeyDown={onEnter(tx)} autoFocus={focusField === 'usd'} />
                      : fmtUSD(tx.usd)}
                  </td>

                  <td style={cellStyle({})} onClick={clickCell(tx, 'notes')}>
                    {editing
                      ? <input style={{ ...iStyle, fontSize: 12 }} placeholder="notas…" value={editState.notes} onChange={set('notes')} onKeyDown={onEnter(tx)} autoFocus={focusField === 'notes'} />
                      : <span style={{ fontSize: 12, color: tx.notes ? '#333' : '#bbb' }}>{tx.notes || '—'}</span>}
                  </td>

                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {editing ? (
                      <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#e74c3c', fontSize: 15, padding: '0 2px' }}
                        onClick={() => onDelete(tx.id)} title="Eliminar">🗑</button>
                    ) : (
                      <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#bbb', fontSize: 14, padding: '0 4px' }}
                        onClick={(e) => { e.stopPropagation(); startEdit(tx, 'merchant') }} title="Editar">✎</button>
                    )}
                  </td>
                </tr>
              )
            })}
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

function RevisarTab({ txs, setTxs, badge, cats }) {
  const dark = useTheme()
  const S = makeS(dark)
  const queue = txs.filter(t => t.needs_review && !t.deleted_at)

  const confirmTx = async (tx, cat) => {
    await updateTransaction(tx.id, { cat, needs_review: false, ai_assigned: false })
    setTxs(prev => prev.map(t => t.id === tx.id ? { ...t, cat, needs_review: false } : t))
  }

  const deleteTx = async (id) => {
    if (!window.confirm('¿Ocultar esta transacción? (soft delete)')) return
    await softDeleteTransaction(id)
    setTxs(prev => prev.filter(t => t.id !== id))
  }

  const deleteAllEmpty = async () => {
    const empty = queue.filter(t => !t.merchant && !t.raw_desc)
    if (!empty.length) return
    if (!window.confirm(`¿Eliminar ${empty.length} transacciones vacías?`)) return
    for (const t of empty) await softDeleteTransaction(t.id)
    setTxs(prev => prev.filter(t => !empty.find(e => e.id === t.id)))
  }

  const emptyCount = queue.filter(t => !t.merchant && !t.raw_desc).length

  if (!queue.length) return (
    <div style={{ ...S.card, textAlign: 'center', padding: 40, color: '#888' }}>
      ✅ Sin transacciones pendientes de revisión.
    </div>
  )

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14, color: '#555' }}>{queue.length} transacciones por revisar</h3>
        {emptyCount > 0 && (
          <button style={S.btnSm('danger')} onClick={deleteAllEmpty}>
            🗑 Eliminar {emptyCount} vacías
          </button>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Fecha</th>
              <th style={S.th}>Comercio / Descripción</th>
              <th style={S.th}>Sugerencia AI</th>
              <th style={{ ...S.th, textAlign: 'right' }}>ARS</th>
              <th style={S.th}>Confirmar / Corregir</th>
              <th style={{ ...S.th, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {queue.map(tx => (
              <tr key={tx.id}>
                <td style={{ ...S.td, color: '#888', fontSize: 12 }}>{fmtDate(tx.date)}</td>
                <td style={{ ...S.td, maxWidth: 280 }}>
                  {tx.merchant && <div style={{ fontWeight: 600, fontSize: 13 }}>{tx.merchant}</div>}
                  {tx.raw_desc && <div style={{ fontSize: 12, color: tx.merchant ? (dark ? '#8a8aaa' : '#666') : 'inherit', fontWeight: tx.merchant ? 400 : 500, marginTop: tx.merchant ? 2 : 0 }}>{tx.raw_desc}</div>}
                  {tx.referencia && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{tx.referencia}</div>}
                </td>
                <td style={S.td}>
                  {tx.cat ? <span style={badge(tx.cat)}>{tx.cat}</span> : <span style={{ color: '#aaa' }}>—</span>}
                  {tx.ai_confidence != null && <span style={{ fontSize: 10, color: '#888', marginLeft: 4 }}>{Math.round(tx.ai_confidence * 100)}%</span>}
                </td>
                <td style={{ ...S.td, textAlign: 'right', ...(tx.ars < 0 ? S.negARS : S.posARS) }}>{fmtARS(tx.ars)}</td>
                <td style={S.td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {tx.cat && <button style={S.btn()} onClick={() => confirmTx(tx, tx.cat)}>✓ Confirmar</button>}
                    <select defaultValue="" onChange={e => { if (e.target.value) confirmTx(tx, e.target.value) }} style={{ ...S.select, fontSize: 12 }}>
                      <option value="">Corregir…</option>
                      {cats.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </td>
                <td style={S.td}>
                  <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#e74c3c', fontSize: 15, padding: '0 2px' }}
                    onClick={() => deleteTx(tx.id)} title="Eliminar">🗑</button>
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

// ─── Historial IA ─────────────────────────────────────────────────────────────

function AuditoriaTab({ badge }) {
  const dark = useTheme()
  const S = makeS(dark)
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
  const dark = useTheme()
  const S = makeS(dark)
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
        <div key={g.id} style={{ marginBottom: 12, padding: '10px 14px', background: dark ? '#12121f' : '#f8f8f8', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input style={{ ...S.input, flex: 1, maxWidth: 240, fontWeight: 600 }} value={g.name}
              onChange={e => renameGroup(g.id, e.target.value)} />
            <span style={{ fontSize: 12, color: '#aaa' }}>{g.cats.length} cats</span>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer',
              padding: '4px 10px', borderRadius: 14,
              border: `1px solid ${g.showOnDash ? '#8e44ad' : (dark ? '#2a2a3e' : '#ddd')}`,
              background: g.showOnDash ? (dark ? '#2a1a3e' : '#f3e8ff') : (dark ? '#1a1a2e' : '#fff'),
              color: g.showOnDash ? '#a855f7' : '#888',
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

// ─── Category management ──────────────────────────────────────────────────────

function CategoryMgmtSection({ cats, txs, onAddCat, onRenameCat, onDeleteCat }) {
  const dark = useTheme()
  const S = makeS(dark)
  const [open, setOpen] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [renaming, setRenaming] = useState({})
  const [mergeTarget, setMergeTarget] = useState({})
  const [busy, setBusy] = useState(false)

  const catCounts = useMemo(() => {
    const counts = {}
    for (const tx of txs) if (tx.cat) counts[tx.cat] = (counts[tx.cat] || 0) + 1
    return counts
  }, [txs])

  const doAdd = () => {
    const name = newCat.trim()
    if (!name || cats.includes(name)) return
    onAddCat(name)
    setNewCat('')
  }

  const doRename = async (oldCat) => {
    const newName = (renaming[oldCat] || '').trim()
    if (!newName || newName === oldCat) { setRenaming(r => ({ ...r, [oldCat]: undefined })); return }
    setBusy(true)
    await onRenameCat(oldCat, newName)
    setRenaming(r => ({ ...r, [oldCat]: undefined }))
    setBusy(false)
  }

  const doMerge = async (cat) => {
    const target = mergeTarget[cat]
    if (!target || target === cat) return
    if (!confirm(`¿Fusionar "${cat}" en "${target}"? Todas las transacciones de "${cat}" pasarán a "${target}".`)) return
    setBusy(true)
    await onRenameCat(cat, target)
    setMergeTarget(m => ({ ...m, [cat]: undefined }))
    setBusy(false)
  }

  const doDelete = async (cat) => {
    const count = catCounts[cat] || 0
    const msg = count > 0
      ? `"${cat}" tiene ${count} transacciones. ¿Qué hacemos con ellas?`
      : `¿Eliminar la categoría "${cat}"?`
    if (!confirm(msg)) return
    let reassignTo = null
    if (count > 0) {
      reassignTo = prompt(`Mover las ${count} transacciones a (dejar vacío para sin categoría):`) || null
      if (reassignTo !== null && !cats.includes(reassignTo)) { alert('Categoría destino no encontrada.'); return }
    }
    setBusy(true)
    await onDeleteCat(cat, reassignTo)
    setBusy(false)
  }

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Categorías ({cats.length})</h3>
        <span style={{ fontSize: 12, color: '#888' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <>
      <p style={{ fontSize: 13, color: '#888', margin: '8px 0 14px' }}>Agregá, renombrá, fusioná o eliminá categorías. Renombrar y fusionar actualiza todas las transacciones.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input style={{ ...S.input, flex: 1, maxWidth: 280 }} placeholder="Nueva categoría…"
          value={newCat} onChange={e => setNewCat(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doAdd()} />
        <button style={S.btn()} onClick={doAdd}>Agregar</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...S.table, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={S.th}>Categoría</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Txs</th>
              <th style={S.th}>Renombrar</th>
              <th style={S.th}>Fusionar en</th>
              <th style={{ ...S.th, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {cats.map(cat => {
              const currentName = renaming[cat] ?? cat
              const isDirty = renaming[cat] !== undefined && renaming[cat] !== cat
              return (
                <tr key={cat}>
                  <td style={S.td}><span style={badge(cat)}>{cat}</span></td>
                  <td style={{ ...S.td, textAlign: 'right', color: '#888' }}>{catCounts[cat] || 0}</td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input style={{ ...S.input, width: 170, fontSize: 12 }}
                        value={currentName}
                        onChange={e => setRenaming(r => ({ ...r, [cat]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && isDirty && doRename(cat)} />
                      {isDirty && (
                        <button style={{ ...S.btnSm(), background: '#27ae60', color: '#fff', border: 'none', fontWeight: 700 }}
                          disabled={busy} onClick={() => doRename(cat)}>✓</button>
                      )}
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <select style={{ ...S.select, fontSize: 12, maxWidth: 170 }}
                        value={mergeTarget[cat] || ''}
                        onChange={e => setMergeTarget(m => ({ ...m, [cat]: e.target.value }))}>
                        <option value="">— fusionar en —</option>
                        {cats.filter(c => c !== cat).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {mergeTarget[cat] && (
                        <button style={{ ...S.btnSm(), background: '#e67e22', color: '#fff', border: 'none', fontWeight: 700 }}
                          disabled={busy} onClick={() => doMerge(cat)}>→</button>
                      )}
                    </div>
                  </td>
                  <td style={S.td}>
                    <button style={S.btnSm('danger')} disabled={busy} onClick={() => doDelete(cat)}>✕</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  )
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsTab({ settings, cats, txs, onAddCat, onRenameCat, onDeleteCat, onSaveExpenseGroups }) {
  const dark = useTheme()
  const S = makeS(dark)
  return (
    <div>
      <CategoryMgmtSection cats={cats} txs={txs} onAddCat={onAddCat} onRenameCat={onRenameCat} onDeleteCat={onDeleteCat} />
      <CategoryGroupsSection expenseGroups={settings?.expense_groups ?? []} onSave={onSaveExpenseGroups} />
      <div style={S.card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Tipo de cambio</h3>
        <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
          Cada transacción con ARS tiene su tipo de cambio dólar blue almacenado según la fecha exacta (tabla <code>blue_rates</code>).
          Las 1.584 transacciones sin ARS (bancos en USD) mantienen sus valores USD originales.
          Al importar XLSX, la tasa también se asigna por fecha automáticamente.
        </p>
      </div>
    </div>
  )
}

// ─── ML Import ────────────────────────────────────────────────────────────────

const ML_CATS = ['Shopping', 'Mocoreta', 'Carhué obra', 'Arcos', 'El Dorado', 'Delta']

const MONTHS_ES = { enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',
  julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12' }

function parseMLDate(s) {
  const m = (s || '').trim().match(/(\d+)\s+de\s+(\w+)\s+de\s+(\d{4})/i)
  if (!m) return null
  return `${m[3]}-${MONTHS_ES[m[2].toLowerCase()] || '01'}-${m[1].padStart(2, '0')}`
}

function parseMLARS(s) {
  if (!s || s.trim() === '-') return null
  return parseFloat(s.replace(/[$\s.]/g, '').replace(',', '.')) || null
}

const ML_STORAGE_KEY = 'ml_import_rows'

function MLImportTab({ onImport }) {
  const dark = useTheme()
  const S = makeS(dark)
  const [rows, setRows] = useState(() => {
    try { const s = localStorage.getItem(ML_STORAGE_KEY); return s ? JSON.parse(s) : [] }
    catch { return [] }
  })
  const [search, setSearch] = useState('')
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState(null)
  const [bulkCat, setBulkCat] = useState('')
  const fileRef = useRef()

  // Persist rows to localStorage whenever they change
  useEffect(() => {
    try { localStorage.setItem(ML_STORAGE_KEY, JSON.stringify(rows)) }
    catch { /* quota exceeded — ignore */ }
  }, [rows])

  const loadFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const doc = new DOMParser().parseFromString(ev.target.result, 'text/html')
      const trs = doc.querySelectorAll('#tbl tbody tr')
      // Merge with existing stored rows so we don't lose categorizations
      const stored = (() => {
        try { const s = localStorage.getItem(ML_STORAGE_KEY); return s ? JSON.parse(s) : [] }
        catch { return [] }
      })()
      const storedByMlaId = Object.fromEntries(stored.map(r => [r.mlaId, r]))
      const parsed = []
      trs.forEach((tr, i) => {
        const tds = tr.querySelectorAll('td')
        if (tds.length < 10) return
        const imgEl = tds[1].querySelector('img')
        const img = imgEl ? imgEl.src : ''
        const nameEl = tds[2].querySelector('a')
        const name = nameEl ? nameEl.textContent.trim() : tds[2].textContent.trim()
        const link = nameEl ? nameEl.href : ''
        const detail = tds[3].textContent.trim()
        const dateStr = tds[4].textContent.trim()
        const statusEl = tds[5].querySelector('span')
        const isOk = statusEl ? statusEl.classList.contains('ok') : false
        const status = statusEl ? statusEl.textContent.trim() : tds[5].textContent.trim()
        const seller = tds[6].textContent.trim()
        const ars = parseMLARS(tds[7].textContent.trim())
        const mlaId = (tds[10] ? tds[10].textContent.trim() : '').replace('MLA-', '')
        const date = parseMLDate(dateStr)
        const prev = storedByMlaId[mlaId]
        parsed.push({ idx: i, included: prev ? prev.included : isOk, name, detail, dateStr, date, status, isOk, seller, ars, mlaId, link, img, cat: prev ? prev.cat : '' })
      })
      setRows(parsed)
      setMsg({ type: 'ok', text: `${parsed.length} compras cargadas · ${parsed.filter(r => r.cat).length} ya categorizadas` })
    }
    reader.readAsText(file, 'UTF-8')
  }

  const toggle = (idx) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, included: !r.included } : r))
  const setCat = (idx, cat) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, cat } : r))
  const toggleAll = (v) => setRows(prev => prev.map(r => ({ ...r, included: v })))
  const applyBulkCat = () => {
    if (!bulkCat) return
    setRows(prev => prev.map(r => r.included ? { ...r, cat: bulkCat } : r))
    setBulkCat('')
  }
  const clearStorage = () => {
    localStorage.removeItem(ML_STORAGE_KEY)
    setRows([])
    setMsg({ type: 'ok', text: 'Progreso borrado.' })
  }

  const visible = rows.filter(r => {
    const q = search.toLowerCase()
    return !q || r.name.toLowerCase().includes(q) || r.seller.toLowerCase().includes(q)
  })

  const selected = rows.filter(r => r.included)
  const uncat = selected.filter(r => !r.cat).length

  const doImport = async () => {
    const toSend = selected.filter(r => r.date)
    if (!toSend.length) { setMsg({ type: 'err', text: 'Nada seleccionado o sin fecha.' }); return }
    if (uncat) { setMsg({ type: 'err', text: `${uncat} transacciones sin categoría. Asigná antes de importar.` }); return }
    setImporting(true)
    try {
      const txObjs = toSend.map(r => ({
        id: `ml_${r.mlaId}_${(r.date||'').replace(/-/g,'')}`,
        date: r.date,
        merchant: r.name.slice(0, 200),
        raw_desc: `ML: ${r.seller}${r.detail ? ' · ' + r.detail : ''}`,
        bank: 'Santander',
        cat: r.cat || null,
        ars: r.ars != null ? -Math.abs(r.ars) : null,
        usd: null,
        xfer: false,
        ai_assigned: false,
      }))
      const { skipped } = await upsertTransactions(txObjs)
      onImport(txObjs)
      setMsg({ type: 'ok', text: `✅ ${txObjs.length - skipped.length} importadas${skipped.length ? ` · ${skipped.length} ya existían` : ''}.` })
      // Remove imported rows entirely — they live in the main DB now
      const importedMlaIds = new Set(toSend.map(r => r.mlaId))
      setRows(prev => prev.filter(r => !importedMlaIds.has(r.mlaId)))
    } catch (err) {
      setMsg({ type: 'err', text: `Error: ${err.message}` })
    } finally {
      setImporting(false)
    }
  }

  const msgColors = { ok: { bg: dark ? '#1a3a2e' : '#d4edda', color: dark ? '#6fcf97' : '#155724' }, err: { bg: dark ? '#3a1a1a' : '#f8d7da', color: dark ? '#e05252' : '#721c24' } }
  const muted = dark ? '#8a8aaa' : '#888'

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>📦 Importar MercadoLibre</h3>
        <input ref={fileRef} type="file" accept=".html,.htm" onChange={loadFile} style={{ fontSize: 12 }} />
      </div>

      {msg && (
        <div style={{ padding: '7px 12px', borderRadius: 6, marginBottom: 12, fontSize: 12, ...msgColors[msg.type] }}>
          {msg.text}
        </div>
      )}

      {rows.length > 0 && (<>
        {/* Stats + controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}><b>{selected.length}</b> selec. · <b>{rows.filter(r => r.cat).length}</b>/{rows.length} categorizadas</span>
          {uncat > 0 && <span style={{ fontSize: 12, color: '#f5a623', fontWeight: 600 }}>⚠ {uncat} sin cat</span>}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto o vendedor…"
            style={{ ...S.input, fontSize: 12, width: 200 }} />
          <button style={{ ...S.btnSm(), fontSize: 11 }} onClick={() => toggleAll(true)}>☑ Todos</button>
          <button style={{ ...S.btnSm(), fontSize: 11 }} onClick={() => toggleAll(false)}>☐ Ninguno</button>
          {/* Bulk cat */}
          <select value={bulkCat} onChange={e => setBulkCat(e.target.value)}
            style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: `1px solid ${dark ? '#555' : '#ddd'}`,
              background: dark ? '#12121f' : '#fff', color: dark ? '#e0e0e0' : '#1a1a2e' }}>
            <option value="">— asignar categoría a selec. —</option>
            {ML_CATS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button style={{ ...S.btnSm(), fontSize: 11, opacity: bulkCat && selected.length ? 1 : 0.4 }}
            disabled={!bulkCat || !selected.length} onClick={applyBulkCat}>
            Aplicar a {selected.length}
          </button>
          <button style={{ ...S.btn('primary'), padding: '5px 16px', fontSize: 12, marginLeft: 'auto', opacity: importing ? .6 : 1 }}
            disabled={importing} onClick={doImport}>
            {importing ? 'Importando…' : `⬆ Importar ${selected.filter(r => r.date).length}`}
          </button>
          <button style={{ ...S.btnSm(), fontSize: 10, opacity: 0.5 }} onClick={clearStorage} title="Borrar progreso guardado">🗑</button>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ ...S.table, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 28 }}><input type="checkbox" onChange={e => toggleAll(e.target.checked)} /></th>
                <th style={{ ...S.th, width: 58 }}>Foto</th>
                <th style={S.th}>Producto</th>
                <th style={S.th}>Vendedor</th>
                <th style={{ ...S.th, whiteSpace: 'nowrap' }}>Fecha</th>
                <th style={{ ...S.th, textAlign: 'right' }}>ARS $</th>
                <th style={S.th}>Categoría</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={r.idx} style={{ opacity: r.included ? 1 : 0.35, background: r.included ? undefined : 'transparent' }}>
                  <td style={{ ...S.td, width: 28, textAlign: 'center' }}>
                    <input type="checkbox" checked={r.included} onChange={() => toggle(r.idx)} />
                  </td>
                  <td style={{ ...S.td, width: 58, padding: '4px 6px' }}>
                    {r.img
                      ? <img src={r.img} alt="" width={50} height={50}
                          style={{ objectFit: 'cover', borderRadius: 4, display: 'block' }}
                          onError={e => { e.target.style.display = 'none' }} />
                      : null}
                  </td>
                  <td style={{ ...S.td, maxWidth: 300 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 290 }} title={r.name}>
                      {r.link ? <a href={r.link} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{r.name}</a> : r.name}
                    </div>
                    {r.detail && <div style={{ fontSize: 10, color: muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 290 }}>{r.detail}</div>}
                  </td>
                  <td style={{ ...S.td, maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11, color: muted }}>{r.seller}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap', fontSize: 11, color: muted }}>{r.dateStr}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: dark ? '#e05252' : '#c0392b', whiteSpace: 'nowrap' }}>
                    {r.ars != null ? `$ ${r.ars.toLocaleString('es-AR')}` : '—'}
                  </td>
                  <td style={S.td}>
                    <select value={r.cat} onChange={e => setCat(r.idx, e.target.value)}
                      style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: `1px solid ${r.cat ? '#5555aa' : (dark ? '#555' : '#ddd')}`,
                        background: r.cat ? (dark ? '#1a1a3e' : '#eef') : (dark ? '#12121f' : '#fff'),
                        color: dark ? '#e0e0e0' : '#1a1a2e', cursor: 'pointer' }}>
                      <option value="">— categoría —</option>
                      {ML_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  )
}
