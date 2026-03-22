import { describe, expect, test } from 'bun:test'
import { formatEntry } from '../../../src/commands/dep-license'
import { depLicenses, type DepLicenseEntry } from '../../../src/generated/dep-licenses'

describe('depLicenses', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(depLicenses)).toBeTrue()
    expect(depLicenses.length).toBeGreaterThan(0)
  })

  test('all entries have required fields', () => {
    for (const entry of depLicenses) {
      expect(typeof entry.name).toBe('string')
      expect(typeof entry.version).toBe('string')
      expect(typeof entry.license).toBe('string')
      expect(typeof entry.isPrimary).toBe('boolean')
      expect(entry.text === null || typeof entry.text === 'string').toBeTrue()
    }
  })

  test('has at least one primary entry', () => {
    const primaries = depLicenses.filter((e) => e.isPrimary)
    expect(primaries.length).toBeGreaterThan(0)
  })

  test('commander is a primary dependency', () => {
    const commander = depLicenses.find((e) => e.name === 'commander')
    expect(commander).toBeDefined()
    expect(commander?.isPrimary).toBeTrue()
    expect(commander?.license).toBe('MIT')
  })

  test('primary entries appear before transitive entries', () => {
    const firstTransitiveIndex = depLicenses.findIndex((e) => !e.isPrimary)
    if (firstTransitiveIndex === -1) return // all primary, fine
    for (let i = firstTransitiveIndex; i < depLicenses.length; i++) {
      expect(depLicenses[i]!.isPrimary).toBeFalse()
    }
  })
})

describe('formatEntry', () => {
  test('produces header with name, version, and license', () => {
    const entry: DepLicenseEntry = {
      name: 'test-pkg',
      version: '1.2.3',
      license: 'MIT',
      text: 'MIT License text here',
      isPrimary: true,
    }
    const result = formatEntry(entry)
    expect(result).toContain('test-pkg v1.2.3 — MIT')
    expect(result).toContain('MIT License text here')
  })

  test('shows fallback message when text is null', () => {
    const entry: DepLicenseEntry = {
      name: 'no-license-pkg',
      version: '0.1.0',
      license: 'Apache-2.0',
      text: null,
      isPrimary: false,
    }
    const result = formatEntry(entry)
    expect(result).toContain('no-license-pkg v0.1.0 — Apache-2.0')
    expect(result).toContain('SPDX identifier: Apache-2.0')
  })
})
