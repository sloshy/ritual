// Theme palettes for the public site and admin site.
//
// Each theme is one named palette built around a background hue and an
// accent (highlight) hue. Inverted variants live under their own
// `<name>-inverted` keys so that selecting a theme is a single string at
// the CLI. `generateThemeCss` renders the chosen palette as a `:root { ... }`
// block of CSS custom properties that override the defaults provided by
// `src/css/theme-base.css`.

export type ThemePalette = {
  bgHue: number
  bgChroma: number
  isDark: boolean
  accentHue: number
  accentChroma: number
}

export const themes = {
  default: { bgHue: 260, bgChroma: 0.02, isDark: true, accentHue: 265, accentChroma: 0.15 },
  'default-inverted': {
    bgHue: 260,
    bgChroma: 0.01,
    isDark: false,
    accentHue: 265,
    accentChroma: 0.16,
  },

  orzhov: { bgHue: 280, bgChroma: 0.005, isDark: true, accentHue: 80, accentChroma: 0.005 },
  'orzhov-inverted': {
    bgHue: 80,
    bgChroma: 0.005,
    isDark: false,
    accentHue: 280,
    accentChroma: 0.005,
  },

  izzet: { bgHue: 245, bgChroma: 0.035, isDark: true, accentHue: 25, accentChroma: 0.18 },
  'izzet-inverted': { bgHue: 25, bgChroma: 0.04, isDark: true, accentHue: 245, accentChroma: 0.18 },

  gruul: { bgHue: 145, bgChroma: 0.04, isDark: true, accentHue: 25, accentChroma: 0.18 },
  'gruul-inverted': { bgHue: 25, bgChroma: 0.04, isDark: true, accentHue: 145, accentChroma: 0.16 },

  // Red is perceptually much louder than the other guild hues at the same
  // chroma, so Rakdos's background runs essentially neutral — only the
  // highlights (accents, focus rings, primary buttons) carry the red.
  rakdos: { bgHue: 25, bgChroma: 0.002, isDark: true, accentHue: 25, accentChroma: 0.15 },
  'rakdos-inverted': {
    bgHue: 25,
    bgChroma: 0.025,
    isDark: true,
    accentHue: 25,
    accentChroma: 0.005,
  },

  selesnya: { bgHue: 110, bgChroma: 0.005, isDark: false, accentHue: 145, accentChroma: 0.16 },
  'selesnya-inverted': {
    bgHue: 145,
    bgChroma: 0.04,
    isDark: true,
    accentHue: 110,
    accentChroma: 0.005,
  },

  azorius: { bgHue: 240, bgChroma: 0.005, isDark: false, accentHue: 245, accentChroma: 0.18 },
  'azorius-inverted': {
    bgHue: 245,
    bgChroma: 0.04,
    isDark: true,
    accentHue: 240,
    accentChroma: 0.005,
  },

  boros: { bgHue: 60, bgChroma: 0.005, isDark: false, accentHue: 25, accentChroma: 0.18 },
  'boros-inverted': {
    bgHue: 25,
    bgChroma: 0.04,
    isDark: true,
    accentHue: 60,
    accentChroma: 0.005,
  },

  dimir: { bgHue: 245, bgChroma: 0.012, isDark: true, accentHue: 245, accentChroma: 0.16 },
  'dimir-inverted': {
    bgHue: 245,
    bgChroma: 0.035,
    isDark: true,
    accentHue: 245,
    accentChroma: 0.005,
  },

  simic: { bgHue: 220, bgChroma: 0.04, isDark: true, accentHue: 145, accentChroma: 0.16 },
  'simic-inverted': {
    bgHue: 145,
    bgChroma: 0.04,
    isDark: true,
    accentHue: 220,
    accentChroma: 0.18,
  },

  golgari: { bgHue: 145, bgChroma: 0.012, isDark: true, accentHue: 145, accentChroma: 0.16 },
  'golgari-inverted': {
    bgHue: 145,
    bgChroma: 0.04,
    isDark: true,
    accentHue: 145,
    accentChroma: 0.005,
  },
} as const satisfies Record<string, ThemePalette>

export type ThemeName = keyof typeof themes

// Safe: ThemeName is exactly `keyof typeof themes`, so `Object.keys(themes)` and
// `ThemeName[]` describe the same set.
export const themeNames = Object.keys(themes) as ThemeName[]

export function isThemeName(value: string): value is ThemeName {
  return Object.prototype.hasOwnProperty.call(themes, value)
}

// Resolves a raw CLI `--theme` value to a validated `ThemeName`. Falls back to
// `default` when omitted; logs an error and exits when the value is unknown.
// Centralised here so `build-site` and `admin` share identical handling.
export function resolveThemeName(raw: string | undefined): ThemeName {
  const normalized = (raw ?? 'default').toLowerCase()
  if (isThemeName(normalized)) return normalized
  console.error(`Unknown theme '${raw}'. Choose one of: ${themeNames.join(', ')}.`)
  process.exit(1)
}

type ThemeCssVars = Record<string, string>

