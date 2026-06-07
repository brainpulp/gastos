# UI Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tab-based nav with a persistent left sidebar, merge Dashboard + Transacciones into one scrolling main view, add collapsible chart sections, and remove all AI categorization UI.

**Architecture:** All changes are in `src/Finanzas.jsx` (single-file React app per project convention). No new files needed. Work top-to-bottom through the file: removals first, then layout restructure, then DashTab collapsibles.

**⚠ Task ordering is mandatory.** Task 1 (delete AuditoriaTab) must complete before Task 2 (remove `loadCatLog` import) because AuditoriaTab calls `loadCatLog` internally — removing the import first breaks the build.

**Tech Stack:** React 19, inline styles, `makeS(dark)` for theming, Recharts for charts, Supabase for data.

---

## Task 1: Remove RevisarTab and AuditoriaTab components

**Files:**
- Modify: `src/Finanzas.jsx`

These are self-contained components. Delete both blocks and their section comments.

- [ ] **Step 1: Delete RevisarTab**

  Locate the block between `// ─── Revisar ──` (line ~1180) and `// ─── Presupuesto ──` (line ~1272). Delete it entirely — the section comment, the `function RevisarTab(...)` declaration, and all its JSX.

- [ ] **Step 2: Delete AuditoriaTab**

  Locate `// ─── Historial IA ─` (line ~1274) through the end of `function AuditoriaTab(...)`. Delete it entirely. Verify: grep for `AuditoriaTab` — should return 0 hits after deletion.

- [ ] **Step 3: Remove root-level references**

  In the `Finanzas` root component, remove:
  - `const reviewCount = txs.filter(t => t.needs_review && !t.deleted_at).length` 
  - The `revisar` and `auditoria` entries in the `TABS` array (or the whole `TABS` array if Task 4 replaces it)
  - The render lines: `{activeTab === 'revisar' && <RevisarTab .../>}` and `{activeTab === 'auditoria' && <AuditoriaTab .../>}`

- [ ] **Step 4: Commit**

  ```bash
  git add src/Finanzas.jsx
  git commit -m "Remove RevisarTab and AuditoriaTab components"
  ```

---

## Task 2: Remove AI categorization from upload flow

**Files:**
- Modify: `src/Finanzas.jsx`

The upload handler (`handleUpload`, line ~408) currently calls `loadCatLog` + `categorizeTxs`. Strip those out. The upload becomes: parse → enrich with rates → upsert → reload.

- [ ] **Step 1: Simplify handleUpload**

  Replace the categorization block. Before:
  ```js
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
  ```
  After:
  ```js
  setUploadMsg({ loading: true, text: `Subiendo ${count} transacciones…` })
  const { skipped } = await upsertTransactions(enriched)
  ```

- [ ] **Step 2: Remove unused imports**

  From the top-level imports, remove `categorizeTxs` (imported from `./categorize.js`) and `loadCatLog` (imported from `./db.js`). Verify with grep — `loadCatLog` should no longer appear anywhere in the file; same for `categorizeTxs`.

- [ ] **Step 3: Commit**

  ```bash
  git add src/Finanzas.jsx
  git commit -m "Remove AI categorization from upload flow"
  ```

---

## Task 3: Fix goToCat — remove tab switch

**Files:**
- Modify: `src/Finanzas.jsx`

- [ ] **Step 1: Update goToCat**

  Before:
  ```js
  const goToCat = (cat) => {
    if (!cat) return
    setCatFs([cat])
    setActiveTab('txs')
  }
  ```
  After:
  ```js
  const goToCat = (cat) => {
    if (!cat) return
    setCatFs([cat])
  }
  ```
  With the merged scroll view, the Transacciones section is always visible below Dashboard — no tab switch needed.

- [ ] **Step 2: Commit**

  ```bash
  git add src/Finanzas.jsx
  git commit -m "goToCat: drop tab switch, both sections always visible"
  ```

---

## Task 4: Replace tab nav with persistent left sidebar

**Files:**
- Modify: `src/Finanzas.jsx`

This is the core layout change. Rename `activeTab` → `activePanel`, add a `Sidebar` component, restructure the outer layout.

- [ ] **Step 1: Rename activeTab → activePanel throughout**

  `activeTab` is used in ~15 places. Do a careful find-and-replace of `activeTab` → `activePanel` and `setActiveTab` → `setActivePanel` throughout the file. Also update the `useState` initializer.

