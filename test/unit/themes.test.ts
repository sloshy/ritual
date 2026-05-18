import { describe, test, expect, mock } from 'bun:test'
import {
  generateAllThemesCss,
  generateCustomThemeCss,
  generateThemeCss,
  isThemeName,
  parseCustomTheme,
  resolveThemeName,
  themeNames,
  themes,
} from '../../src/themes'

const REQUIRED_VARS = [
  '--bg-body',
  '--bg-panel',
  '--bg-hover',
  '--bg-active',
  '--bg-subtle',
  '--border',
  '--border-hover',
  '--border-focus',
  '--border-separator',
  '--text-primary',
  '--text-body',
  '--text-secondary',
  '--text-muted',
  '--text-dim',
  '--text-accent',
  '--accent',
  '--accent-hover',
  '--accent-dim',
  '--btn-bg',
  '--btn-hover',
  '--btn-text',
  '--btn-primary',
  '--btn-primary-hover',
  '--btn-export',
  '--btn-export-hover',
  '--btn-on-color-text',
] as const

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
  test('exposes the default theme plus every guild and its inverted variant', () => {
    const expected: string[] = ['default', 'default-inverted']
    for (const guild of GUILDS) {
      expected.push(guild)
      expected.push(`${guild}-inverted`)
    }
    expect(new Set<string>(themeNames)).toEqual(new Set(expected))
  })

  test('every registered theme has a complete palette', () => {
    for (const name of themeNames) {
      const palette = themes[name]
      expect(typeof palette.bgHue).toBe('number')
      expect(typeof palette.bgChroma).toBe('number')
      expect(typeof palette.isDark).toBe('boolean')
      expect(typeof palette.accentHue).toBe('number')
      expect(typeof palette.accentChroma).toBe('number')
    }
  })

  test('isThemeName accepts every registered theme', () => {
    for (const name of themeNames) {
      expect(isThemeName(name)).toBe(true)
    }
  })

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

  test('exits with an error when the theme is unknown', () => {
    const exitMock = mock((_code?: number): never => {
      throw new Error('process.exit called')
    })
    const errorMock = mock(() => {})
    const originalExit = process.exit
    const originalError = console.error
    process.exit = exitMock
    console.error = errorMock
    try {
      expect(() => resolveThemeName('not-a-theme')).toThrow('process.exit called')
      expect(exitMock).toHaveBeenCalledWith(1)
      expect(errorMock).toHaveBeenCalledTimes(1)
      const firstCall = errorMock.mock.calls[0] as unknown as unknown[]
      const message = String(firstCall[0])
      expect(message).toContain("'not-a-theme'")
      expect(message).toContain('default')
    } finally {
      process.exit = originalExit
      console.error = originalError
    }
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

  for (const name of themeNames) {
    test(`emits all required variables for ${name}`, () => {
      const css = generateThemeCss(name)
      for (const variable of REQUIRED_VARS) {
        expect(css).toContain(`${variable}:`)
      }
    })
  }

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

  test('produces only valid oklch() values', () => {
    for (const name of themeNames) {
      const css = generateThemeCss(name)
      const matches = css.matchAll(/oklch\(([^)]+)\)/g)
      for (const m of matches) {
        const parts = m[1]!.trim().split(/\s+/)
        expect(parts.length).toBe(3)
        expect(parts[0]).toMatch(/^[0-9]+(\.[0-9]+)?%$/)
        expect(parts[1]).toMatch(/^[0-9]+(\.[0-9]+)?$/)
        expect(parts[2]).toMatch(/^[0-9]+(\.[0-9]+)?$/)
      }
    }
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

describe('parseCustomTheme', () => {
  test('accepts a minimal valid theme', () => {
    const result = parseCustomTheme({
      name: 'my-theme',
      variables: { '--bg-body': 'oklch(20% 0.02 260)' },
    })
    expect(typeof result).toBe('object')
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
    expect(typeof result).toBe('object')
    if (typeof result === 'string') return
    expect(result.description).toBe('a custom palette')
  })

  test('rejects non-object input', () => {
    expect(parseCustomTheme(null)).toContain('JSON object')
    expect(parseCustomTheme('hello')).toContain('JSON object')
    expect(parseCustomTheme(42)).toContain('JSON object')
  })

  test('rejects an empty name', () => {
    expect(parseCustomTheme({ name: '', variables: { '--accent': 'oklch(50% 0 0)' } })).toContain(
      'name',
    )
  })

  test('rejects names that collide with built-ins', () => {
    expect(
      parseCustomTheme({
        name: 'boros',
        variables: { '--accent': 'oklch(50% 0 0)' },
      }),
    ).toContain('built-in')
  })

  test('rejects invalid name characters', () => {
    expect(
      parseCustomTheme({
        name: 'My Theme',
        variables: { '--accent': 'oklch(50% 0 0)' },
      }),
    ).toContain('lowercase')
  })

  test('rejects variables without the -- prefix', () => {
    expect(
      parseCustomTheme({
        name: 'mine',
        variables: { 'bg-body': 'oklch(20% 0 0)' },
      }),
    ).toContain('--')
  })

  test('rejects empty variables object', () => {
    expect(parseCustomTheme({ name: 'mine', variables: {} })).toContain('at least one variable')
  })

  test('rejects array values for `variables`', () => {
    expect(parseCustomTheme({ name: 'mine', variables: [] })).toContain('object')
    expect(parseCustomTheme({ name: 'mine', variables: ['--bg-body: red'] })).toContain('object')
  })
})
