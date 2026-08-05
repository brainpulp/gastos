// Design tokens for the mobile (iPhone) app.
// Direction A (native iOS) base + Direction B (forensic) cyan accent.
// makeT(dark) returns a flat token object consumed via inline styles.

export function makeT(dark) {
  return dark
    ? {
        dark: true,
        bg:        '#0b0b14',
        bgElev:    '#101019',
        card:      '#14141f',
        card2:     '#1b1b29',
        ink:       '#ecedf5',
        inkSoft:   '#c7c8dc',
        muted:     '#8a8ba6',
        faint:     '#6a6b82',
        line:      'rgba(255,255,255,.09)',
        lineSoft:  'rgba(255,255,255,.05)',
        accent:    '#8a7cff',
        accentInk: '#a99dff',
        accentBg:  'rgba(138,124,255,.16)',
        cyan:      '#37e0c4',
        cyanBg:    'rgba(55,224,196,.14)',
        pos:       '#34d399',
        neg:       '#f6685e',
        gold:      '#e8b24a',
        barTrack:  '#232334',
        sheetBg:   '#14141f',
        scrim:     'rgba(0,0,0,.55)',
        shadow:    '0 10px 30px -12px rgba(0,0,0,.7)',
        inputBg:   '#12121f',
      }
    : {
        dark: false,
        bg:        '#f2f2f7',
        bgElev:    '#ffffff',
        card:      '#ffffff',
        card2:     '#f7f7fb',
        ink:       '#1c1c2e',
        inkSoft:   '#3a3b4d',
        muted:     '#8a8a9e',
        faint:     '#a6a7b8',
        line:      'rgba(20,20,45,.10)',
        lineSoft:  'rgba(20,20,45,.06)',
        accent:    '#6a5cff',
        accentInk: '#5b4bff',
        accentBg:  'rgba(106,92,255,.12)',
        cyan:      '#0fb8a0',
        cyanBg:    'rgba(15,184,160,.12)',
        pos:       '#0fa958',
        neg:       '#e0392b',
        gold:      '#c98a1a',
        barTrack:  '#e7e7ef',
        sheetBg:   '#ffffff',
        scrim:     'rgba(0,0,0,.35)',
        shadow:    '0 10px 30px -14px rgba(0,0,0,.28)',
        inputBg:   '#ffffff',
      }
}

export const SF = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif'
export const MONO = 'ui-monospace, "SF Mono", "SFMono-Regular", Menlo, monospace'

// Safe-area insets (notch / home indicator). Fall back to 0 in browsers.
export const safeTop = 'env(safe-area-inset-top, 0px)'
export const safeBottom = 'env(safe-area-inset-bottom, 0px)'
