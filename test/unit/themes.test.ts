import { describe, test, expect } from 'bun:test'
import {
  generateAllThemesCss,
  generateCustomThemeCss,
  generateThemeCss,
  isThemeName,
  paletteToVars,
  parseCustomTheme,
  resolveThemeName,
  themeNames,
  themes,
} from '../../src/theme/themes'
import { localeTag } from '../../src/i18n/locale-tag'
import { isMessageParseError, renderSyncMessage, type SyncMessage } from '../../src/sync/message'
import { expectLocaleInForce, foreignLocales, withSyntheticLocale } from '../helpers/sync-text'

const GUILDS = [
  'orzhov',
  'izzet',
  'gruul',
  'rakdos',
  'selesnya',
  'azorius',
  'boros',
  'dimir',
  'simic',
  'golgari',
] as const

describe('themes registry', () => {
  test('isThemeName rejects unknown themes', () => {
    expect(isThemeName('thrull')).toBe(false)
    expect(isThemeName('Default')).toBe(false) // case sensitive
    expect(isThemeName('')).toBe(false)
    expect(isThemeName('izzet inverted')).toBe(false)
  })
})

describe('resolveThemeName', () => {
  test('returns the name when it is a registered theme', () => {
    expect(resolveThemeName('izzet')).toBe('izzet')
    expect(resolveThemeName('boros-inverted')).toBe('boros-inverted')
  })

  test('lowercases the input before validating', () => {
    expect(resolveThemeName('GRUUL')).toBe('gruul')
    expect(resolveThemeName('Selesnya-Inverted')).toBe('selesnya-inverted')
  })

  test('falls back to default when input is undefined', () => {
    expect(resolveThemeName(undefined)).toBe('default')
  })

  test('refuses an unknown theme, naming it as typed and offering the built-ins', () => {
    const refusal = resolveThemeName('NOT-A-Theme')
    if (!isMessageParseError(refusal)) throw new Error('expected a refusal')
    expect(refusal.error.messageKey).toBe('cli.theme.unknown')
    expect(refusal.error.messageParams).toEqual({
      value: 'NOT-A-Theme',
      choices: { list: [...themeNames], join: 'unit' },
    })
    expect(refusal.error.message).toStartWith(
      "Unknown theme 'NOT-A-Theme'. Choose one of: default, default-inverted, orzhov, ",
    )
  })

  test("offers the caller's other accepted names after the built-ins", () => {
    const refusal = resolveThemeName('nope', ['sunset', 'dusk'])
    if (!isMessageParseError(refusal)) throw new Error('expected a refusal')
    expect(refusal.error.messageParams).toEqual({
      value: 'nope',
      choices: { list: [...themeNames, 'sunset', 'dusk'], join: 'unit' },
    })
    expect(refusal.error.message).toEndWith('golgari-inverted, sunset, dusk.')
  })

  test("the offered themes are joined by the reader's locale, not spliced as English", () => {
    const refusal = resolveThemeName('nope')
    if (!isMessageParseError(refusal)) throw new Error('expected a refusal')
    const german = renderSyncMessage(refusal.error, localeTag('de'))
    expect(german).toContain('golgari und golgari-inverted')
    expect(refusal.error.message).toContain('golgari, golgari-inverted')
  })
})

