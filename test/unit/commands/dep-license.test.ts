import { describe, expect, test } from 'bun:test'
import { formatEntry } from '../../../src/commands/dep-license'
import { depLicenses, type DepLicenseEntry } from '../../../src/generated/dep-licenses'

describe('depLicenses', () => {
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
