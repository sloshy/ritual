import { describe, expect, test } from 'bun:test'
import { applyConfigSet } from '../../../src/commands/config-set'
import { getDefaultRitualConfig } from '../../../src/ritual-config'

const base = getDefaultRitualConfig()

describe('applyConfigSet — unknown / blocked properties', () => {
  test('returns error for unknown property', () => {
    const result = applyConfigSet(base, 'unknownProp', ['value'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('Unknown property')
      expect(result.error).toContain('unknownProp')
    }
  })

  test('includes available property list in error', () => {
    const result = applyConfigSet(base, 'notReal', ['x'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('decksDir')
      expect(result.error).toContain('admin.gitEnabled')
    }
  })

  test('blocks "site" property', () => {
    const result = applyConfigSet(base, 'site', ['{}'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('"site"')
      expect(result.error).toContain('init-site')
    }
  })

  test('blocks "site.*" deployment paths', () => {
    const result = applyConfigSet(base, 'site.ciSystem', ['github-actions'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('"site"')
    }
  })

  test('returns error when no values are provided', () => {
    const result = applyConfigSet(base, 'decksDir', [], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toBe('At least one value must be provided.')
    }
  })
})

describe('applyConfigSet — site selection lists', () => {
  test('replaces site.includeDecks', () => {
    const result = applyConfigSet(base, 'site.includeDecks', ['Izzet Storm'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['Izzet Storm'])
      expect(result.updatedConfig.site?.includeDecks).toEqual(['Izzet Storm'])
    }
  })

  test('sets the reserved wildcard value', () => {
    const result = applyConfigSet(base, 'site.includeCollections', ['*'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.updatedConfig.site?.includeCollections).toEqual(['*'])
    }
  })

  test('adds to an existing site.includeWantedLists', () => {
    const seeded = applyConfigSet(base, 'site.includeWantedLists', ['A'], 'replace')
    expect('error' in seeded).toBeFalse()
    if ('error' in seeded) {
      throw new Error(`seed setup failed: ${seeded.error}`)
    }
    const result = applyConfigSet(seeded.updatedConfig, 'site.includeWantedLists', ['B'], 'add')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.updatedConfig.site?.includeWantedLists).toEqual(['A', 'B'])
    }
  })

  test('preserves existing deployment settings when setting a selection list', () => {
    const withSite: typeof base = {
      ...base,
      site: {
        version: '1.0.0',
        ciSystem: 'manual',
        includeDecks: ['*'],
        includeCollections: ['*'],
        includeWantedLists: ['*'],
        excludeDecks: [],
        excludeCollections: [],
        excludeWantedLists: [],
      },
    }
    const result = applyConfigSet(withSite, 'site.includeDecks', ['Atraxa'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.updatedConfig.site?.includeDecks).toEqual(['Atraxa'])
      expect(result.updatedConfig.site?.version).toBe('1.0.0')
      expect(result.updatedConfig.site?.ciSystem).toBe('manual')
    }
  })

  test('replaces site.excludeDecks', () => {
    const result = applyConfigSet(base, 'site.excludeDecks', ['Old Brew'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['Old Brew'])
      expect(result.updatedConfig.site?.excludeDecks).toEqual(['Old Brew'])
    }
  })

  test('adds to and removes from site.excludeCollections', () => {
    const seeded = applyConfigSet(base, 'site.excludeCollections', ['A', 'B'], 'replace')
    expect('error' in seeded).toBeFalse()
    if ('error' in seeded) {
      throw new Error(`seed setup failed: ${seeded.error}`)
    }
    const removed = applyConfigSet(seeded.updatedConfig, 'site.excludeCollections', ['A'], 'remove')
    expect('error' in removed).toBeFalse()
    if (!('error' in removed)) {
      expect(removed.updatedConfig.site?.excludeCollections).toEqual(['B'])
    }
  })

  test('removes a value from site.includeDecks', () => {
    const seeded = applyConfigSet(base, 'site.includeDecks', ['Atraxa', 'Izzet Storm'], 'replace')
    expect('error' in seeded).toBeFalse()
    if ('error' in seeded) {
      throw new Error(`seed setup failed: ${seeded.error}`)
    }
    const result = applyConfigSet(seeded.updatedConfig, 'site.includeDecks', ['Atraxa'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.updatedConfig.site?.includeDecks).toEqual(['Izzet Storm'])
    }
  })
})

describe('applyConfigSet — site.bannedPrintings', () => {
  test('normalizes set codes to lowercase on replace', () => {
    const result = applyConfigSet(base, 'site.bannedPrintings', ['SLD:123', 'MH2:42'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['sld:123', 'mh2:42'])
      expect(result.updatedConfig.site?.bannedPrintings).toEqual(['sld:123', 'mh2:42'])
    }
  })

  test('--remove matches a stored key regardless of input case', () => {
    const seeded = applyConfigSet(base, 'site.bannedPrintings', ['sld:123', 'mh2:42'], 'replace')
    expect('error' in seeded).toBeFalse()
    if ('error' in seeded) throw new Error(`seed setup failed: ${seeded.error}`)
    const result = applyConfigSet(
      seeded.updatedConfig,
      'site.bannedPrintings',
      ['SLD:123'],
      'remove',
    )
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.updatedConfig.site?.bannedPrintings).toEqual(['mh2:42'])
    }
  })

  test('rejects an entry without a collector number', () => {
    const result = applyConfigSet(base, 'site.bannedPrintings', ['sld'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('SET:COLLECTOR')
    }
  })
})

describe('applyConfigSet — string properties', () => {
  test.each([
    ['decksDir', './my-decks'],
    ['collectionsDir', '/abs/path'],
    ['wantedDir', './wanted'],
  ] as const)('sets string property %s', (key, value) => {
    const result = applyConfigSet(base, key, [value], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(value)
      expect(result.updatedConfig[key]).toBe(value)
    }
  })

  test('returns error when multiple values given for string property', () => {
    const result = applyConfigSet(base, 'decksDir', ['./a', './b'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('string')
      expect(result.error).toContain('2')
    }
  })

  test('returns error when --add used with string property', () => {
    const result = applyConfigSet(base, 'decksDir', ['./x'], 'add')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('--add')
      expect(result.error).toContain('array')
    }
  })

  test('returns error when --remove used with string property', () => {
    const result = applyConfigSet(base, 'decksDir', ['./x'], 'remove')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('--remove')
    }
  })
})

