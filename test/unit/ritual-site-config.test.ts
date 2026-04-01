import { describe, expect, test } from 'bun:test'
import { parseRitualSiteConfig } from '../../src/ritual-site-config'

describe('parseRitualSiteConfig', () => {
  test('parses valid github-actions publish-for-me config', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({
        version: '0.1.0',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: false,
      }),
    )
    expect(result).toEqual({
      version: '0.1.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: false,
    })
  })

  test('parses valid github-actions local-build config', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({
        version: '0.2.0-beta1',
        ciSystem: 'github-actions',
        deployMode: 'local-build',
        distDir: 'public',
        detectChanges: false,
      }),
    )
    expect(result).toEqual({
      version: '0.2.0-beta1',
      ciSystem: 'github-actions',
      deployMode: 'local-build',
      distDir: 'public',
      detectChanges: false,
    })
  })

  test('parses valid manual config', () => {
    const result = parseRitualSiteConfig(JSON.stringify({ version: '1.0.0', ciSystem: 'manual' }))
    expect(result).toEqual({ version: '1.0.0', ciSystem: 'manual' })
  })

  test('returns error string for invalid JSON', () => {
    const result = parseRitualSiteConfig('not json')
    expect(typeof result).toBe('string')
    expect(result as string).toContain('Invalid JSON')
  })

  test('returns error string when not an object', () => {
    const result = parseRitualSiteConfig('"just a string"')
    expect(typeof result).toBe('string')
  })

  test('returns error string when version is not valid semver', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({
        version: 'latest',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
      }),
    )
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"version"')
  })

  test('returns error string when version is missing', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({ ciSystem: 'github-actions', deployMode: 'publish-for-me', distDir: 'dist' }),
    )
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"version"')
  })

  test('returns error string when ciSystem is missing', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({ version: '1.0.0', deployMode: 'publish-for-me', distDir: 'dist' }),
    )
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"ciSystem"')
  })

  test('returns error string when ciSystem is invalid', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({
        version: '1.0.0',
        ciSystem: 'gitlab',
        deployMode: 'publish-for-me',
        distDir: 'dist',
      }),
    )
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"ciSystem"')
  })

  test('returns error string when deployMode is invalid for github-actions', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({
        version: '1.0.0',
        ciSystem: 'github-actions',
        deployMode: 'invalid',
        distDir: 'dist',
      }),
    )
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"deployMode"')
  })

  test('returns error string when distDir is missing for github-actions', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({
        version: '1.0.0',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
      }),
    )
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"distDir"')
  })

  test('ignores extra unknown fields for github-actions config', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({
        version: '1.0.0',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: false,
        unknown: 'field',
      }),
    )
    expect(result).toEqual({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: false,
    })
  })

  test('ignores extra unknown fields for manual config', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({ version: '1.0.0', ciSystem: 'manual', unknown: 'field' }),
    )
    expect(result).toEqual({ version: '1.0.0', ciSystem: 'manual' })
  })

  test('parses detectChanges for github-actions config', () => {
    const result = parseRitualSiteConfig(
      JSON.stringify({
        version: '1.0.0',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: true,
      }),
    )
    expect(result).toEqual({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: true,
    })

    const resultFalse = parseRitualSiteConfig(
      JSON.stringify({
        version: '1.0.0',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: false,
      }),
    )
    expect(resultFalse).toEqual({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: false,
    })
  })
})
