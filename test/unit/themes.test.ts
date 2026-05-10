import { describe, test, expect, mock } from 'bun:test'
import {
  generateThemeCss,
  isThemeName,
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
    process.exit = exitMock as unknown as typeof process.exit
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
  for (const name of themeNames) {
    test(`emits all required variables for ${name}`, () => {
      const css = generateThemeCss(name)
      expect(css).toContain(':root {')
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