describe('applyConfigSet — boolean properties', () => {
  test.each([
    ['true', true],
    ['TRUE', true],
    ['True', true],
    ['false', false],
    ['FALSE', false],
    ['False', false],
  ] as const)('parses %s as %s (case-insensitive)', (input, expected) => {
    const config = { ...base, admin: { ...base.admin, gitEnabled: !expected } }
    const result = applyConfigSet(config, 'admin.gitEnabled', [input], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(expected)
      expect(result.updatedConfig.admin.gitEnabled).toBe(expected)
    }
  })

  test('preserves sibling admin fields when setting one', () => {
    const config = { ...base, admin: { ...base.admin, gitAutoCommit: true } }
    const result = applyConfigSet(config, 'admin.gitEnabled', ['true'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.updatedConfig.admin.gitEnabled).toBe(true)
      expect(result.updatedConfig.admin.gitAutoCommit).toBe(true)
    }
  })

  test.each([
    ['admin.rateLimitEnabled sets to true', 'true' as const, true],
    ['admin.rateLimitEnabled sets to false', 'false' as const, false],
  ])('%s', (_label, input, expected) => {
    const config = { ...base, admin: { ...base.admin, rateLimitEnabled: !expected } }
    const result = applyConfigSet(config, 'admin.rateLimitEnabled', [input], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(expected)
      expect(result.updatedConfig.admin.rateLimitEnabled).toBe(expected)
    }
  })

  test('returns error for non-boolean value', () => {
    const result = applyConfigSet(base, 'admin.gitEnabled', ['yes'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('boolean')
      expect(result.error).toContain('"true" or "false"')
      expect(result.error).toContain('"yes"')
    }
  })

  test('returns error when multiple values given for boolean property', () => {
    const result = applyConfigSet(base, 'admin.gitEnabled', ['true', 'false'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('boolean')
      expect(result.error).toContain('2')
    }
  })

  test('returns error when --add used with boolean property', () => {
    const result = applyConfigSet(base, 'admin.gitEnabled', ['true'], 'add')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('--add')
    }
  })
})

describe('applyConfigSet — number properties', () => {
  test('sets a number property', () => {
    const result = applyConfigSet(base, 'admin.rateLimitMaxAttempts', ['10'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(10)
      expect(result.updatedConfig.admin.rateLimitMaxAttempts).toBe(10)
    }
  })

  test('accepts zero for admin.failedAuthDelayMs', () => {
    const result = applyConfigSet(base, 'admin.failedAuthDelayMs', ['0'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(0)
    }
  })

  test('returns error for non-numeric string', () => {
    const result = applyConfigSet(base, 'admin.rateLimitMaxAttempts', ['abc'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('number')
      expect(result.error).toContain('"abc"')
    }
  })

  test('returns error for empty string (Number("") would be 0 without guard)', () => {
    const result = applyConfigSet(base, 'admin.rateLimitMaxAttempts', [''], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('empty string')
    }
  })

  test('returns error for float value', () => {
    const result = applyConfigSet(base, 'admin.rateLimitMaxAttempts', ['1.5'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('integer')
    }
  })

  test('returns error for negative value', () => {
    const result = applyConfigSet(base, 'admin.rateLimitMaxAttempts', ['-1'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('non-negative')
    }
  })

  test('returns error when multiple values given for number property', () => {
    const result = applyConfigSet(base, 'admin.rateLimitMaxAttempts', ['5', '10'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('number')
      expect(result.error).toContain('2')
    }
  })

  test('returns error when --remove used with number property', () => {
    const result = applyConfigSet(base, 'admin.rateLimitWindowMinutes', ['5'], 'remove')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('--remove')
    }
  })
})

describe('applyConfigSet — array properties (replace)', () => {
  test('replaces array with new values', () => {
    const config = { ...base, admin: { ...base.admin, ipAllowList: ['10.0.0.1'] } }
    const result = applyConfigSet(
      config,
      'admin.ipAllowList',
      ['192.168.1.1', '192.168.1.2'],
      'replace',
    )
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['192.168.1.1', '192.168.1.2'])
      expect(result.updatedConfig.admin.ipAllowList).toEqual(['192.168.1.1', '192.168.1.2'])
    }
  })

  test('deduplicates values on replace', () => {
    const result = applyConfigSet(
      base,
      'admin.ipAllowList',
      ['1.2.3.4', '1.2.3.4', '5.6.7.8'],
      'replace',
    )
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['1.2.3.4', '5.6.7.8'])
    }
  })

  test('can set a single value replacing previous array', () => {
    const config = { ...base, admin: { ...base.admin, ipAllowList: ['10.0.0.1', '10.0.0.2'] } }
    const result = applyConfigSet(config, 'admin.ipAllowList', ['192.168.0.1'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['192.168.0.1'])
    }
  })
})

describe('applyConfigSet — array properties (add)', () => {
  test('appends new values to existing array', () => {
    const config = { ...base, admin: { ...base.admin, ipAllowList: ['10.0.0.1'] } }
    const result = applyConfigSet(config, 'admin.ipAllowList', ['10.0.0.2'], 'add')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1', '10.0.0.2'])
    }
  })

  test('skips values already in the array', () => {
    const config = { ...base, admin: { ...base.admin, ipAllowList: ['10.0.0.1'] } }
    const result = applyConfigSet(config, 'admin.ipAllowList', ['10.0.0.1', '10.0.0.2'], 'add')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1', '10.0.0.2'])
    }
  })

  test('adds to an empty array', () => {
    const result = applyConfigSet(base, 'admin.ipAllowList', ['10.0.0.1'], 'add')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1'])
    }
  })

  test('adds multiple new values at once', () => {
    const result = applyConfigSet(base, 'admin.userAgentDenyList', ['bot1', 'bot2', 'bot3'], 'add')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['bot1', 'bot2', 'bot3'])
    }
  })
})

