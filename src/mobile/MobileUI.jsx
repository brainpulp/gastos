import { useEffect, useRef, useState } from 'react'
import { MONO, safeBottom } from './mobileTheme.js'
import { catColor, bankInitials, BANK_STYLE } from '../lib/shared.js'

// ─── Bottom sheet modal ────────────────────────────────────────────────────
export function Sheet({ open, onClose, title, children, t, maxHeight = '88vh' }) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      const id = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(id)
    } else {
      setShown(false)
      const id = setTimeout(() => setMounted(false), 240)
      return () => clearTimeout(id)
    }
  }, [open])
  if (!mounted) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end', background: shown ? t.scrim : 'transparent',
        transition: 'background .24s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: t.sheetBg, color: t.ink, borderRadius: '20px 20px 0 0',
          padding: `10px 18px calc(${safeBottom} + 18px)`, maxHeight, overflowY: 'auto',
          transform: shown ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform .26s cubic-bezier(.32,.72,0,1)',
          boxShadow: '0 -12px 40px -8px rgba(0,0,0,.4)',
        }}
      >
        <div style={{ width: 38, height: 5, borderRadius: 3, background: t.line, margin: '0 auto 12px' }} />
        {title && <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 12px' }}>{title}</div>}
        {children}
      </div>
    </div>
  )
}

// ─── Bottom tab bar ────────────────────────────────────────────────────────
export function TabBar({ tabs, active, onChange, t }) {
  return (
    <nav style={{
      flex: '0 0 auto', display: 'flex', borderTop: `1px solid ${t.line}`,
      background: t.dark ? 'rgba(16,16,26,.9)' : 'rgba(248,248,252,.92)',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      paddingBottom: safeBottom,
    }}>
      {tabs.map(tab => {
        const on = tab.key === active
        const color = on ? (tab.accent || t.accent) : t.muted
        return (
          <button key={tab.key} onClick={() => onChange(tab.key)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 3, padding: '7px 0 6px', border: 'none',
              background: 'none', color, cursor: 'pointer', position: 'relative',
              fontSize: 10, fontWeight: 600,
            }}>
            <span style={{ fontSize: 21, lineHeight: 1, position: 'relative' }}>
              {tab.icon}
              {tab.badge > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -11, minWidth: 16, height: 16, padding: '0 4px',
                  borderRadius: 8, background: t.neg, color: '#fff', fontSize: 10, fontWeight: 800,
                  display: 'grid', placeItems: 'center', lineHeight: 1,
                }}>{tab.badge > 99 ? '99+' : tab.badge}</span>
              )}
            </span>
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}

// ─── Large iOS title with optional trailing action ─────────────────────────
export function LargeTitle({ children, sub, trailing }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, margin: '4px 0 8px' }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', margin: 0, lineHeight: 1.05 }}>{children}</h1>
        {sub && <div style={{ fontSize: 12.5, opacity: .6, marginTop: 3 }}>{sub}</div>}
      </div>
      {trailing}
    </div>
  )
}

// ─── Bank avatar ───────────────────────────────────────────────────────────
export function BankAvatar({ bank, size = 36 }) {
  const s = BANK_STYLE[bank] || { background: '#e8e8ef', color: '#555' }
  return (
    <div style={{
      width: size, height: size, flex: `0 0 ${size}px`, borderRadius: size * 0.29,
      background: s.background, color: s.color, display: 'grid', placeItems: 'center',
      fontWeight: 800, fontSize: size * 0.36,
    }}>{bankInitials(bank)}</div>
  )
}

// ─── Category badge ────────────────────────────────────────────────────────
export function CatBadge({ cat, t, small }) {
  if (!cat) return <span style={{ fontSize: small ? 10.5 : 12, color: t.neg, fontWeight: 600 }}>Sin categoría</span>
  return (
    <span style={{
      display: 'inline-block', padding: small ? '1px 7px' : '2px 9px', borderRadius: 8,
      fontSize: small ? 10.5 : 12, fontWeight: 600, background: catColor(cat, t.dark ? 0.24 : 0.16),
      color: t.dark ? '#eaeaf5' : '#222', maxWidth: '100%', overflow: 'hidden',
      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{cat}</span>
  )
}

// ─── Segmented control / chip row ──────────────────────────────────────────
export function Chips({ options, value, onChange, t }) {
  return (
    <div style={{ display: 'flex', gap: 7, overflowX: 'auto', padding: '2px 0', scrollbarWidth: 'none' }}>
      {options.map(opt => {
        const on = opt.value === value
        return (
          <button key={String(opt.value)} onClick={() => onChange(opt.value)}
            style={{
              flex: '0 0 auto', fontSize: 12.5, fontWeight: 600, padding: '6px 13px', borderRadius: 999,
              border: `1px solid ${on ? 'transparent' : t.line}`, cursor: 'pointer', whiteSpace: 'nowrap',
              background: on ? t.accent : t.card, color: on ? '#fff' : t.inkSoft,
            }}>{opt.label}</button>
        )
      })}
    </div>
  )
}

// ─── Card container ────────────────────────────────────────────────────────
export function Card({ children, t, style, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: t.card, borderRadius: 16, padding: 15, boxShadow: t.shadow,
      border: `1px solid ${t.lineSoft}`, ...style,
    }}>{children}</div>
  )
}