- [ ] **Step 2: Update hash router valid values**

  Before:
  ```js
  const valid = ['dash', 'txs', 'revisar', 'auditoria', 'settings', 'ml', 'duplicados', 'papelera']
  ```
  After:
  ```js
  const valid = ['main', 'settings', 'ml', 'duplicados', 'papelera', 'upwork']
  ```
  The initializer logic:
  ```js
  const [activePanel, setActivePanel] = useState(() => {
    const hash = window.location.hash.replace('#', '')
    const valid = ['main', 'settings', 'ml', 'duplicados', 'papelera', 'upwork']
    return valid.includes(hash) ? hash : 'main'
  })
  ```
  The hashchange effect:
  ```js
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '')
      const valid = ['main', 'settings', 'ml', 'duplicados', 'papelera', 'upwork']
      setActivePanel(valid.includes(hash) ? hash : 'main')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  ```

- [ ] **Step 3: Add the Sidebar component**

  Add this new component just before `// ─── Main component ───` (line ~225):

  ```jsx
  // ─── Sidebar ─────────────────────────────────────────────────────────────────

  const SIDEBAR_ITEMS = [
    { id: 'papelera',   icon: '🗑',  label: 'Papelera'  },
    { id: 'duplicados', icon: '📋',  label: 'Duplicados' },
    { id: 'ml',         icon: '📦',  label: 'ML Import'  },
    { id: 'upwork',     icon: '🧑‍💻', label: 'Upwork'     },
  ]

  function Sidebar({ activePanel, onNavigate, dark }) {
    return (
      <div style={{
        width: 130, minWidth: 130, background: '#12122a', display: 'flex',
        flexDirection: 'column', padding: '0 0 12px 0', userSelect: 'none',
        position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
      }}>
        {/* Logo */}
        <div
          onClick={() => onNavigate('main')}
          style={{ padding: '16px 12px 14px', cursor: 'pointer', borderBottom: '1px solid #2a2a4e' }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>💰 gastos</span>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '8px 0' }}>
          {SIDEBAR_ITEMS.map(item => (
            <div
              key={item.id}
              onClick={() => onNavigate(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                borderRadius: 6, margin: '2px 6px',
                background: activePanel === item.id ? '#2a2a4e' : 'transparent',
                color: activePanel === item.id ? '#7c7cff' : '#aaa',
              }}
            >
              <span style={{ fontSize: 15 }}>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {/* Config at bottom */}
        <div style={{ borderTop: '1px solid #2a2a4e', padding: '8px 0 0' }}>
          <div
            onClick={() => onNavigate('settings')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', cursor: 'pointer', fontSize: 13,
              borderRadius: 6, margin: '2px 6px',
              background: activePanel === 'settings' ? '#2a2a4e' : 'transparent',
              color: activePanel === 'settings' ? '#7c7cff' : '#aaa',
            }}
          >
            <span style={{ fontSize: 15 }}>⚙</span>
            <span>Config</span>
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 4: Restructure the outer layout in Finanzas return**

  Replace the current `<nav>` + `<div style={S.content}>` structure with a sidebar + main area layout.

  Replace `S.app` (currently just sets font/background on the outer div) outer layout:

  ```jsx
  return (
    <ThemeCtx.Provider value={dark}>
    <div style={{ ...S.app, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

      {/* Top strip: upload message + actions */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 8, padding: '6px 16px',
        background: dark ? '#0d0d1a' : '#1a1a2e',
        borderBottom: `1px solid ${dark ? '#2a2a4e' : '#2a2a4e'}`,
        flexShrink: 0,
      }}>
        {uploadMsg && (
          <div style={{ flex: 1, padding: '2px 0', background: uploadMsg.error ? '#fee2e2' : '#d1fae5', color: uploadMsg.error ? '#991b1b' : '#065f46', fontSize: 12, borderRadius: 4, paddingLeft: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{uploadMsg.loading ? '⏳ ' : ''}{uploadMsg.text}</span>
            {!uploadMsg.loading && <button onClick={() => setUploadMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'inherit' }}>×</button>}
          </div>
        )}
        <button style={S.themeBtn} onClick={() => setDark(d => !d)} title="Cambiar tema">
          {dark ? '☀️' : '🌙'}
        </button>
        <button
          style={{ padding: '4px 10px', fontSize: 12, cursor: filtered.length ? 'pointer' : 'default', color: '#ccc', border: '1px solid #555', borderRadius: 6, background: 'none', opacity: filtered.length ? 1 : 0.4 }}
          onClick={handleExportXLSX}
          disabled={!filtered.length}
          title={`Exportar ${filtered.length} transacciones a XLSX`}
        >
          📤 Exportar ({filtered.length})
        </button>
        <label style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#ccc', border: '1px solid #555', borderRadius: 6 }}>
          📥 Subir XLSX
          <input type="file" accept=".xlsx" ref={fileRef} onChange={handleUpload} style={{ display: 'none' }} />
        </label>
        <button style={{ ...S.logoutBtn }} onClick={onLogout}>Salir</button>
      </div>

      {/* Body: sidebar + content */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar activePanel={activePanel} onNavigate={id => { setActivePanel(id); window.location.hash = id }} dark={dark} />

        <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          {/* Filter bar — only in main view */}
          {activePanel === 'main' && (
            <div style={{ ...S.filterBar, position: 'sticky', top: 0, zIndex: 10 }}>
              {/* ... keep exact same filter bar content as before ... */}
            </div>
          )}

          {/* Filter summary */}
          {filterActive && activePanel === 'main' && (
            <div style={{ /* keep existing summary styles */ }}>
              {/* ... keep exact same filter summary content ... */}
            </div>
          )}

          {/* Panel content */}
          <div style={S.content}>
            {activePanel === 'main' && ( /* see Task 5 */ )}
            {activePanel === 'ml' && <MLImportTab onImport={txs => setTxs(prev => [...txs, ...prev])} />}
            {activePanel === 'duplicados' && <DuplicadosTab txs={txs} onDelete={bulkDeleteTxs} />}
            {activePanel === 'upwork' && <UpworkStagingTab onImport={imported => setTxs(prev => [...imported, ...prev.filter(t => !imported.find(i => i.id === t.id))])} />}
            {activePanel === 'papelera' && <PapeleraTab onRestore={id => setTxs(prev => prev.map(t => t.id === id ? { ...t, deleted_at: null } : t))} />}
            {activePanel === 'settings' && <SettingsTab
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
      </div>

    </div>
    </ThemeCtx.Provider>
  )
  ```

  **Important:** Keep the filter bar and filter summary JSX content exactly as it is today — only the surrounding condition changes from the exclusion list to `activePanel === 'main'`. Copy the existing filter bar block verbatim from its current location (search `S.filterBar` to find it). Same for the filter summary block (search `filterActive &&`). Do not paraphrase — copy the exact JSX.

- [ ] **Step 5: Delete the old TABS array and nav render**

  Remove:
  - `const TABS = [...]`
  - The `<nav style={S.nav}>...</nav>` block entirely (including the old uploadMsg inside it if it was there)

- [ ] **Step 6: Verify the app loads and sidebar is visible**

  ```bash
  cd F:\code\gastos && npm run dev
  ```
  Open `http://localhost:5173/gastos/`. Sidebar should appear on the left. Clicking items should navigate.

- [ ] **Step 7: Commit**

  ```bash
  git add src/Finanzas.jsx
  git commit -m "Replace tab nav with persistent left sidebar"
  ```

---

## Task 5: Merge Dashboard + Transacciones into main scroll view

**Files:**
- Modify: `src/Finanzas.jsx`

- [ ] **Step 1: Render both sections when activePanel === 'main'**

  Replace:
  ```jsx
  {activeTab === 'dash' && <DashTab ... />}
  {activeTab === 'txs' && <TxsTab ... />}
  ```
  With:
  ```jsx
  {activePanel === 'main' && (
    <>
      <DashTab ... />
      <div style={{ padding: '0 0 8px', margin: '8px 0 0' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: dark ? '#e0e0e0' : '#1a1a2e', padding: '0 4px' }}>
          Transacciones
        </h2>
        <TxsTab txs={filtered} onUpdate={updateTx} onDelete={deleteTx} onBulkDelete={bulkDeleteTxs} onBulkUpdate={bulkUpdateTxs} onAdd={addTx} badge={badge} cats={cats} />
      </div>
    </>
  )}
  ```
  Keep all DashTab props exactly as before.

- [ ] **Step 2: Verify scroll and filter interaction**

  Open the app. Scroll down — Dashboard stats should be visible, then the Transacciones table below. Typing in the search box should filter the transaction table. Clicking a category badge in Dashboard should set the category filter (visible in the filter bar) and the transaction table updates — no scroll jump needed.

- [ ] **Step 3: Commit**

  ```bash
  git add src/Finanzas.jsx
  git commit -m "Merge Dashboard + Transacciones into single scroll view"
  ```

---

## Task 6: Make charts and Por categoría collapsible (default collapsed)

**Files:**
- Modify: `src/Finanzas.jsx` — `DashTab` component (lines ~701–895)

- [ ] **Step 1: Add collapse state to DashTab**

  Inside `DashTab`, add two new state variables right below the existing `showScatter`:
  ```js
  const [chartsOpen, setChartsOpen] = useState(false)
  const [porCatOpen, setPorCatOpen] = useState(false)
  ```
  Remove `showScatter` state — it becomes a sub-toggle inside the charts section.
  Add it back inside the component:
  ```js
  const [showScatter, setShowScatter] = useState(false)
  ```
  (No change needed to scatter data memos — they already guard on `showScatter`.)

- [ ] **Step 2: Wrap charts in a collapsible section**

  Replace the current three chart blocks (stacked bar card, cat bar + pie card, scatter card) with:

  ```jsx
  {/* Collapsible charts section */}
  <div style={S.card}>
    <button
      onClick={() => setChartsOpen(o => !o)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
               color: dark ? '#e0e0e0' : '#555', fontWeight: 600, padding: 0,
               display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left' }}
    >
      <span style={{ display: 'inline-block', transition: 'transform .15s', transform: chartsOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
      Gráficos
    </button>
    {chartsOpen && (
      <div style={{ marginTop: 16 }}>
        {/* Stacked monthly bar — keep existing JSX unchanged */}
        {monthlyStackedChart.data.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {/* ... exact existing stacked bar chart JSX ... */}
          </div>
        )}
        {/* Cat bar + pie — keep existing JSX unchanged */}
        {catChart.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {/* ... exact existing cat bar + pie JSX ... */}
          </div>
        )}
        {/* Scatter — keep existing collapsible sub-toggle */}
        <div>
          <button
            onClick={() => setShowScatter(s => !s)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                     color: dark ? '#aaa' : '#666', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ display: 'inline-block', transition: 'transform .15s', transform: showScatter ? 'rotate(90deg)' : 'none' }}>▶</span>
            Scatter de gastos individuales
          </button>
          {showScatter && scatterSeries.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {/* ... exact existing scatter JSX ... */}
            </div>
          )}
        </div>
      </div>
    )}
  </div>
  ```

- [ ] **Step 3: Wrap Por categoría in a collapsible section**

  Replace the current "Por categoría" card:
  ```jsx
  {/* Collapsible Por categoría */}
  <div style={S.card}>
    <button
      onClick={() => setPorCatOpen(o => !o)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
               color: dark ? '#e0e0e0' : '#555', fontWeight: 600, padding: 0,
               display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left' }}
    >
      <span style={{ display: 'inline-block', transition: 'transform .15s', transform: porCatOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
      Por categoría
    </button>
    {porCatOpen && (
      <div style={{ marginTop: 12, overflowX: 'auto' }}>
        <table style={S.table}>
          {/* ... exact existing thead + tbody ... */}
        </table>
      </div>
    )}
  </div>
  ```

- [ ] **Step 4: Verify collapse behavior**

  Open the app. Dashboard KPI pills should be visible. Both "▶ Gráficos" and "▶ Por categoría" should show as collapsed rows. Clicking each should expand/collapse. Scatter sub-toggle should work inside the open charts section.

- [ ] **Step 5: Commit**

  ```bash
  git add src/Finanzas.jsx
  git commit -m "DashTab: collapsible Gráficos and Por categoría (default collapsed)"
  ```

---

## Task 7: Push and verify deploy

- [ ] **Step 1: Push to main**

  ```bash
  git push origin main
  ```

- [ ] **Step 2: Watch deploy**

  GitHub Actions will build and deploy to `https://brainpulp.github.io/gastos/`. Monitor at `https://github.com/brainpulp/gastos/actions`. Takes ~2 minutes.

- [ ] **Step 3: Smoke test live app**

  - Sidebar visible on left, logo clickable → returns to main view
  - Clicking Papelera, Duplicados, ML Import, Upwork, Config each loads the right panel
  - Main view: KPI pills visible, charts collapsed, Por categoría collapsed
  - Expanding charts shows all three chart types
  - Transacciones table visible below Dashboard without tab switch
  - Search/filter works and affects only Transacciones table
  - Clicking a category badge in Por categoría (once expanded) sets the category filter (table updates, no scroll jump)
  - Clicking a month bar in the stacked chart sets the date filter (dateFrom/dateTo update in filter bar)
  - Upload XLSX works (no AI categorization step — goes straight to upsert)
  - Dark mode toggle works
  - Export button works