function fmt(n: number): string {
  return n.toFixed(4).replace(/\.?0+$/, '')
}

function ok(L: number, C: number, H: number): string {
  return `oklch(${fmt(L)}% ${fmt(C)} ${fmt(H)})`
}

// Text color used on top of saturated, mid-lightness button surfaces (the
// `--accent`, `--btn-primary`, `--btn-export`, `--btn-add` family). Cannot
// reuse `--text-primary` because that flips dark/light with the page bg —
// here we want contrast against the *button* color, not the page color.
function btnOnColorText(p: ThemePalette): string {
  // Saturated colored accent (every guild theme except Orzhov and the
  // grayscale inverted variants): near-white reads at both 50% and 68%
  // chroma-rich button lightnesses.
  if (p.accentChroma > 0.05) return ok(98, 0, 0)
  // Grayscale accent: the button surface is a tone, not a color. Pick the
  // text shade that contrasts with the accent's lightness in this mode —
  // dark accents (light-mode) get near-white; light accents (dark-mode) get
  // near-black.
  return p.isDark ? ok(15, 0, 0) : ok(98, 0, 0)
}

function darkVars(p: ThemePalette): ThemeCssVars {
  const { bgHue: bH, bgChroma: bC, accentHue: aH, accentChroma: aC } = p
  const textC = Math.min(bC, 0.005)
  const bodyC = Math.min(bC, 0.01)
  const activeC = Math.max(bC * 3, 0.06)
  return {
    '--bg-body': ok(20, bC, bH),
    '--bg-panel': ok(24, bC, bH),
    '--bg-hover': ok(30, bC * 1.5, bH),
    '--bg-active': ok(38, activeC, aH),
    '--bg-subtle': ok(18, bC, bH),
    '--border': ok(35, bC, bH),
    '--border-hover': ok(50, aC * 0.8, aH),
    '--border-focus': ok(58, aC, aH),
    '--border-separator': ok(25, bC, bH),
    '--text-primary': ok(95, textC, bH),
    '--text-body': ok(85, bodyC, bH),
    '--text-secondary': ok(70, bC, bH),
    '--text-muted': ok(55, bC, bH),
    '--text-dim': ok(45, bC, bH),
    '--text-accent': ok(75, aC * 0.8, aH),
    '--accent': ok(68, aC, aH),
    '--accent-hover': ok(72, aC, aH),
    '--accent-dim': ok(55, aC * 0.55, aH),
    '--btn-bg': ok(30, bC * 1.5, bH),
    '--btn-hover': ok(38, bC * 1.5, bH),
    '--btn-text': ok(80, bodyC, bH),
    '--btn-primary': ok(55, aC, aH),
    '--btn-primary-hover': ok(50, aC, aH),
    '--btn-export': ok(50, aC * 1.2, aH),
    '--btn-export-hover': ok(58, aC, aH),
    '--btn-on-color-text': btnOnColorText(p),
  }
}

function lightVars(p: ThemePalette): ThemeCssVars {
  const { bgHue: bH, bgChroma: bC, accentHue: aH, accentChroma: aC } = p
  const textC = Math.min(bC, 0.01)
  const activeC = Math.max(bC * 2, 0.04)
  return {
    '--bg-body': ok(96, bC * 0.5, bH),
    '--bg-panel': ok(99, bC * 0.3, bH),
    '--bg-hover': ok(91, bC, bH),
    '--bg-active': ok(82, activeC, aH),
    '--bg-subtle': ok(98, bC * 0.4, bH),
    '--border': ok(82, bC, bH),
    '--border-hover': ok(58, aC * 0.8, aH),
    '--border-focus': ok(50, aC, aH),
    '--border-separator': ok(88, bC, bH),
    '--text-primary': ok(20, textC, bH),
    '--text-body': ok(30, textC, bH),
    '--text-secondary': ok(45, bC, bH),
    '--text-muted': ok(55, bC, bH),
    '--text-dim': ok(65, bC, bH),
    '--text-accent': ok(40, aC, aH),
    '--accent': ok(50, aC, aH),
    '--accent-hover': ok(45, aC, aH),
    '--accent-dim': ok(65, aC * 0.55, aH),
    '--btn-bg': ok(88, bC, bH),
    '--btn-hover': ok(80, bC * 1.5, bH),
    '--btn-text': ok(20, textC, bH),
    '--btn-primary': ok(50, aC, aH),
    '--btn-primary-hover': ok(45, aC, aH),
    '--btn-export': ok(48, aC * 1.1, aH),
    '--btn-export-hover': ok(42, aC * 1.1, aH),
    '--btn-on-color-text': btnOnColorText(p),
  }
}

function paletteVars(p: ThemePalette): ThemeCssVars {
  return p.isDark ? darkVars(p) : lightVars(p)
}

export function generateThemeCss(themeName: ThemeName): string {
  const palette = themes[themeName]
  const vars = paletteVars(palette)
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`)
  return `/* Theme: ${themeName} */\n:root {\n${lines.join('\n')}\n}\n`
}
