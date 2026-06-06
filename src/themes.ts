// Theme palettes + CSS generation for the public site and admin site.
//
// Each named theme is one palette built around a background hue and an
// accent hue. Inverted variants live under their own `<name>-inverted`
// keys. The build emits CSS for *all* registered themes (each guarded by
// `:root[data-theme="<name>"]` except `default`, which is the bare
// `:root` rule), so the runtime can switch themes by toggling the
// `data-theme` attribute on `<html>`.
//
// Custom themes are arbitrary `--var: value` dictionaries created by the
// in-browser editor or loaded from a JSON file at build time.
//
// This file is browser-safe except for the Node-only `resolveThemeName`
// helper at the very bottom; do not call that from SPA code.

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

export type ThemeCssVars = Record<string, string>

// Every CSS variable that `paletteToVars` is guaranteed to produce. Listed
// explicitly so consumers can index a resolved palette without
// undefined-narrowing, and so a future refactor that drops a key here breaks
// the build at the implementation site instead of leaving a silent gap
// downstream. The intersection with `ThemeCssVars` keeps a resolved palette
// structurally assignable wherever a generic theme-var dict is expected
// (e.g. `renderRule`).
export type ResolvedPalette = ThemeCssVars & {
  '--bg-body': string
  '--bg-panel': string
  '--bg-hover': string
  '--bg-active': string
  '--bg-subtle': string
  '--border': string
  '--border-hover': string
  '--border-focus': string
  '--border-separator': string
  '--text-primary': string
  '--text-body': string
  '--text-secondary': string
  '--text-muted': string
  '--text-dim': string
  '--text-accent': string
  '--accent': string
  '--accent-hover': string
  '--accent-dim': string
  '--btn-bg': string
  '--btn-hover': string
  '--btn-text': string
  '--btn-primary': string
  '--btn-primary-hover': string
  '--btn-export': string
  '--btn-export-hover': string
  '--btn-on-color-text': string
  '--success-bg': string
  '--success-border': string
  '--success-text': string
  '--error': string
  '--error-bg': string
  '--error-border': string
  '--error-text': string
  '--card-link': string
  '--card-link-hover': string
}

// A custom theme captured from the in-browser editor or a user JSON file.
// Variables is a flat map of any subset of theme vars to override; values
// are raw CSS strings (e.g. `oklch(20% 0.02 260)` or `9px`).
export type CustomTheme = {
  name: string
  description?: string
  variables: ThemeCssVars
}

// ---------------------------------------------------------------------------
// Palette → CSS variables
// ---------------------------------------------------------------------------

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
  if (p.accentChroma > 0.05) return ok(98, 0, 0)
  return p.isDark ? ok(15, 0, 0) : ok(98, 0, 0)
}

// Success (green) and error (red) semantic colors. The hue is fixed —
// green ~155, red ~22 — independent of the theme's background/accent hue,
// but the lightness flips between dark and light themes so text and badges
// stay legible against the page: bright fills read on dark backgrounds,
// deep shades read on light ones. (On light themes the previous fixed
// 80%-lightness text washed out against the near-white panel.)
const darkStatusVars = {
  '--success-bg': 'oklch(30% 0.08 155 / 0.5)',
  '--success-border': 'oklch(42% 0.12 155)',
  '--success-text': 'oklch(80% 0.14 155)',
  '--error': 'oklch(65% 0.2 25)',
  '--error-bg': 'oklch(30% 0.08 25 / 0.5)',
  '--error-border': 'oklch(45% 0.17 25)',
  '--error-text': 'oklch(80% 0.1 20)',
}

const lightStatusVars = {
  '--success-bg': 'oklch(92% 0.06 155 / 0.6)',
  '--success-border': 'oklch(72% 0.13 155)',
  '--success-text': 'oklch(46% 0.15 155)',
  '--error': 'oklch(55% 0.22 25)',
  '--error-bg': 'oklch(92% 0.06 25 / 0.6)',
  '--error-border': 'oklch(72% 0.16 25)',
  '--error-text': 'oklch(48% 0.2 22)',
}

// Card-name hyperlinks (e.g. in the changes dialog). A fixed blue hue —
// independent of the theme accent, matching the codebase convention of
// per-link-type semantic colors — with the lightness flipped per mode so the
// link reads against the page: a soft blue on dark themes, a deep blue on
// light ones (the previous fixed light blue washed out on light backgrounds).
const darkLinkVars = {
  '--card-link': 'oklch(80% 0.09 250)',
  '--card-link-hover': 'oklch(88% 0.05 250)',
}

const lightLinkVars = {
  '--card-link': 'oklch(50% 0.17 250)',
  '--card-link-hover': 'oklch(42% 0.19 250)',
}

function darkVars(p: ThemePalette): ResolvedPalette {
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
    ...darkStatusVars,
    ...darkLinkVars,
  }
}

function lightVars(p: ThemePalette): ResolvedPalette {
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
    ...lightStatusVars,
    ...lightLinkVars,
  }
}

export function paletteToVars(palette: ThemePalette): ResolvedPalette {
  return palette.isDark ? darkVars(palette) : lightVars(palette)
}