describe('applyConfigSet — array properties (remove)', () => {
  test('removes a value from the array', () => {
    const config = {
      ...base,
      admin: { ...base.admin, ipAllowList: ['10.0.0.1', '10.0.0.2', '10.0.0.3'] },
    }
    const result = applyConfigSet(config, 'admin.ipAllowList', ['10.0.0.2'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1', '10.0.0.3'])
    }
  })

  test('removes multiple values at once', () => {
    const config = { ...base, admin: { ...base.admin, ipDenyList: ['a', 'b', 'c', 'd'] } }
    const result = applyConfigSet(config, 'admin.ipDenyList', ['a', 'c'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['b', 'd'])
    }
  })

  test('silently no-ops when removing a value not present', () => {
    const config = { ...base, admin: { ...base.admin, ipAllowList: ['10.0.0.1'] } }
    const result = applyConfigSet(config, 'admin.ipAllowList', ['10.0.0.99'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1'])
    }
  })

  test('can empty an array by removing all values', () => {
    const config = { ...base, admin: { ...base.admin, ipAllowList: ['10.0.0.1', '10.0.0.2'] } }
    const result = applyConfigSet(config, 'admin.ipAllowList', ['10.0.0.1', '10.0.0.2'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual([])
    }
  })
})

describe('applyConfigSet — immutability', () => {
  test('does not mutate the input config', () => {
    const config = { ...base, admin: { ...base.admin, gitEnabled: false } }
    const result = applyConfigSet(config, 'admin.gitEnabled', ['true'], 'replace')
    expect('error' in result).toBeFalse()
    expect(config.admin.gitEnabled).toBe(false)
  })

  test('does not mutate input array properties', () => {
    const original = ['10.0.0.1']
    const config = { ...base, admin: { ...base.admin, ipAllowList: original } }
    applyConfigSet(config, 'admin.ipAllowList', ['10.0.0.2'], 'add')
    expect(original).toEqual(['10.0.0.1'])
  })
})

describe('applyConfigSet — cacheLockTimeoutSeconds', () => {
  test('sets a valid timeout', () => {
    const result = applyConfigSet(base, 'cacheLockTimeoutSeconds', ['120'], 'replace')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toBe(120)
    expect(result.updatedConfig.cacheLockTimeoutSeconds).toBe(120)
  })

  test('rejects zero (must be strictly positive, unlike a plain non-negative number)', () => {
    const result = applyConfigSet(base, 'cacheLockTimeoutSeconds', ['0'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('positive integer')
    }
  })

  test('rejects a negative value', () => {
    const result = applyConfigSet(base, 'cacheLockTimeoutSeconds', ['-5'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('non-negative')
    }
  })
})

describe('applyConfigSet — defaultCurrency', () => {
  test('sets a valid currency', () => {
    const result = applyConfigSet(base, 'defaultCurrency', ['eur'], 'replace')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toBe('eur')
    expect(result.updatedConfig.defaultCurrency).toBe('eur')
  })

  test('normalizes the currency to lowercase', () => {
    const result = applyConfigSet(base, 'defaultCurrency', ['TIX'], 'replace')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toBe('tix')
  })

  test('rejects an unknown currency', () => {
    const result = applyConfigSet(base, 'defaultCurrency', ['gbp'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('usd, eur, tix')
    }
  })
})
