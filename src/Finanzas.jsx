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
  bulkUpdateCat, bulkUpdateByIds, loadSettings, saveSettings, loadCatLog, loadBlueRates,
} from './db.js'
import { categorizeTxs } from './categorize.js'
import { detectSourceType, parseStaging, autoMatch } from './stagingParser.js'
import {
  loadStagingSources, importStagingSource, deleteStagingSource,
  loadAllStagingRows, saveDecision, saveAutoMatches, bulkConfirmHighConfidence,
  mergeStagingNew, loadSourceStats,
} from './stagingDb.js'

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
    const valid = ['dash', 'txs', 'revisar', 'auditoria', 'settings', 'forensic']
    return valid.includes(hash) ? hash : 'dash'
  })

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '')
      const valid = ['dash', 'txs', 'revisar', 'auditoria', 'settings', 'forensic']
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
    { id: 'forensic', label: '🔍 Forensic' },
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
        {!['auditoria', 'settings', 'forensic'].includes(activeTab) && (
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

        {filterActive && !['auditoria', 'settings', 'forensic'].includes(activeTab) && (
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
        {activeTab === 'txs' && <TxsTab txs={filtered} onUpdate={updateTx} onDelete={deleteTx} onBulkUpdate={bulkUpdateTxs} badge={badge} cats={cats} />}
        {activeTab === 'revisar' && <RevisarTab txs={txs} setTxs={setTxs} badge={badge} cats={cats} />}
        {activeTab === 'auditoria' && <AuditoriaTab badge={badge} />}
        {activeTab === 'forensic' && <ForensicTab txs={txs} blueRates={blueRates} />}
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

function TxsTab({ txs, onUpdate, onDelete, onBulkUpdate, badge, cats }) {
  const dark = useTheme()
  const S = makeS(dark)
  const [editingId, setEditingId] = useState(null)
  const [focusField, setFocusField] = useState(null)
  const [editState, setEditState] = useState({})
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkCat, setBulkCat] = useState('')
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

// ─── Forensic Tab ─────────────────────────────────────────────────────────────
// Side-by-side review: external source rows vs canonical DB transactions.
// Writes only to staging_* and forensic_links — never touches transactions.

const STATUS_LABELS = {
  unreviewed: { label: 'Sin revisar', color: '#888' },
  pending:    { label: 'Pendiente',   color: '#e67e22' },
  matched:    { label: '✓ Match',     color: '#27ae60' },
  no_match:   { label: '✗ No match', color: '#e74c3c' },
  new:        { label: '+ Nuevo',     color: '#3498db' },
  excluded:   { label: '— Excluir',  color: '#aaa' },
  merged:     { label: '↑ Merged',   color: '#8e44ad' },
}

function ConfidenceBar({ value }) {
  const pct = Math.round((value ?? 0) * 100)
  const color = pct >= 80 ? '#27ae60' : pct >= 50 ? '#e67e22' : '#e74c3c'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 6, background: '#ddd', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 600 }}>{pct}%</span>
    </div>
  )
}

// ─── MatchPicker — inline manual match search ─────────────────────────────────
function MatchPicker({ stagingRow, txs, onSelect, onClose }) {
  const dark = useTheme()
  const S = makeS(dark)
  const muted  = dark ? '#8a8aaa' : '#888'
  const text   = dark ? '#e0e0e0' : '#1a1a2e'
  const inputBg  = dark ? '#12121f' : '#fff'
  const inputBdr = dark ? '#2a2a3e' : '#ddd'
  const hoverBg  = dark ? '#1a2a3a' : '#eff6ff'

  const [search, setSearch] = useState('')
  const inputRef = useRef()
  useEffect(() => { inputRef.current?.focus() }, [])

  const baseDate = useMemo(() => new Date(stagingRow.date + 'T12:00:00'), [stagingRow.date])

  const candidates = useMemo(() => {
    const q = search.toLowerCase().trim()
    const results = txs.filter(tx => {
      if (tx.deleted_at) return false
      const daysDiff = Math.abs((new Date(tx.date + 'T12:00:00') - baseDate) / 86400000)
      if (daysDiff > 14) return false
      if (!q) return true
      return (tx.merchant || '').toLowerCase().includes(q) ||
             (tx.raw_desc  || '').toLowerCase().includes(q)
    })
    results.sort((a, b) =>
      Math.abs(new Date(a.date + 'T12:00:00') - baseDate) -
      Math.abs(new Date(b.date + 'T12:00:00') - baseDate)
    )
    return results.slice(0, 12)
  }, [txs, baseDate, search])

  return (
    <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8,
      background: dark ? '#0f1a2a' : '#f0f7ff',
      border: `1px solid ${dark ? '#2a5a8a' : '#bfdbfe'}` }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: muted, flexShrink: 0 }}>
          Buscar tx ±14 días de {stagingRow.date}:
        </span>
        <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
          placeholder="descripción / merchant…"
          style={{ flex: 1, padding: '4px 8px', borderRadius: 6, fontSize: 12,
            border: `1px solid ${inputBdr}`, background: inputBg, color: text,
            outline: 'none' }} />
        <button onClick={onClose} style={{ ...S.btnSm(), fontSize: 11 }}>✕ Cerrar</button>
      </div>
      {candidates.length === 0 && (
        <div style={{ fontSize: 12, color: muted, padding: '4px 0' }}>
          Sin resultados. Probá ampliar la búsqueda.
        </div>
      )}
      {candidates.map(tx => (
        <div key={tx.id} onClick={() => onSelect(tx)}
          style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 8px',
            borderRadius: 6, cursor: 'pointer', fontSize: 12,
            transition: 'background 0.1s' }}
          onMouseEnter={e => e.currentTarget.style.background = hoverBg}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <span style={{ color: muted, flexShrink: 0, width: 80 }}>{tx.date}</span>
          <span style={{ color: text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tx.merchant || tx.raw_desc || '—'}
          </span>
          <span style={{ flexShrink: 0, color: (tx.usd ?? 0) < 0 ? (dark ? '#e05252' : '#c0392b') : '#27ae60',
            fontWeight: 500 }}>
            {fmtUSD(tx.usd)}
          </span>
          {tx.cat && (
            <span style={{ ...badge(tx.cat), fontSize: 10 }}>{tx.cat}</span>
          )}
        </div>
      ))}
    </div>
  )
}

