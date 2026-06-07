# UI Restructure — Design Spec
_Date: 2026-06-07_

## Summary

Replace the current tab-based layout with a persistent left sidebar + single scrolling main view. Remove all AI categorization UI. Simplify to two primary sections: Dashboard and Transacciones, visible together via scroll.

---

## Decisions Made

| Topic | Decision |
|-------|----------|
| Revisar tab | **Remove** — AI categorization proved useless |
| Historial IA tab | **Remove** — debugging tool, not needed |
| AI categorize button (upload flow) | **Remove** from upload; skip `categorizeTxs` call |
| Navigation | Persistent left sidebar, 130px, icons + labels |
| Main view | Dashboard + Transacciones on one scrolling page |
| Charts default | **Collapsed** |
| Por categoría default | **Collapsed** |

---

## Layout

```
┌──────────────┬─────────────────────────────────────────┐
│  💰 gastos   │  [sticky filter bar]                    │
│              │                                         │
│  🗑 Papelera  │  ▶ Gráficos          (collapsed)       │
│  📋 Duplicados│  ▶ Por categoría     (collapsed)       │
│  📦 ML Import │  Stats cards                           │
│  🧑‍💻 Upwork   │                                         │
│              │  ── Transacciones ──                    │
│  ── ──  ──   │  [table rows, infinite scroll]          │
│  ⚙ Config    │                                         │
└──────────────┴─────────────────────────────────────────┘
```

- Sidebar: dark background (`#12122a`), 130px wide, always visible, not collapsible
- Active item: highlighted with `#2a2a4e` background + accent color
- App logo at top — clicking it returns to main view
- Config at bottom, separated by a divider
- Main content area fills remaining width

---

## Navigation State

`activePanel` replaces `activeTab`. Values:

| Value | Content shown |
|-------|--------------|
| `'main'` | Dashboard + Transacciones (default) |
| `'papelera'` | PapeleraTab |
| `'duplicados'` | DuplicadosTab |
| `'ml'` | MLImportTab |
| `'upwork'` | UpworkStagingTab |
| `'settings'` | SettingsTab |

Filter bar (period, amount, bank, category, search) only shows when `activePanel === 'main'`.
Filter summary bar follows the same rule.

---

## Main View (activePanel === 'main')

Single scrolling column with two sections:

### Dashboard section

- **Stats row**: always visible (total gastos/mes, ingresos/mes, transaction count, last date)
- **▶ Gráficos** — collapsible, default closed. Contains: monthly stacked bar, category bar chart, scatter plot
- **▶ Por categoría** — collapsible, default closed. Contains: the existing inline totals table + group stats

Collapse state stored in component-local `useState`, defaulting to `false`. Chevron rotates on toggle. Header row is clickable.

### Transacciones section

- Section heading ("Transacciones") acts as a visual divider below Dashboard
- Same TxsTab content as today (sort, inline edit, bulk ops, pagination)
- Receives `filtered` (same as today)

---

## Sidebar Component

New `Sidebar` component extracted from inline JSX. Props: `activePanel`, `onNavigate`, `dark`.

Items (in order):
1. 🗑 Papelera
2. 📋 Duplicados
3. 📦 ML Import
4. 🧑‍💻 Upwork
5. _(divider)_
6. ⚙ Config

Clicking an item sets `activePanel` to the corresponding value. Clicking the logo sets it to `'main'`.

---

## Removals

### Components deleted
- `RevisarTab` — entire component (~60 lines)
- `AuditoriaTab` — entire component

### State removed from root `Finanzas`
- `reviewCount` derived value
- `uncatCount` is kept (still useful for sin-cat filter badge)

### Tab references removed
- All `activeTab === 'revisar'` / `'auditoria'` checks
- Tab bar render replaced by `<Sidebar>`
- Hash router valid tab list updated (remove `'revisar'`, `'auditoria'`)

### Upload flow
- Remove `categorizeTxs` call in `handleUpload`
- Remove the `setUploadMsg` categorization progress steps
- Import `categorizeTxs` and `loadCatLog` can be removed from imports if unused elsewhere

### AI badge
- Remove `🤖` badge display logic in TxsTab and elsewhere? **No** — keep it. The emoji prefix on category names is data already in the DB; removing it from display is a separate cleanup. Leave for now.

---

## Collapsible Pattern

```jsx
const [chartsOpen, setChartsOpen] = useState(false)

<div onClick={() => setChartsOpen(o => !o)} style={{ cursor: 'pointer', ...headerStyle }}>
  <span style={{ transform: chartsOpen ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
  {' '}Gráficos
</div>
{chartsOpen && <div>...chart content...</div>}
```

Same pattern for `porCatOpen`.

---

## Dark Mode

Sidebar uses hardcoded dark palette (`#12122a`, `#1a1a2e`, `#2a2a4e`) regardless of app theme — sidebar is always dark, matching the current tab bar style. Main content area respects `dark` toggle as before.

---

## Implementation Notes

- **`goToCat(cat)`** — currently switches to the Transacciones tab. With no tabs, it just sets `catFs=[cat]`. Drop the tab-switch; no scroll-to needed.
- **`AuditoriaTab` = Historial IA** — same component, grep for `AuditoriaTab` and `auditoria` to find all references before deleting.
- **`loadCatLog` / `categorizeTxs`** — grep for all call sites before removing imports; both should be unused after the upload flow change.
- **`reviewCount`** — grep for all references before removing; it currently drives the `Revisar (N)` badge only.
- **Hash router fallback** — unknown or removed hash values (`revisar`, `auditoria`) default to `activePanel = 'main'`. Update the `valid` array in the hash-read effect accordingly.
- **Sidebar label** — rendered as "Config" (not "Settings" or "Configuración").

---

## Out of Scope

- Removing `ai_assigned` / `needs_review` columns from DB
- Removing the Edge Function `categorize-tx`
- Splitting `Finanzas.jsx` into multiple files (stays as one large file per project convention)
- Mobile/responsive layout