// ---------------------------------------------------------------------------
// CSS rendering
// ---------------------------------------------------------------------------

function renderRule(selector: string, vars: ThemeCssVars, comment: string): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`)
  return `/* ${comment} */\n${selector} {\n${lines.join('\n')}\n}\n`
}

// CSS for one named theme. The 'default' theme uses bare `:root` so it
// applies as the fallback when no `data-theme` is set; every other theme
// gates on its attribute selector.
export function generateThemeCss(name: ThemeName): string {
  const selector = name === 'default' ? ':root' : `:root[data-theme="${name}"]`
  return renderRule(selector, paletteToVars(themes[name]), `Theme: ${name}`)
}

// CSS for every registered theme, with 'default' first (it establishes the
// base on bare `:root`) and the rest layered on as attribute-scoped rules.
export function generateAllThemesCss(): string {
  const ordered: ThemeName[] = [
    'default',
    ...themeNames.filter((n): n is ThemeName => n !== 'default'),
  ]
  return ordered.map(generateThemeCss).join('\n')
}

// CSS for an arbitrary custom theme. By default the rule scopes to
// `:root[data-theme="<theme.name>"]`; pass `selector` to override (e.g.
// `:root[data-theme="custom"]` for the in-browser editor's preview slot).
export function generateCustomThemeCss(theme: CustomTheme, selector?: string): string {
  return renderRule(
    selector ?? `:root[data-theme="${theme.name}"]`,
    theme.variables,
    `Custom theme: ${theme.name}`,
  )
}

// ---------------------------------------------------------------------------
// Custom theme JSON parsing
// ---------------------------------------------------------------------------

// Valid custom theme name: lowercase letters/digits/hyphens, starting with a
// letter or digit. Used by the parser to reject malformed names and by the
// editor's download UI to fall back to a safe filename slug.
export const CUSTOM_THEME_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

// Parses an unknown JSON value into a `CustomTheme`. Returns the theme on
// success, or a human-readable error string on failure (matches the project
// parser convention from AGENTS.md).
export function parseCustomTheme(value: unknown): CustomTheme | string {
  if (typeof value !== 'object' || value === null) {
    return 'Custom theme must be a JSON object'
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    return 'Custom theme must have a non-empty `name` string'
  }
  const name = obj.name
  if (!CUSTOM_THEME_NAME_PATTERN.test(name)) {
    return `Custom theme name '${name}' must be lowercase letters, digits, and hyphens (starting with a letter or digit)`
  }
  if (isThemeName(name)) {
    return `Custom theme name '${name}' collides with a built-in theme; pick a different name`
  }
  if (typeof obj.variables !== 'object' || obj.variables === null || Array.isArray(obj.variables)) {
    return 'Custom theme must have a `variables` object'
  }
  const rawVars = obj.variables as Record<string, unknown>
  const variables: ThemeCssVars = {}
  for (const [key, raw] of Object.entries(rawVars)) {
    if (!key.startsWith('--')) {
      return `Variable name '${key}' must start with '--'`
    }
    if (typeof raw !== 'string' || raw.length === 0) {
      return `Variable '${key}' must be a non-empty string value`
    }
    variables[key] = raw
  }
  if (Object.keys(variables).length === 0) {
    return 'Custom theme must define at least one variable'
  }
  const description =
    typeof obj.description === 'string' && obj.description.length > 0 ? obj.description : undefined
  return { name, description, variables }
}

// ---------------------------------------------------------------------------
// Anti-FOUC bootstrap script
// ---------------------------------------------------------------------------

// Inline JavaScript injected into the generated `<head>` so the saved theme
// and any in-progress custom palette are applied *before* the stylesheet
// resolves. Without this, users who saved a non-default theme see a flash of
// the build-time default on every page load.
//
// The localStorage keys here MUST stay in sync with `LS_THEME` and
// `LS_CUSTOM_VARS` in `src/site/useTheme.tsx` — those constants own the
// names; this script reads them.
export const themeBootstrapScript = `
  try {
    var t = localStorage.getItem('ritual:theme');
    if (t && t !== 'custom') document.documentElement.dataset.theme = t;
    var c = localStorage.getItem('ritual:custom-vars');
    if (c) {
      var v = JSON.parse(c);
      var keys = Object.keys(v);
      for (var i = 0; i < keys.length; i++) {
        document.documentElement.style.setProperty(keys[i], v[keys[i]]);
      }
    }
  } catch (e) {}
`

// ---------------------------------------------------------------------------
// Node-only: CLI helpers
// ---------------------------------------------------------------------------

// Resolves a raw CLI `--theme` value to a validated `ThemeName`. Falls back to
// `default` when omitted; logs an error and exits when the value is unknown.
// Centralised here so `build-site` and `admin` share identical handling.
//
// NOTE: uses `process.exit` — CLI-only. Do not call from SPA code.
export function resolveThemeName(raw: string | undefined): ThemeName {
  const normalized = (raw ?? 'default').toLowerCase()
  if (isThemeName(normalized)) return normalized
  console.error(`Unknown theme '${raw}'. Choose one of: ${themeNames.join(', ')}.`)
  process.exit(1)
}