function ForensicTab({ txs, blueRates = {} }) {
  const dark = useTheme()
  const S = makeS(dark)
  const inputBg  = dark ? '#12121f' : '#fff'
  const inputBdr = dark ? '#2a2a3e' : '#ddd'
  const text     = dark ? '#e0e0e0' : '#1a1a2e'
  const muted    = dark ? '#8a8aaa' : '#888'
  const cardBg   = dark ? '#1a1a2e' : '#fff'
  const subBg    = dark ? '#12121f' : '#f8f8f8'

  // ── State ──────────────────────────────────────────────────────────────────
  const [sources, setSources]         = useState([])
  const [activeSrcId, setActiveSrcId] = useState(null)
  const [allRows, setAllRows]         = useState([])   // all staging rows for active source
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage]               = useState(0)
  const [msg, setMsg]                 = useState(null) // { text, error? }
  const [matching, setMatching]       = useState(false)
  const [importing, setImporting]     = useState(false)
  const [merging, setMerging]         = useState(false)
  const [pickingMatchFor, setPickingMatchFor] = useState(null) // stagingId | null
  const [sourceStats, setSourceStats] = useState({})           // { sourceId: counts }
  const [pendingImport, setPendingImport] = useState(null) // { rows, sourceType, fileName }
  const [importName, setImportName]   = useState('')
  const fileRef = useRef()

  const PAGE_SIZE = 50

  // ── Build txs index (id → tx) for displaying matched main tx ───────────────
  const txIndex = useMemo(() => {
    const m = {}
    for (const tx of txs) m[tx.id] = tx
    return m
  }, [txs])

  // ── Load sources on mount + stats for each ────────────────────────────────
  useEffect(() => {
    loadStagingSources().then(async srcs => {
      setSources(srcs)
      const entries = await Promise.all(srcs.map(async s => [s.id, await loadSourceStats(s.id)]))
      setSourceStats(Object.fromEntries(entries))
    }).catch(e => setMsg({ text: e.message, error: true }))
  }, [])

  // ── Load rows when active source changes ───────────────────────────────────
  useEffect(() => {
    if (!activeSrcId) { setAllRows([]); return }
    setMsg({ text: 'Cargando…' })
    loadAllStagingRows(activeSrcId)
      .then(rows => { setAllRows(rows); setPage(0); setMsg(null) })
      .catch(e => setMsg({ text: e.message, error: true }))
  }, [activeSrcId])

  // ── Filtered + paged rows ─────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    if (statusFilter === 'all') return allRows
    if (statusFilter === 'unreviewed') return allRows.filter(r => !r.link)
    return allRows.filter(r => (r.link?.status ?? 'unreviewed') === statusFilter)
  }, [allRows, statusFilter])

  const pagedRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE)

  // ── Status counts ─────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { all: allRows.length, unreviewed: 0, pending: 0, matched: 0, no_match: 0, new: 0, excluded: 0, merged: 0 }
    for (const r of allRows) {
      const s = r.link?.status ?? 'unreviewed'
      c[s] = (c[s] || 0) + 1
    }
    return c
  }, [allRows])

  // ── File upload / parse ───────────────────────────────────────────────────
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target.result
        const sourceType = detectSourceType(text)
        if (sourceType === 'unknown') {
          setMsg({ text: 'Formato no reconocido. Asegurate de subir un CSV de Mint o Personal Capital.', error: true })
          return
        }
        const rows = parseStaging(text, sourceType)
        const defaultName = file.name.replace(/\.csv$/i, '') +
          (sourceType === 'mint' ? ' (Mint)' : ' (Personal Capital)')
        setPendingImport({ rows, sourceType, fileName: file.name })
        setImportName(defaultName)
        setMsg({ text: `Parseado: ${rows.length} filas desde ${file.name} (${sourceType}). Ingresá un nombre y confirmá.` })
      } catch (err) {
        setMsg({ text: err.message, error: true })
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const confirmImport = async () => {
    if (!pendingImport || !importName.trim()) return
    setImporting(true)
    setMsg({ text: 'Importando…' })
    try {
      const { source } = await importStagingSource({
        name: importName.trim(),
        sourceType: pendingImport.sourceType,
        rows: pendingImport.rows,
      })
      const updated = await loadStagingSources()
      setSources(updated)
      setPendingImport(null)
      setImportName('')
      setActiveSrcId(source.id)
      setMsg({ text: `✓ Importadas ${pendingImport.rows.length} filas. Ejecutá el auto-match para sugerir correspondencias.` })
    } catch (err) {
      setMsg({ text: err.message, error: true })
    } finally {
      setImporting(false)
    }
  }

  // ── Auto-match ────────────────────────────────────────────────────────────
  const runAutoMatch = async () => {
    if (!activeSrcId || !allRows.length) return
    setMatching(true)
    setMsg({ text: `Calculando correspondencias para ${allRows.length} filas…` })
    try {
      const matches = autoMatch(allRows, txs)
      await saveAutoMatches(matches)
      // Reload rows to get updated links
      const refreshed = await loadAllStagingRows(activeSrcId)
      setAllRows(refreshed)
      setMsg({ text: `✓ Auto-match completo: ${matches.length} filas con candidato.` })
    } catch (err) {
      setMsg({ text: err.message, error: true })
    } finally {
      setMatching(false)
    }
  }

  // ── Bulk confirm high-confidence ──────────────────────────────────────────
  const runBulkConfirm = async () => {
    if (!activeSrcId) return
    setMsg({ text: 'Confirmando matches con ≥80% confianza…' })
    try {
      const n = await bulkConfirmHighConfidence(activeSrcId, 0.80)
      const refreshed = await loadAllStagingRows(activeSrcId)
      setAllRows(refreshed)
      setMsg({ text: `✓ ${n} filas confirmadas como "matched".` })
    } catch (err) {
      setMsg({ text: err.message, error: true })
    }
  }

  // ── Merge 'new' rows into transactions ───────────────────────────────────
  const runMerge = async () => {
    const newRows = allRows.filter(r => r.link?.status === 'new')
    if (!newRows.length) return
    const src = sources.find(s => s.id === activeSrcId)
    if (!confirm(`¿Insertar ${newRows.length} transacciones en el DB principal?`)) return
    setMerging(true)
    setMsg({ text: `Insertando ${newRows.length} transacciones…` })
    try {
      const n = await mergeStagingNew(newRows, src?.source_type ?? 'unknown', blueRates)
      const refreshed = await loadAllStagingRows(activeSrcId)
      setAllRows(refreshed)
      setMsg({ text: `✓ ${n} transacciones insertadas. Recargá la página para verlas en Transacciones.` })
    } catch (err) {
      setMsg({ text: err.message, error: true })
    } finally {
      setMerging(false)
    }
  }

  // ── Per-row decision ──────────────────────────────────────────────────────
  const decide = async (stagingId, status, mainId = null) => {
    try {
      await saveDecision(stagingId, { mainId, status })
      setAllRows(prev => prev.map(r =>
        r.id === stagingId
          ? { ...r, link: { ...(r.link ?? {}), staging_id: stagingId, status, main_id: mainId, auto_match: false, decided_at: new Date().toISOString() } }
          : r
      ))
      setPickingMatchFor(null)
    } catch (err) {
      setMsg({ text: err.message, error: true })
    }
  }

  const deleteSource = async (srcId) => {
    if (!confirm('¿Eliminar esta fuente y todas sus filas?')) return
    try {
      await deleteStagingSource(srcId)
      setSources(s => s.filter(x => x.id !== srcId))
      if (activeSrcId === srcId) { setActiveSrcId(null); setAllRows([]) }
    } catch (err) {
      setMsg({ text: err.message, error: true })
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const SOURCE_TYPE_LABEL = { mint: 'Mint', personal_capital: 'Personal Capital', betterment: 'Betterment', ibkr: 'IBKR' }

  return (
    <div>
      {/* Message banner */}
      {msg && (
        <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 8, fontSize: 13,
          background: msg.error ? (dark ? '#3a1010' : '#fee2e2') : (dark ? '#0f2a1a' : '#d1fae5'),
          color: msg.error ? (dark ? '#e05252' : '#991b1b') : (dark ? '#52e09a' : '#065f46'),
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit', marginLeft: 12 }}>×</button>
        </div>
      )}

      {/* Source list */}
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>🔍 Fuentes forenses</h3>
          <label style={{ padding: '5px 12px', fontSize: 13, cursor: 'pointer', color: '#fff',
            background: '#1a1a2e', border: 'none', borderRadius: 6, display: 'inline-block' }}>
            + Importar CSV
            <input type="file" accept=".csv" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
          </label>
        </div>

        {/* Pending import confirmation */}
        {pendingImport && (
          <div style={{ padding: '12px 14px', background: dark ? '#1a2a3a' : '#eff6ff', borderRadius: 8, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: dark ? '#74b9ff' : '#1e40af', fontWeight: 600 }}>
              {pendingImport.rows.length} filas listas para importar
            </span>
            <input style={{ ...S.input, flex: 1, minWidth: 200 }}
              placeholder="Nombre de la fuente…" value={importName}
              onChange={e => setImportName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmImport()} />
            <button style={S.btn('primary')} onClick={confirmImport} disabled={importing || !importName.trim()}>
              {importing ? 'Importando…' : '✓ Confirmar'}
            </button>
            <button style={S.btnSm()} onClick={() => { setPendingImport(null); setImportName(''); setMsg(null) }}>Cancelar</button>
          </div>
        )}

        {sources.length === 0 && !pendingImport && (
          <p style={{ color: muted, fontSize: 13, margin: 0 }}>
            No hay fuentes importadas. Subí un CSV de Mint o Personal Capital para empezar.
          </p>
        )}

        {sources.map(src => {
          const active = src.id === activeSrcId
          return (
            <div key={src.id} onClick={() => setActiveSrcId(src.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderRadius: 8, marginBottom: 6, cursor: 'pointer',
                background: active ? (dark ? '#1a2a3a' : '#eff6ff') : subBg,
                border: `1px solid ${active ? (dark ? '#2a5a8a' : '#bfdbfe') : inputBdr}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: text }}>{src.name}</div>
                <div style={{ fontSize: 11, color: muted }}>
                  {SOURCE_TYPE_LABEL[src.source_type] ?? src.source_type} · {src.row_count?.toLocaleString()} filas · {src.date_from} → {src.date_to}
                </div>
                {(() => {
                  const st = active ? counts : (sourceStats[src.id] ?? null)
                  if (!st) return null
                  const pills = [
                    { key: 'matched',  label: '✓', color: '#27ae60' },
                    { key: 'new',      label: '+',  color: '#3498db' },
                    { key: 'merged',   label: '↑',  color: '#8e44ad' },
                    { key: 'pending',  label: '⏳', color: '#e67e22' },
                    { key: 'no_match', label: '✗',  color: '#e74c3c' },
                    { key: 'excluded', label: '—',  color: '#aaa'    },
                  ].filter(p => (st[p.key] ?? 0) > 0)
                  if (!pills.length) return null
                  return (
                    <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                      {pills.map(p => (
                        <span key={p.key} style={{ fontSize: 10, fontWeight: 700,
                          padding: '1px 5px', borderRadius: 6,
                          background: p.color + '22', color: p.color }}>
                          {p.label} {st[p.key]}
                        </span>
                      ))}
                      {(st.unreviewed ?? 0) > 0 && (
                        <span style={{ fontSize: 10, color: muted }}>
                          {st.unreviewed} sin revisar
                        </span>
                      )}
                    </div>
                  )
                })()}
              </div>
              <button style={S.btnSm('danger')} onClick={e => { e.stopPropagation(); deleteSource(src.id) }}>✕</button>
            </div>
          )
        })}
      </div>

      {/* Review panel */}
      {activeSrcId && (
        <div style={S.card}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 14, color: muted }}>
              {sources.find(s => s.id === activeSrcId)?.name}
            </h3>
            <span style={{ flex: 1 }} />
            <button style={{ ...S.btn('secondary'), fontSize: 12 }}
              onClick={runAutoMatch} disabled={matching || !allRows.length}>
              {matching ? '⏳ Calculando…' : '🔗 Auto-match'}
            </button>
            <button style={{ ...S.btn('secondary'), fontSize: 12 }}
              onClick={runBulkConfirm} disabled={counts.pending === 0}>
              ✓ Confirmar ≥80% ({counts.pending} pendientes)
            </button>
            {counts.new > 0 && (
              <button style={{ ...S.btn('primary'), fontSize: 12 }}
                onClick={runMerge} disabled={merging}>
                {merging ? '⏳ Insertando…' : `↑ Merge ${counts.new} nuevas`}
              </button>
            )}
          </div>

          {/* Status filter tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              ['all',        `Todas (${counts.all})`],
              ['unreviewed', `Sin revisar (${counts.unreviewed})`],
              ['pending',    `Pendiente (${counts.pending})`],
              ['matched',    `✓ Match (${counts.matched})`],
              ['no_match',   `✗ No match (${counts.no_match})`],
              ['new',        `+ Nuevo (${counts.new})`],
              ['excluded',   `Excluir (${counts.excluded})`],
              ['merged',     `↑ Merged (${counts.merged ?? 0})`],
            ].map(([key, label]) => (
              <button key={key}
                style={{ ...S.btnSm(statusFilter === key ? 'active' : 'ghost'), fontSize: 12 }}
                onClick={() => { setStatusFilter(key); setPage(0) }}>
                {label}
              </button>
            ))}
          </div>

          {/* Row count */}
          <div style={{ fontSize: 12, color: muted, marginBottom: 10 }}>
            {filteredRows.length} filas · página {page + 1}/{totalPages || 1}
          </div>

          {/* Review rows */}
          {pagedRows.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: muted }}>
              {allRows.length === 0 ? 'Cargando…' : 'Sin filas en este filtro.'}
            </div>
          )}

          {pagedRows.map(row => {
            const link    = row.link
            const status  = link?.status ?? 'unreviewed'
            const matchedTx = link?.main_id ? txIndex[link.main_id] : null
            const sl = STATUS_LABELS[status] ?? STATUS_LABELS.unreviewed

            return (
              <div key={row.id} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, padding: '10px 12px',
                borderRadius: pickingMatchFor === row.id ? '8px 8px 0 0' : 8,
                border: `1px solid ${inputBdr}`,
                borderBottom: pickingMatchFor === row.id ? 'none' : undefined,
                background: status === 'matched' ? (dark ? '#0f2a1a' : '#f0fdf4')
                  : status === 'excluded'        ? (dark ? '#1a1a1a' : '#fafafa')
                  : status === 'new'             ? (dark ? '#0f1a2a' : '#eff6ff')
                  : subBg }}>

                {/* Status pill */}
                <div style={{ width: 80, flexShrink: 0, paddingTop: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
                    background: sl.color + '22', color: sl.color }}>
                    {sl.label}
                  </span>
                  {link?.confidence != null && (
                    <div style={{ marginTop: 4 }}>
                      <ConfidenceBar value={link.confidence} />
                    </div>
                  )}
                </div>

                {/* Source (Mint) panel */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: muted, marginBottom: 2 }}>
                    {row.date} · <span style={{ fontStyle: 'italic' }}>{row.account}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.description || '—'}
                  </div>
                  {row.orig_description && row.orig_description !== row.description && (
                    <div style={{ fontSize: 11, color: muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      orig: {row.orig_description}
                    </div>
                  )}
                  <div style={{ fontSize: 12, marginTop: 2, color: row.amount < 0 ? (dark ? '#e05252' : '#c0392b') : '#27ae60', fontWeight: 500 }}>
                    {row.amount < 0 ? '−' : '+'}{fmtUSD(Math.abs(row.amount))}
                    {row.category && <span style={{ fontWeight: 400, color: muted, marginLeft: 6 }}>{row.category}</span>}
                  </div>
                </div>

                {/* Arrow */}
                <div style={{ display: 'flex', alignItems: 'center', color: muted, fontSize: 18, flexShrink: 0 }}>↔</div>

                {/* Matched main tx panel */}
                <div style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${inputBdr}`, paddingLeft: 10 }}>
                  {matchedTx ? (<>
                    <div style={{ fontSize: 11, color: muted, marginBottom: 2 }}>
                      {matchedTx.date} · <span style={{ padding: '1px 5px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                        ...((BANK_STYLE[matchedTx.bank]) ?? { background: '#eee', color: '#555' }) }}>
                        {matchedTx.bank}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {matchedTx.merchant || matchedTx.raw_desc || '—'}
                    </div>
                    {matchedTx.merchant && matchedTx.raw_desc && (
                      <div style={{ fontSize: 11, color: muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {matchedTx.raw_desc}
                      </div>
                    )}
                    <div style={{ fontSize: 12, marginTop: 2, color: (matchedTx.usd ?? 0) < 0 ? (dark ? '#e05252' : '#c0392b') : '#27ae60', fontWeight: 500 }}>
                      {fmtUSD(matchedTx.usd)}
                      {matchedTx.cat && <span style={{ ...badge(matchedTx.cat), marginLeft: 6 }}>{matchedTx.cat}</span>}
                    </div>
                  </>) : (
                    <div style={{ color: muted, fontSize: 12, paddingTop: 6 }}>
                      {link?.status === 'new'      ? '📥 Marcar como nueva transacción' :
                       link?.status === 'excluded' ? '—' :
                       '(sin correspondencia sugerida)'}
                    </div>
                  )}
                </div>

                {/* Decision buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, justifyContent: 'center' }}>
                  <button title="Match — corresponde a la tx del DB"
                    style={{ ...S.btnSm(status === 'matched' ? 'active' : 'ghost'), fontSize: 11, whiteSpace: 'nowrap' }}
                    onClick={() => link?.main_id
                      ? decide(row.id, 'matched', link.main_id)
                      : setPickingMatchFor(pickingMatchFor === row.id ? null : row.id)}>
                    ✓ Match
                  </button>
                  <button title="Elegir manualmente la tx correspondiente"
                    style={{ ...S.btnSm(pickingMatchFor === row.id ? 'active' : 'ghost'), fontSize: 11, whiteSpace: 'nowrap' }}
                    onClick={() => setPickingMatchFor(pickingMatchFor === row.id ? null : row.id)}>
                    🔍 Pick
                  </button>
                  <button title="No hay correspondencia en el DB"
                    style={{ ...S.btnSm(status === 'no_match' ? 'active' : 'ghost'), fontSize: 11, whiteSpace: 'nowrap' }}
                    onClick={() => decide(row.id, 'no_match')}>
                    ✗ No match
                  </button>
                  <button title="Transacción nueva no presente en el DB"
                    style={{ ...S.btnSm(status === 'new' ? 'active' : 'ghost'), fontSize: 11, whiteSpace: 'nowrap' }}
                    onClick={() => decide(row.id, 'new')}>
                    + Nuevo
                  </button>
                  <button title="Ignorar (ruido, duplicado, no relevante)"
                    style={{ ...S.btnSm(status === 'excluded' ? 'danger' : 'ghost'), fontSize: 11, whiteSpace: 'nowrap' }}
                    onClick={() => decide(row.id, 'excluded')}>
                    — Excluir
                  </button>
                </div>
              </div>
              {pickingMatchFor === row.id && (
                <MatchPicker
                  stagingRow={row}
                  txs={txs}
                  onSelect={tx => decide(row.id, 'matched', tx.id)}
                  onClose={() => setPickingMatchFor(null)}
                />
              )}
              </div>
            )
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <button style={S.btnSm()} disabled={page === 0} onClick={() => setPage(0)}>«</button>
              <button style={S.btnSm()} disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
              <span style={{ fontSize: 13, color: muted, padding: '3px 10px' }}>
                {page + 1} / {totalPages}
              </span>
              <button style={S.btnSm()} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>›</button>
              <button style={S.btnSm()} disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
