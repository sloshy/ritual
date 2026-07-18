import { describe, expect, test } from 'bun:test'
import {
  formatDepLicenseList,
  formatEntry,
  toDepLicenseListEntries,
} from '../../../src/commands/dep-license'
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

describe('formatDepLicenseList', () => {
  const entries: DepLicenseEntry[] = [
    { name: 'trans-pkg', version: '2.0.0', license: 'ISC', text: null, isPrimary: false },
    { name: 'main-pkg', version: '1.2.3', license: 'MIT', text: 'MIT text', isPrimary: true },
  ]

  test('groups primary before transitive with name version license lines', () => {
    const result = formatDepLicenseList(entries)
    expect(result).toBe('Primary:\n  main-pkg 1.2.3 MIT\nTransitive:\n  trans-pkg 2.0.0 ISC')
  })

  test('lists commander under Primary for the real dependency set', () => {
    const result = formatDepLicenseList(depLicenses)
    const transitiveAt = result.indexOf('Transitive:')
    const commanderAt = result.indexOf('\n  commander ')
    expect(commanderAt).toBeGreaterThan(-1)
    expect(commanderAt).toBeLessThan(transitiveAt)
  })
})

describe('toDepLicenseListEntries', () => {
  test('projects entries without the license text field', () => {
    const entries = toDepLicenseListEntries(depLicenses)
    const commander = entries.find((e) => e.name === 'commander')
    expect(commander).toBeDefined()
    expect(commander?.isPrimary).toBeTrue()
    expect(commander?.license).toBe('MIT')
    expect(commander?.version.length).toBeGreaterThan(0)
    // The huge bundled license text must not leak into the list payload.
    for (const entry of entries) {
      expect('text' in entry).toBe(false)
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