describe('generateThemeCss', () => {
  test('the default theme uses the bare :root selector', () => {
    expect(generateThemeCss('default')).toMatch(/:root \{/)
    expect(generateThemeCss('default')).not.toContain('data-theme')
  })

  test('non-default themes use a data-theme attribute selector', () => {
    expect(generateThemeCss('izzet')).toContain(':root[data-theme="izzet"] {')
    expect(generateThemeCss('boros-inverted')).toContain(':root[data-theme="boros-inverted"] {')
  })

  test('includes the theme name in a leading comment', () => {
    expect(generateThemeCss('izzet')).toMatch(/^\/\* Theme: izzet \*\//)
    expect(generateThemeCss('izzet-inverted')).toMatch(/^\/\* Theme: izzet-inverted \*\//)
  })

  test('inverted output differs from non-inverted output for every guild', () => {
    for (const guild of GUILDS) {
      expect(generateThemeCss(guild)).not.toBe(generateThemeCss(`${guild}-inverted`))
    }
    expect(generateThemeCss('default')).not.toBe(generateThemeCss('default-inverted'))
  })

  test('flips the foil blend mode by mode so the sheen reads on both', () => {
    // screen lightens (great on dark rows, invisible on near-white); multiply
    // darkens (visible on light rows). Each theme must pick the one that shows.
    for (const name of themeNames) {
      const css = generateThemeCss(name)
      const expectedBlend = themes[name].isDark ? 'screen' : 'multiply'
      expect(css).toContain(`--foil-blend: ${expectedBlend};`)
      expect(css).toContain('--foil-opacity:')
      expect(css).toContain('--foil-opacity-hover:')
    }
  })

  test('hues the any-printing tag to the theme accent, light enough for the scrim', () => {
    for (const name of themeNames) {
      const css = generateThemeCss(name)
      const match = /--label-any-printing: oklch\((\d+)% [\d.]+ ([\d.]+)\);/.exec(css)
      expect(match).not.toBeNull()
      // Drawn on the dark overlay in both modes, so lightness never follows isDark.
      expect(Number(match![1])).toBeGreaterThanOrEqual(80)
      expect(Number(match![2])).toBe(themes[name].accentHue)
    }
    // default (violet) and izzet (red) accents produce different tags.
    expect(generateThemeCss('izzet')).not.toContain(
      /--label-any-printing: [^;]+/.exec(generateThemeCss('default'))![0],
    )
  })

  test('emits all six app-icon flame stops, hued to the theme accent', () => {
    // flameVars passes accentHue straight through for every theme; one
    // saturated accent (izzet) and one near-neutral (orzhov) exercise both
    // chroma-scaling paths without looping the whole registry.
    for (const name of ['izzet', 'orzhov'] as const) {
      const css = generateThemeCss(name)
      const accentHue = themes[name].accentHue
      for (const stop of [
        '--flame-outer-1',
        '--flame-outer-2',
        '--flame-outer-3',
        '--flame-inner-1',
        '--flame-inner-2',
        '--flame-inner-3',
      ]) {
        const m = css.match(new RegExp(`${stop}: oklch\\(([^)]+)\\);`))
        expect(m, `${name} should define ${stop}`).not.toBeNull()
        const hue = Number(m![1]!.trim().split(/\s+/)[2])
        expect(hue, `${name} ${stop} hue`).toBe(accentHue)
      }
    }
  })

  test('produces only valid oklch() values', () => {
    for (const name of themeNames) {
      const css = generateThemeCss(name)
      const matches = css.matchAll(/oklch\(([^)]+)\)/g)
      for (const m of matches) {
        const parts = m[1]!.trim().split(/\s+/)
        // Either `L C H` or `L C H / A` (the status fills carry an alpha).
        expect([3, 5]).toContain(parts.length)
        expect(parts[0]).toMatch(/^[0-9]+(\.[0-9]+)?%$/)
        expect(parts[1]).toMatch(/^[0-9]+(\.[0-9]+)?$/)
        expect(parts[2]).toMatch(/^[0-9]+(\.[0-9]+)?$/)
        if (parts.length === 5) {
          expect(parts[3]).toBe('/')
          expect(parts[4]).toMatch(/^[0-9]+(\.[0-9]+)?$/)
        }
      }
    }
  })
})

describe('paletteToVars flame stops', () => {
  test('caps flame chroma at 0.3 for very saturated accents', () => {
    // The largest flame chroma multiplier is 1.35 (inner-3); no registered
    // theme reaches the cap (max accentChroma 0.2 → 0.27), so exercise it with
    // a synthetic over-saturated palette.
    const vars = paletteToVars({
      bgHue: 285,
      bgChroma: 0.02,
      isDark: true,
      accentHue: 290,
      accentChroma: 0.25,
    })
    const chromaOf = (v: string): number => Number(v.match(/oklch\([^ ]+ ([^ ]+) /)![1])
    expect(chromaOf(vars['--flame-inner-3'])).toBe(0.3)
    expect(chromaOf(vars['--flame-outer-1'])).toBeLessThanOrEqual(0.3)
  })
})

describe('generateAllThemesCss', () => {
  test('emits a rule for every registered theme', () => {
    const css = generateAllThemesCss()
    for (const name of themeNames) {
      if (name === 'default') {
        expect(css).toMatch(/\/\* Theme: default \*\/\n:root \{/)
      } else {
        expect(css).toContain(`:root[data-theme="${name}"] {`)
      }
    }
  })

  test('emits the default theme first so it establishes the baseline', () => {
    const css = generateAllThemesCss()
    const defaultIdx = css.indexOf('/* Theme: default */')
    const orzhovIdx = css.indexOf('/* Theme: orzhov */')
    expect(defaultIdx).toBeGreaterThanOrEqual(0)
    expect(orzhovIdx).toBeGreaterThan(defaultIdx)
  })
})

describe('generateCustomThemeCss', () => {
  test('renders a custom theme as an attribute selector by default', () => {
    const css = generateCustomThemeCss({
      name: 'mine',
      variables: { '--bg-body': 'oklch(20% 0.02 200)', '--accent': 'oklch(60% 0.15 30)' },
    })
    expect(css).toContain(':root[data-theme="mine"] {')
    expect(css).toContain('--bg-body: oklch(20% 0.02 200)')
    expect(css).toContain('--accent: oklch(60% 0.15 30)')
  })

  test('accepts a custom selector for the editor preview slot', () => {
    const css = generateCustomThemeCss(
      { name: 'preview', variables: { '--accent': 'oklch(50% 0.1 0)' } },
      ':root[data-theme="custom"]',
    )
    expect(css).toContain(':root[data-theme="custom"] {')
    expect(css).toContain('--accent: oklch(50% 0.1 0)')
  })
})

describe('the baked custom-theme stylesheet', () => {
  test.each(foreignLocales())('is byte-identical under $tag', ({ tag, catalog }) => {
    const theme = { name: 'mine', variables: { '--accent': 'oklch(50% 0.1 0)' } }
    const english = generateCustomThemeCss(theme)
    expect(english).toStartWith('/* Custom theme: mine */')
    withSyntheticLocale(tag, catalog, (locale) => {
      expectLocaleInForce(locale)
      expect(generateCustomThemeCss(theme)).toBe(english)
    })
  })
})

describe('parseCustomTheme', () => {
  test('accepts a minimal valid theme', () => {
    const result = parseCustomTheme({
      name: 'my-theme',
      variables: { '--bg-body': 'oklch(20% 0.02 260)' },
    })
    expect(result).toEqual({
      name: 'my-theme',
      description: undefined,
      variables: { '--bg-body': 'oklch(20% 0.02 260)' },
    })
  })

  test('captures a description when provided', () => {
    const result = parseCustomTheme({
      name: 'my-theme',
      description: 'a custom palette',
      variables: { '--accent': 'oklch(50% 0.15 200)' },
    })
    expect(result).toMatchObject({ description: 'a custom palette' })
  })

  const ACCENT = { '--accent': 'oklch(50% 0 0)' }

  /** Each refusal, its message as the catalog keys it, and the English it has always been. */
  const REFUSALS: readonly (readonly [string, unknown, SyncMessage])[] = [
    [
      'null',
      null,
      {
        message: 'Custom theme must be a JSON object',
        messageKey: 'site.theme.file.notObject',
      },
    ],
    [
      'a string',
      'hello',
      {
        message: 'Custom theme must be a JSON object',
        messageKey: 'site.theme.file.notObject',
      },
    ],
    [
      'a non-string name',
      { name: 5, variables: ACCENT },
      {
        message: 'Custom theme must have a non-empty `name` string',
        messageKey: 'site.theme.file.nameMissing',
      },
    ],
    [
      'an empty name',
      { name: '', variables: ACCENT },
      {
        message: 'Custom theme must have a non-empty `name` string',
        messageKey: 'site.theme.file.nameMissing',
      },
    ],
    [
      'a built-in name',
      { name: 'boros', variables: ACCENT },
      {
        message: "Custom theme name 'boros' collides with a built-in theme; pick a different name",
        messageKey: 'site.theme.file.nameBuiltIn',
        messageParams: { name: 'boros' },
      },
    ],
    [
      'a malformed name',
      { name: 'My Theme', variables: ACCENT },
      {
        message:
          "Custom theme name 'My Theme' must be lowercase letters, digits, and hyphens (starting with a letter or digit)",
        messageKey: 'site.theme.file.nameMalformed',
        messageParams: { name: 'My Theme' },
      },
    ],
    [
      'a variable without the -- prefix',
      { name: 'mine', variables: { 'bg-body': 'oklch(20% 0 0)' } },
      {
        message: "Variable name 'bg-body' must start with '--'",
        messageKey: 'site.theme.file.variableName',
        messageParams: { name: 'bg-body' },
      },
    ],
    [
      'an empty variable value',
      { name: 'mine', variables: { '--accent': '' } },
      {
        message: "Variable '--accent' must be a non-empty string value",
        messageKey: 'site.theme.file.variableValue',
        messageParams: { name: '--accent' },
      },
    ],
    [
      'an empty variables object',
      { name: 'mine', variables: {} },
      {
        message: 'Custom theme must define at least one variable',
        messageKey: 'site.theme.file.variablesEmpty',
      },
    ],
    [
      'absent variables',
      { name: 'mine' },
      {
        message: 'Custom theme must have a `variables` object',
        messageKey: 'site.theme.file.variablesMissing',
      },
    ],
    [
      'null variables',
      { name: 'mine', variables: null },
      {
        message: 'Custom theme must have a `variables` object',
        messageKey: 'site.theme.file.variablesMissing',
      },
    ],
    [
      'a non-string variable value',
      { name: 'mine', variables: { '--accent': 4 } },
      {
        message: "Variable '--accent' must be a non-empty string value",
        messageKey: 'site.theme.file.variableValue',
        messageParams: { name: '--accent' },
      },
    ],
    [
      'an array of variables',
      { name: 'mine', variables: ['--bg-body: red'] },
      {
        message: 'Custom theme must have a `variables` object',
        messageKey: 'site.theme.file.variablesMissing',
      },
    ],
  ]

  test.each(REFUSALS)('refuses %s', (_label, input, refusal) => {
    expect(parseCustomTheme(input)).toEqual({ error: refusal })
  })
})