// ─── Mono amount ───────────────────────────────────────────────────────────
export function Amount({ value, t, size = 14, sub }) {
  const neg = value < 0
  return (
    <div style={{ textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
      <div style={{ fontWeight: 700, fontSize: size, color: neg ? t.neg : t.pos, letterSpacing: '-.02em', whiteSpace: 'nowrap' }}>
        {value == null ? '—' : formatSigned(value)}
      </div>
      {sub && <div style={{ fontSize: 9.5, color: t.muted, fontWeight: 500 }}>{sub}</div>}
    </div>
  )
}
function formatSigned(v) {
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(v))
  return `${v < 0 ? '−' : '+'}$${s}`
}

// ─── Mini bar chart (sparkline of values, click to select) ─────────────────
export function MiniBars({ data, t, height = 54, onClick, selectedKey, accent }) {
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
      {data.map(d => {
        const h = Math.max(3, (Math.abs(d.value) / max) * (height - 4))
        const sel = d.key === selectedKey
        return (
          <div key={d.key} onClick={onClick ? () => onClick(d) : undefined}
            title={d.title}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', cursor: onClick ? 'pointer' : 'default' }}>
            <div style={{ height: h, borderRadius: 3, background: sel ? (accent || t.accent) : t.barTrack, transition: 'height .2s' }} />
          </div>
        )
      })}
    </div>
  )
}

// ─── Donut ring ────────────────────────────────────────────────────────────
export function Ring({ slices, t, size = 116, thickness = 7 }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1
  const r = 15.9155
  // dash + offset per slice; offset starts at 25 (top) and walks back by the running sum
  const pcts = slices.map(s => (s.value / total) * 100)
  const arcs = slices.map((s, i) => ({
    color: s.color,
    dash: `${pcts[i]} ${100 - pcts[i]}`,
    offset: 25 - pcts.slice(0, i).reduce((a, b) => a + b, 0),
  }))
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" style={{ flex: '0 0 auto' }}>
      <circle cx="21" cy="21" r={r} fill="none" stroke={t.barTrack} strokeWidth={thickness} />
      {arcs.map((a, i) => (
        <circle key={i} cx="21" cy="21" r={r} fill="none" stroke={a.color}
          strokeWidth={thickness} strokeDasharray={a.dash} strokeDashoffset={a.offset} />
      ))}
    </svg>
  )
}

// ─── Labeled input row ─────────────────────────────────────────────────────
export function Field({ label, t, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: t.muted, marginBottom: 5 }}>{label}</div>
      {children}
    </label>
  )
}

export function inputStyle(t) {
  return {
    width: '100%', padding: '11px 13px', fontSize: 16, borderRadius: 11,
    border: `1px solid ${t.line}`, background: t.inputBg, color: t.ink,
    boxSizing: 'border-box', outline: 'none', WebkitAppearance: 'none',
  }
}

// ─── Filled / tinted button ────────────────────────────────────────────────
export function Btn({ children, onClick, t, variant = 'tinted', style, disabled }) {
  const base = {
    border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, padding: '12px 16px',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, width: '100%',
  }
  const styles = {
    filled: { background: t.accent, color: '#fff' },
    tinted: { background: t.accentBg, color: t.accentInk },
    plain:  { background: t.card2, color: t.ink },
    danger: { background: t.dark ? 'rgba(246,104,94,.16)' : '#fdecea', color: t.neg },
    pos:    { background: t.dark ? 'rgba(52,211,153,.16)' : '#e7f7ef', color: t.pos },
  }
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...styles[variant], ...style }}>{children}</button>
}

// ─── Swipeable row (reveal actions on left-swipe) ──────────────────────────
export function SwipeRow({ children, actions, t }) {
  const [dx, setDx] = useState(0)
  const start = useRef(null)
  const width = actions.reduce((s, a) => s + (a.width || 76), 0)
  const onDown = e => { start.current = (e.touches ? e.touches[0].clientX : e.clientX) - dx }
  const onMove = e => {
    if (start.current == null) return
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - start.current
    setDx(Math.max(-width, Math.min(0, x)))
  }
  const onUp = () => {
    if (start.current == null) return
    setDx(dx < -width / 2 ? -width : 0)
    start.current = null
  }
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, display: 'flex' }}>
        {actions.map((a, i) => (
          <button key={i} onClick={() => { a.onClick(); setDx(0) }}
            style={{ width: a.width || 76, border: 'none', background: a.bg, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {a.label}
          </button>
        ))}
      </div>
      <div
        onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        style={{ transform: `translateX(${dx}px)`, transition: start.current == null ? 'transform .2s' : 'none', background: t.bg }}>
        {children}
      </div>
    </div>
  )
}
