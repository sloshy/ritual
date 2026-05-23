import { describe, expect, test } from 'bun:test'
import {
  applyConfigSet,
  SETTABLE_FIELDS,
  SETTABLE_ADMIN_FIELDS,
  SETTABLE_SITE_FIELDS,
} from '../../../src/commands/config-set'
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
    if ('error' in seeded) return
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
    if ('error' in seeded) return
    const removed = applyConfigSet(seeded.updatedConfig, 'site.excludeCollections', ['A'], 'remove')
    expect('error' in removed).toBeFalse()
    if (!('error' in removed)) {
      expect(removed.updatedConfig.site?.excludeCollections).toEqual(['B'])
    }
  })
})

describe('applyConfigSet — string properties', () => {
  test('sets a string property', () => {
    const result = applyConfigSet(base, 'decksDir', ['./my-decks'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe('./my-decks')
      expect(result.updatedConfig.decksDir).toBe('./my-decks')
    }
  })

  test('sets collectionsDir', () => {
    const result = applyConfigSet(base, 'collectionsDir', ['/abs/path'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.updatedConfig.collectionsDir).toBe('/abs/path')
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
  test('sets boolean to true', () => {
    const result = applyConfigSet(base, 'admin.gitEnabled', ['true'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(true)
      expect(result.updatedConfig.admin.gitEnabled).toBe(true)
    }
  })

  test('sets boolean to false', () => {
    const config = { ...base, admin: { ...base.admin, gitEnabled: true } }
    const result = applyConfigSet(config, 'admin.gitEnabled', ['false'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(false)
      expect(result.updatedConfig.admin.gitEnabled).toBe(false)
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

  test('accepts TRUE (case-insensitive)', () => {
    const result = applyConfigSet(base, 'admin.gitEnabled', ['TRUE'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(true)
    }
  })

  test('accepts False (mixed case)', () => {
    const config = { ...base, admin: { ...base.admin, gitAutoCommit: true } }
    const result = applyConfigSet(config, 'admin.gitAutoCommit', ['False'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(false)
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

describe('SETTABLE_FIELDS', () => {
  test('contains the top-level directory keys', () => {
    const keys = Object.keys(SETTABLE_FIELDS)
    expect(keys).toContain('decksDir')
    expect(keys).toContain('collectionsDir')
    expect(keys).toContain('wantedDir')
  })

  test('does not expose the admin or site keys', () => {
    expect(Object.keys(SETTABLE_FIELDS)).not.toContain('admin')
    expect(Object.keys(SETTABLE_FIELDS)).not.toContain('site')
  })
})

describe('SETTABLE_ADMIN_FIELDS', () => {
  test('exposes admin settings under dotted admin.* paths', () => {
    const keys = Object.keys(SETTABLE_ADMIN_FIELDS)
    expect(keys).toContain('admin.gitEnabled')
    expect(keys).toContain('admin.gitAutoCommit')
    expect(keys).toContain('admin.gitAutoPush')
    expect(keys).toContain('admin.ipAllowList')
    expect(keys).toContain('admin.rateLimitMaxAttempts')
    expect(keys).toContain('admin.failedAuthDelayMs')
  })

  test('maps array fields to string[] type', () => {
    expect(SETTABLE_ADMIN_FIELDS['admin.ipAllowList']).toBe('string[]')
    expect(SETTABLE_ADMIN_FIELDS['admin.ipDenyList']).toBe('string[]')
    expect(SETTABLE_ADMIN_FIELDS['admin.userAgentAllowList']).toBe('string[]')
    expect(SETTABLE_ADMIN_FIELDS['admin.userAgentDenyList']).toBe('string[]')
  })

  test('maps numeric fields to number type', () => {
    expect(SETTABLE_ADMIN_FIELDS['admin.rateLimitMaxAttempts']).toBe('number')
    expect(SETTABLE_ADMIN_FIELDS['admin.rateLimitWindowMinutes']).toBe('number')
    expect(SETTABLE_ADMIN_FIELDS['admin.failedAuthDelayMs']).toBe('number')
  })
})

describe('SETTABLE_SITE_FIELDS', () => {
  test('exposes both include and exclude selection lists as string[] paths', () => {
    expect(SETTABLE_SITE_FIELDS['site.includeDecks']).toBe('string[]')
    expect(SETTABLE_SITE_FIELDS['site.includeCollections']).toBe('string[]')
    expect(SETTABLE_SITE_FIELDS['site.includeWantedLists']).toBe('string[]')
    expect(SETTABLE_SITE_FIELDS['site.excludeDecks']).toBe('string[]')
    expect(SETTABLE_SITE_FIELDS['site.excludeCollections']).toBe('string[]')
    expect(SETTABLE_SITE_FIELDS['site.excludeWantedLists']).toBe('string[]')
  })
})
