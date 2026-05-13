import { useState, useEffect, useMemo, useRef } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend, CartesianGrid,
  ScatterChart, Scatter, ZAxis,
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
  'Mocoreta', 'Must trace', 'Personal', 'pets', 'Proyectos',
  'Puente to Santander', 'Roca deptos', 'Shopping', 'sports and exercise',
  'Topozoids', 'transportation', 'Travel', 'Uncategorized Expenses', 'US taxes',
]

const BANKS = ['Alina ML', 'Cash', 'Chase', 'Citibank', 'Santander']

// ─── Formatting helpers ───────────────────────────────────────────────────────

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
    background: variant === 'danger' ? '#fee2e2' : 'transparent',
    color: variant === 'danger' ? '#c0392b' : '#555',
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

// ─── Year checkbox group ──────────────────────────────────────────────────────

function YearFilter({ years, selected, onChange }) {
  return (
    <div style={S.filterGroup}>
      <span style={S.filterLabel}>Año</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {years.map(y => (
          <label key={y} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={selected.includes(y)}
              onChange={e => onChange(e.target.checked ? [...selected, y] : selected.filter(x => x !== y))}
            />
            {y}
          </label>
        ))}
        {selected.length > 0 && (
          <button onClick={() => onChange([])} style={{ ...S.btnSm(), fontSize: 11, padding: '1px 6px' }}>×</button>
        )}
      </div>
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
  const [activeTab, setActiveTab] = useState('dash')
  const [uploadMsg, setUploadMsg] = useState(null)
  const fileRef = useRef()

  // Filters
  const [selYears, setSelYears] = useState([])
  const [selYm, setSelYm] = useState('')
  const [xferMode, setXferMode] = useState('sin') // 'sin'|'solo'|'all'
  const [catF, setCatF] = useState('all')
  const [bankF, setBankF] = useState('all')
  const [groupF, setGroupF] = useState('all')
  const [search, setSearch] = useState('')

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
    () => [...new Set(txs.map(t => t.year).filter(Boolean))].sort((a, b) => b - a),
    [txs]
  )
  const availYms = useMemo(() => {
    const base = selYears.length ? txs.filter(t => selYears.includes(t.year)) : txs
    return [...new Set(base.map(t => t.ym).filter(Boolean))].sort().reverse()
  }, [txs, selYears])

  const groups = settings?.groups ?? []

  const filtered = useMemo(() => txs.filter(t => {
    if (selYears.length && !selYears.includes(t.year)) return false
    if (selYm && t.ym !== selYm) return false
    if (xferMode === 'sin' && t.xfer) return false
    if (xferMode === 'solo' && !t.xfer) return false
    if (catF !== 'all' && t.cat !== catF) return false
    if (bankF !== 'all' && t.bank !== bankF) return false
    if (groupF === 'none' && t.group_id) return false
    if (groupF !== 'all' && groupF !== 'none' && t.group_id !== groupF) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(t.raw_desc?.toLowerCase().includes(q) || t.merchant?.toLowerCase().includes(q) ||
            t.cat?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q))) return false
    }
    return true
  }), [txs, selYears, selYm, xferMode, catF, bankF, groupF, search])

  // Expense KPIs always exclude transfers regardless of xferMode
  // ars may be null for USD-only banks (e.g. Citibank) -- fall back to usd sign
  const expenseTxs = useMemo(() => filtered.filter(t => !t.xfer && (t.ars != null ? +t.ars < 0 : +t.usd < 0)), [filtered])
  const totalUSD = useMemo(() => expenseTxs.reduce((s, t) => s + (+t.usd || 0), 0), [expenseTxs])
  const totalARS = useMemo(() => expenseTxs.reduce((s, t) => s + (+t.ars || 0), 0), [expenseTxs])
  // Monthly expense KPI — categories defined by expense_groups in settings
  const expenseGroupCats = useMemo(() => {
    const eg = settings?.expense_groups ?? []
    return new Set(eg.flatMap(g => g.cats ?? []))
  }, [settings])
  const monthlyExpenseTxs = useMemo(
    () => expenseTxs.filter(t => expenseGroupCats.has(t.cat)),
    [expenseTxs, expenseGroupCats]
  )
  const monthlyExpenseAvg = useMemo(() => {
    if (!monthlyExpenseTxs.length) return null
    const months = [...new Set(monthlyExpenseTxs.map(t => t.ym).filter(Boolean))].length || 1
    return Math.abs(monthlyExpenseTxs.reduce((s, t) => s + (+t.usd || 0), 0)) / months
  }, [monthlyExpenseTxs])

  const periodMonths = useMemo(() => {
    if (selYm) return 1
    return [...new Set(expenseTxs.map(t => t.ym).filter(Boolean))].length || 1
  }, [expenseTxs, selYm])
  const perMonthUSD = useMemo(() => Math.abs(totalUSD) / periodMonths, [totalUSD, periodMonths])

  const monthlyChart = useMemo(() => {
    const grouped = _.groupBy(expenseTxs, 'ym')
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, rows]) => ({ ym, label: ym.slice(0, 7), usd: Math.abs(_.sumBy(rows, 'usd')) }))
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
  const updateGroup = async (id, gid) => {
    await updateTransaction(id, { group_id: gid || null })
    setTxs(prev => prev.map(t => t.id === id ? { ...t, group_id: gid || null } : t))
  }
  const addGroup = async (name) => {
    const ng = [...groups, { id: crypto.randomUUID(), name, categories: [] }]
    await saveSettings({ groups: ng }); setSettings(s => ({ ...s, groups: ng }))
  }
  const renameGroup = async (id, name) => {
    const ng = groups.map(g => g.id === id ? { ...g, name } : g)
    await saveSettings({ groups: ng }); setSettings(s => ({ ...s, groups: ng }))
  }
  const deleteGroup = async (id) => {
    if (!confirm('¿Eliminar este grupo?')) return
    const ng = groups.filter(g => g.id !== id)
    await saveSettings({ groups: ng }); setSettings(s => ({ ...s, groups: ng }))
    const affected = txs.filter(t => t.group_id === id)
    await Promise.all(affected.map(t => updateTransaction(t.id, { group_id: null })))
    setTxs(prev => prev.map(t => t.group_id === id ? { ...t, group_id: null } : t))
  }

  const resetFilters = () => { setSelYears([]); setSelYm(''); setXferMode('sin'); setCatF('all'); setBankF('all'); setGroupF('all'); setSearch('') }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#888' }}>Cargando datos…</div>
  if (loadErr) return <div style={{ padding: 32, color: '#c00', fontFamily: 'sans-serif' }}>Error: {loadErr}</div>

  const reviewCount = txs.filter(t => t.needs_review && !t.deleted_at).length
  const TABS = [
    { id: 'dash', label: 'Dashboard' },
    { id: 'totales', label: 'Totales' },
    { id: 'txs', label: 'Transacciones' },
    { id: 'revisar', label: `Revisar${reviewCount ? ` (${reviewCount})` : ''}` },
    { id: 'presupuesto', label: 'Presupuesto' },
    { id: 'auditoria', label: 'Auditoría' },
    { id: 'settings', label: '⚙ Config' },
  ]

  return (
    <div style={S.app}>
      <nav style={S.nav}>
        <span style={S.logo}>💸 Gastos</span>
        {TABS.map(t => <button key={t.id} style={S.navBtn(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>{t.label}</button>)}
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
        {/* Filter bar — hidden on audit + settings */}
        {!['auditoria', 'settings'].includes(activeTab) && (
          <div style={S.filterBar}>
            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Período</span>
              <select style={S.select} value={selYm} onChange={e => setSelYm(e.target.value)}>
                <option value="">Todos los meses</option>
                {availYms.map(ym => <option key={ym} value={ym}>{ym}</option>)}
              </select>
            </div>
            <YearFilter years={availYears} selected={selYears} onChange={setSelYears} />
            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Transferencias</span>
              <select style={S.select} value={xferMode} onChange={e => setXferMode(e.target.value)}>
                <option value="sin">Sin transferencias</option>
                <option value="all">Todas</option>
                <option value="solo">Solo transferencias</option>
              </select>
            </div>
            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Categoría</span>
              <select style={S.select} value={catF} onChange={e => setCatF(e.target.value)}>
                <option value="all">Todas</option>
                {CATS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Grupo</span>
              <select style={S.select} value={groupF} onChange={e => setGroupF(e.target.value)}>
                <option value="all">Todos</option>
                <option value="none">Sin grupo</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div style={S.filterGroup}>
              <span style={S.filterLabel}>Banco</span>
              <select style={S.select} value={bankF} onChange={e => setBankF(e.target.value)}>
                <option value="all">Todos</option>
                {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div style={{ ...S.filterGroup, flex: 1, minWidth: 180 }}>
              <span style={S.filterLabel}>Buscar</span>
              <input style={{ ...S.input, width: '100%' }} placeholder="descripción, comercio, notas…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button style={S.btnSm()} onClick={resetFilters}>Limpiar</button>
            </div>
          </div>
        )}

        {activeTab === 'dash' && <DashTab expenseTxs={expenseTxs} totalUSD={totalUSD} totalARS={totalARS} perMonthUSD={perMonthUSD} periodMonths={periodMonths} selYm={selYm} monthlyChart={monthlyChart} catChart={catChart} monthlyExpenseAvg={monthlyExpenseAvg} expenseGroupCats={expenseGroupCats} />}
        {activeTab === 'totales' && <TotalesTab data={totalesData} badge={badge} />}
        {activeTab === 'txs' && <TxsTab txs={filtered} groups={groups} onCatChange={updateCat} onNoteChange={updateNote} onDelete={deleteTx} onGroupChange={updateGroup} badge={badge} />}
        {activeTab === 'revisar' && <RevisarTab txs={txs} setTxs={setTxs} badge={badge} />}
        {activeTab === 'presupuesto' && <PresupuestoTab settings={settings} setSettings={setSettings} monthlyChart={monthlyChart} />}
        {activeTab === 'auditoria' && <AuditoriaTab badge={badge} />}
        {activeTab === 'settings' && <SettingsTab settings={settings} groups={groups} onAddGroup={addGroup} onRenameGroup={renameGroup} onDeleteGroup={deleteGroup} onSaveExpenseGroups={async (eg) => { await saveSettings({ expense_groups: eg }); setSettings(s => ({ ...s, expense_groups: eg })) }} />}
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const SCATTER_COLORS = ['#e74c3c', '#3498db', '#f39c12', '#27ae60', '#9b59b6', '#1abc9c']

function DashTab({ expenseTxs, totalUSD, totalARS, perMonthUSD, periodMonths, selYm, monthlyChart, catChart, monthlyExpenseAvg, expenseGroupCats }) {
  const [showScatter, setShowScatter] = useState(false)

  // Build scatter data — top 5 categories by count get distinct colors, rest = grey
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

  // Group scatter dots by color so Recharts can render per-series
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
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { val: fmtUSD(Math.abs(totalUSD)), lbl: 'Gastos (USD, sin xfers)', color: '#c0392b' },
          { val: fmtARS(Math.abs(totalARS)), lbl: 'Gastos (ARS, sin xfers)', color: '#c0392b' },
          ...(!selYm && periodMonths > 1 ? [{ val: fmtUSD(perMonthUSD), lbl: `Prom/mes (${periodMonths} meses)`, color: '#e67e22' }] : []),
          { val: String(expenseTxs.length), lbl: 'Transacciones (sin xfers)', color: '#1a1a2e' },
          ...(monthlyExpenseAvg != null ? [{ val: fmtUSD(monthlyExpenseAvg), lbl: `Gasto mensual (${expenseGroupCats.size} cats)`, color: '#8e44ad' }] : []),
        ].map(({ val, lbl, color }) => (
          <div key={lbl} style={{ ...S.card, flex: 1, minWidth: 160, textAlign: 'center' }}>
            <div style={{ ...S.statVal, color }}>{val}</div>
            <div style={S.statLbl}>{lbl}</div>
          </div>
        ))}
      </div>

      {monthlyChart.length > 0 && (
        <div style={S.card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>Gastos por mes (USD, sin transferencias)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyChart} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
              <Tooltip formatter={(v) => fmtUSD(v)} />
              <Bar dataKey="usd" fill="#1a1a2e" radius={[3, 3, 0, 0]} name="USD" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {catChart.length > 0 && (
        <div style={S.card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>Top 12 categorías (USD)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={catChart} layout="vertical" margin={{ top: 4, right: 60, left: 110, bottom: 4 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtK} />
              <YAxis type="category" dataKey="cat" tick={{ fontSize: 11 }} width={106} />
              <Tooltip formatter={(v) => fmtUSD(v)} />
              <Bar dataKey="usd" fill="#e67e22" radius={[0, 3, 3, 0]} name="USD" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Scatter — collapsible, only rendered on demand */}
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
    </div>
  )
}

// ─── Totales ──────────────────────────────────────────────────────────────────

function TotalesTab({ data, badge }) {
  return (
    <div style={S.card}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>Totales por categoría (sin transferencias)</h3>
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
            {data.map(row => (
              <tr key={row.cat}>
                <td style={S.td}><span style={badge(row.cat)}>{row.cat}</span></td>
                <td style={{ ...S.td, textAlign: 'right', ...(row.usd < 0 ? S.negARS : S.posARS) }}>{fmtUSD(row.usd)}</td>
                <td style={{ ...S.td, textAlign: 'right', ...(row.ars < 0 ? S.negARS : S.posARS) }}>{fmtARS(row.ars)}</td>
                <td style={{ ...S.td, textAlign: 'right', color: '#888' }}>{row.count}</td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', color: '#aaa' }}>Sin datos</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Transacciones ────────────────────────────────────────────────────────────

function TxsTab({ txs, groups, onCatChange, onNoteChange, onDelete, onGroupChange, badge }) {
  const [editNote, setEditNote] = useState(null)
  const [page, setPage] = useState(1)
  const PAGE = 100
  const visible = txs.slice(0, page * PAGE)

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: '#555' }}>{txs.length} transacciones</h3>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Fecha</th>
              <th style={S.th}>Comercio / Descripción</th>
              <th style={S.th}>Categoría</th>
              <th style={{ ...S.th, textAlign: 'right' }}>ARS</th>
              <th style={{ ...S.th, textAlign: 'right' }}>USD</th>
              <th style={S.th}>Grupo</th>
              <th style={S.th}>Notas</th>
              <th style={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(tx => (
              <tr key={tx.id} style={{ background: tx.xfer ? '#f5f5ff' : undefined }}>
                <td style={{ ...S.td, whiteSpace: 'nowrap', color: '#888', fontSize: 12 }}>{tx.date}</td>
                <td style={{ ...S.td, maxWidth: 240 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{tx.merchant || tx.raw_desc?.slice(0, 60)}</div>
                  {tx.merchant && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{tx.raw_desc?.slice(0, 80)}</div>}
                  {tx.xfer && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700, marginTop: 2, display: 'block' }}>TRANSFERENCIA</span>}
                </td>
                <td style={S.td}>
                  <select value={tx.cat || ''} onChange={e => onCatChange(tx.id, e.target.value)} style={{ ...S.select, maxWidth: 170, fontSize: 12 }}>
                    <option value="">—</option>
                    {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ ...S.td, textAlign: 'right', ...(tx.ars < 0 ? S.negARS : S.posARS), fontSize: 13 }}>{fmtARS(tx.ars)}</td>
                <td style={{ ...S.td, textAlign: 'right', color: '#555', fontSize: 12 }}>{fmtUSD(tx.usd)}</td>
                <td style={S.td}>
                  <select value={tx.group_id || ''} onChange={e => onGroupChange(tx.id, e.target.value)} style={{ ...S.select, maxWidth: 130, fontSize: 12 }}>
                    <option value="">—</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </td>
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
                <td style={{ ...S.td, color: '#888', fontSize: 12 }}>{tx.date}</td>
                <td style={S.td}>
                  <div style={{ fontWeight: 500 }}>{tx.merchant || '—'}</div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>{tx.raw_desc?.slice(0, 80)}</div>
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

function PresupuestoTab({ settings, setSettings, monthlyChart }) {
  const [editing, setEditing] = useState(false)
  const [budget, setBudget] = useState(settings?.monthly_budget_usd ?? 0)
  const budgetUSD = settings?.monthly_budget_usd ?? 0
  const chartData = monthlyChart.map(m => ({ ...m, presupuesto: budgetUSD || undefined }))

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

      {chartData.length > 0 && (
        <div style={S.card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>Gastos vs presupuesto (USD)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
              <Tooltip formatter={(v) => fmtUSD(v)} />
              <Bar dataKey="usd" fill="#e74c3c" radius={[3, 3, 0, 0]} name="Gastos" />
              {budgetUSD > 0 && <Line type="monotone" dataKey="presupuesto" stroke="#27ae60" strokeWidth={2} dot={false} name="Presupuesto" />}
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ─── Auditoría ────────────────────────────────────────────────────────────────

function AuditoriaTab({ badge }) {
  const [log, setLog] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { loadCatLog({ limit: 500 }).then(d => { setLog(d); setLoading(false) }) }, [])
  if (loading) return <div style={{ padding: 32, color: '#888' }}>Cargando log…</div>

  return (
    <div style={S.card}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>Auditoría de categorizaciones ({log?.length ?? 0} entradas)</h3>
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


// ─── Expense Groups (for monthly KPI) ────────────────────────────────────────

function ExpenseGroupsSection({ expenseGroups, onSave }) {
  const [groups, setGroups] = useState(expenseGroups ?? [])
  const [newName, setNewName] = useState('')
  const [dirty, setDirty] = useState(false)

  const update = (fn) => { setGroups(g => { const next = fn(g); setDirty(true); return next }) }

  const addGroup = () => {
    const name = newName.trim(); if (!name) return
    update(g => [...g, { id: crypto.randomUUID(), name, cats: [] }])
    setNewName('')
  }
  const removeGroup = (id) => update(g => g.filter(x => x.id !== id))
  const renameGroup = (id, name) => update(g => g.map(x => x.id === id ? { ...x, name } : x))
  const toggleCat = (id, cat) => update(g => g.map(x => x.id === id
    ? { ...x, cats: x.cats.includes(cat) ? x.cats.filter(c => c !== cat) : [...x.cats, cat] }
    : x))

  return (
    <div style={S.card}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Gasto mensual — grupos de categorías</h3>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>
        Definí grupos de categorías para el KPI "Gasto mensual" del dashboard.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input style={{ ...S.input, flex: 1, maxWidth: 280 }} placeholder="Nombre del grupo…"
          value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addGroup()} />
        <button style={S.btn()} onClick={addGroup}>Agregar</button>
      </div>
      {groups.map(g => (
        <div key={g.id} style={{ marginBottom: 12, padding: '10px 14px', background: '#f8f8f8', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input style={{ ...S.input, flex: 1, maxWidth: 240, fontWeight: 600 }} value={g.name}
              onChange={e => renameGroup(g.id, e.target.value)} />
            <button style={S.btnSm('danger')} onClick={() => removeGroup(g.id)}>✕ Eliminar</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
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
          💾 Guardar cambios
        </button>
      )}
    </div>
  )
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsTab({ settings, groups, onAddGroup, onRenameGroup, onDeleteGroup, onSaveExpenseGroups }) {
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(null) // { id, name }

  const handleAdd = async () => {
    const name = newName.trim(); if (!name) return
    await onAddGroup(name); setNewName('')
  }
  const handleRename = async () => {
    if (!renaming) return
    await onRenameGroup(renaming.id, renaming.name); setRenaming(null)
  }

  return (
    <div>
      <div style={S.card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Grupos de transacciones</h3>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>
          Agrupá transacciones de distintas categorías para filtrarlas juntas. Asignás grupos desde la tabla de transacciones.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <input style={{ ...S.input, flex: 1, maxWidth: 280 }} placeholder="Nombre del grupo…" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          <button style={S.btn()} onClick={handleAdd}>Agregar</button>
        </div>
        {!groups.length && <p style={{ color: '#aaa', fontSize: 13 }}>Todavía no hay grupos.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8f8f8', borderRadius: 8 }}>
              {renaming?.id === g.id ? (
                <>
                  <input style={{ ...S.input, flex: 1, maxWidth: 240 }} value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(null) }} autoFocus />
                  <button style={S.btn()} onClick={handleRename}>Guardar</button>
                  <button style={S.btn('secondary')} onClick={() => setRenaming(null)}>Cancelar</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontWeight: 500 }}>{g.name}</span>
                  <button style={S.btnSm()} onClick={() => setRenaming({ id: g.id, name: g.name })}>✏ Renombrar</button>
                  <button style={{ ...S.btnSm('danger') }} onClick={() => onDeleteGroup(g.id)}>✕ Eliminar</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <ExpenseGroupsSection expenseGroups={settings?.expense_groups ?? []} onSave={onSaveExpenseGroups} />

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
