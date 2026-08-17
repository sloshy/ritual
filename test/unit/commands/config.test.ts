import { describe, expect, test } from 'bun:test'
import {
  applyConfigGet,
  applyConfigSet,
  applyConfigUnset,
  deleteAtPath,
  listConfigEntries,
} from '../../../src/config-fields'
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

describe('applyConfigSet — site.apiBaseUrl', () => {
  test('stores a normalized URL (trailing slash stripped)', () => {
    const result = applyConfigSet(base, 'site.apiBaseUrl', ['https://api.example.com/'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe('https://api.example.com')
      expect(result.updatedConfig.site?.apiBaseUrl).toBe('https://api.example.com')
    }
  })

  test('accepts the empty string for a same-origin reverse proxy', () => {
    const result = applyConfigSet(base, 'site.apiBaseUrl', [''], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe('')
    }
  })

  test('rejects a non-http(s) value', () => {
    const result = applyConfigSet(base, 'site.apiBaseUrl', ['not a url'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('apiBaseUrl')
    }
  })

  test('unset removes the key without an init-site guard error', () => {
    const seeded = applyConfigSet(base, 'site.apiBaseUrl', ['http://localhost:3000'], 'replace')
    if ('error' in seeded) throw new Error(`seed setup failed: ${seeded.error}`)
    const result = applyConfigUnset(seeded.updatedConfig, 'site.apiBaseUrl')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.updatedConfig.site?.apiBaseUrl).toBeUndefined()
      expect(result.defaultValue).toBeUndefined()
    }
  })
})

describe('applyConfigSet — string properties', () => {
  test.each([
    ['decksDir', './my-decks'],
    ['collectionsDir', '/abs/path'],
    ['wantedDir', './wanted'],
    ['artDir', './proxy-art'],
  ] as const)('sets string property %s', (key, value) => {
    const result = applyConfigSet(base, key, [value], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(value)
      expect(result.updatedConfig[key]).toBe(value)
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

describe('applyConfigSet — collectionSync.pullTarget', () => {
  test('sets and trims the pull target', () => {
    const result = applyConfigSet(base, 'collectionSync.pullTarget', ['  Red Binder '], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe('Red Binder')
      expect(result.updatedConfig.collectionSync.pullTarget).toBe('Red Binder')
    }
  })

  test('rejects a blank list name, which a pull could not write to', () => {
    const result = applyConfigSet(base, 'collectionSync.pullTarget', ['   '], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('pullTarget')
    }
  })

  test('unset reverts to the built-in default', () => {
    const result = applyConfigUnset(base, 'collectionSync.pullTarget')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.defaultValue).toBe('Inbox')
      expect(result.updatedConfig.collectionSync).toBeUndefined()
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

  test('returns error for non-boolean value', () => {
    const result = applyConfigSet(base, 'admin.gitEnabled', ['yes'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('boolean')
      expect(result.error).toContain('"true" or "false"')
      expect(result.error).toContain('"yes"')
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

  test('accepts zero for searchDebounceMs (0 disables the debounce)', () => {
    const result = applyConfigSet(base, 'searchDebounceMs', ['0'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(0)
      expect(result.updatedConfig.searchDebounceMs).toBe(0)
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

  test('silently no-ops when removing a value not present', () => {
    const config = { ...base, admin: { ...base.admin, ipAllowList: ['10.0.0.1'] } }
    const result = applyConfigSet(config, 'admin.ipAllowList', ['10.0.0.99'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1'])
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

describe('applyConfigSet — priceSources', () => {
  test('sets store names, normalized to lowercase', () => {
    const result = applyConfigSet(base, 'priceSources', ['TCGplayer', 'cardkingdom'], 'replace')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toEqual(['tcgplayer', 'cardkingdom'])
    expect(result.updatedConfig.priceSources).toEqual(['tcgplayer', 'cardkingdom'])
  })

  test('rejects an unknown store, naming the vocabulary', () => {
    const result = applyConfigSet(base, 'priceSources', ['ebay'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('tcgplayer, cardmarket, cardkingdom')
    }
  })

  test('--remove can empty the list, which means "no prices on the sites"', () => {
    const result = applyConfigSet(base, 'priceSources', ['tcgplayer'], 'remove')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toEqual([])
    expect(result.updatedConfig.priceSources).toEqual([])
  })

  test('--add merges without duplicating', () => {
    const result = applyConfigSet(base, 'priceSources', ['cardmarket', 'tcgplayer'], 'add')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toEqual(['tcgplayer', 'cardmarket'])
  })
})

describe('applyConfigSet — defaultLanguage', () => {
  test('sets a valid language code', () => {
    const result = applyConfigSet(base, 'defaultLanguage', ['ja'], 'replace')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toBe('ja')
    expect(result.updatedConfig.defaultLanguage).toBe('ja')
  })

  test('normalizes the code to lowercase', () => {
    const result = applyConfigSet(base, 'defaultLanguage', ['ZHS'], 'replace')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toBe('zhs')
  })

  test.each([
    ['jp', 'ja'],
    ['KR', 'ko'],
    ['sp', 'es'],
    ['Japanese', 'ja'],
  ] as const)('corrects the alias %s to the canonical code %s', (alias, canonical) => {
    const result = applyConfigSet(base, 'defaultLanguage', [alias], 'replace')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toBe(canonical)
    expect(result.updatedConfig.defaultLanguage).toBe(canonical)
  })

  test('rejects an unknown language, listing the valid codes', () => {
    const result = applyConfigSet(base, 'defaultLanguage', ['klingon'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('defaultLanguage')
      expect(result.error).toContain('klingon')
      // The full vocabulary is in the message, so the user can pick a code.
      expect(result.error).toContain('en, es, fr, de, it, pt, ja, ko, ru, zhs, zht')
    }
  })
})

describe('applyConfigSet — cacheSource', () => {
  test('sets a valid source', () => {
    const result = applyConfigSet(base, 'cacheSource', ['feed'], 'replace')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toBe('feed')
    expect(result.updatedConfig.cacheSource).toBe('feed')
  })

  test('sets back to scryfall', () => {
    const config = { ...base, cacheSource: 'feed' as const }
    const result = applyConfigSet(config, 'cacheSource', ['scryfall'], 'replace')
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toBe('scryfall')
  })

  test('rejects an unknown source', () => {
    const result = applyConfigSet(base, 'cacheSource', ['torrent'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('scryfall, feed')
    }
  })
})

describe('applyConfigSet — cacheFeedUrl', () => {
  test('sets a valid http(s) URL', () => {
    const result = applyConfigSet(
      base,
      'cacheFeedUrl',
      ['https://feed.example/feed.json'],
      'replace',
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.newValue).toBe('https://feed.example/feed.json')
    expect(result.updatedConfig.cacheFeedUrl).toBe('https://feed.example/feed.json')
  })

  test('rejects a non-http(s) URL', () => {
    const result = applyConfigSet(base, 'cacheFeedUrl', ['ftp://feed.example/feed.json'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('http(s) URL')
    }
  })

  test('rejects a non-URL string', () => {
    const result = applyConfigSet(base, 'cacheFeedUrl', ['not a url'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('http(s) URL')
    }
  })
})

describe('deleteAtPath', () => {
  test('removes a top-level key', () => {
    const result = deleteAtPath({ a: 1, b: 2 }, ['a'])
    expect(result).toEqual({ b: 2 })
  })

  test('removes a nested key while keeping siblings', () => {
    const result = deleteAtPath({ parent: { a: 1, b: 2 }, other: 3 }, ['parent', 'a'])
    expect(result).toEqual({ parent: { b: 2 }, other: 3 })
  })

  test('prunes a parent object that becomes empty', () => {
    const result = deleteAtPath({ parent: { only: 1 }, other: 3 }, ['parent', 'only'])
    expect(result).toEqual({ other: 3 })
    expect('parent' in result).toBeFalse()
  })

  test('prunes empty parents recursively', () => {
    const result = deleteAtPath({ a: { b: { c: 1 } }, keep: true }, ['a', 'b', 'c'])
    expect(result).toEqual({ keep: true })
  })

  test('returns the object unchanged when the key is missing', () => {
    const input = { a: 1 }
    const result = deleteAtPath(input, ['missing'])
    expect(result).toBe(input)
  })

  test('returns the object unchanged when a nested key is missing', () => {
    const input = { parent: { a: 1 } }
    const result = deleteAtPath(input, ['parent', 'missing'])
    expect(result).toBe(input)
  })

  test('does not mutate the input object', () => {
    const input = { parent: { a: 1, b: 2 } }
    deleteAtPath(input, ['parent', 'a'])
    expect(input).toEqual({ parent: { a: 1, b: 2 } })
  })
})

describe('applyConfigUnset', () => {
  test('removes a defaulted key and reports its default value', () => {
    const config = { ...base, decksDir: './custom-decks' }
    const outcome = applyConfigUnset(config, 'decksDir')
    if ('error' in outcome) throw new Error(outcome.error)
    expect(outcome.property).toBe('decksDir')
    expect(outcome.defaultValue).toBe('./decks')
    expect('decksDir' in outcome.updatedConfig).toBeFalse()
  })

  test('removes an optional key without a default value', () => {
    const config = { ...base, cacheFeedUrl: 'https://feed.example/feed.json' }
    const outcome = applyConfigUnset(config, 'cacheFeedUrl')
    if ('error' in outcome) throw new Error(outcome.error)
    expect(outcome.defaultValue).toBeUndefined()
    expect('cacheFeedUrl' in outcome.updatedConfig).toBeFalse()
  })

  test('removes defaultLanguage and reports en as its default', () => {
    const config = { ...base, defaultLanguage: 'ja' as const }
    const outcome = applyConfigUnset(config, 'defaultLanguage')
    if ('error' in outcome) throw new Error(outcome.error)
    expect(outcome.defaultValue).toBe('en')
    expect('defaultLanguage' in outcome.updatedConfig).toBeFalse()
  })

  test('reports the effective default for a site selection list', () => {
    const seeded = applyConfigSet(base, 'site.includeDecks', ['Izzet Storm'], 'replace')
    if ('error' in seeded) throw new Error(seeded.error)
    const outcome = applyConfigUnset(seeded.updatedConfig, 'site.includeDecks')
    if ('error' in outcome) throw new Error(outcome.error)
    expect(outcome.defaultValue).toEqual(['*'])
    expect(outcome.updatedConfig.site?.includeDecks).toBeUndefined()
  })

  test('is idempotent for an already-absent optional key', () => {
    const outcome = applyConfigUnset(base, 'cacheFeedUrl')
    if ('error' in outcome) throw new Error(outcome.error)
    expect(outcome.updatedConfig).toEqual(base)
  })

  test('blocks the site deployment keys', () => {
    const outcome = applyConfigUnset(base, 'site.ciSystem')
    expect('error' in outcome).toBeTrue()
    if ('error' in outcome) {
      expect(outcome.error).toContain('init-site')
    }
  })

  test('returns error for unknown property', () => {
    const outcome = applyConfigUnset(base, 'nope')
    expect('error' in outcome).toBeTrue()
    if ('error' in outcome) {
      expect(outcome.error).toContain('Unknown property')
    }
  })

  test('does not mutate the input config', () => {
    const config = { ...base, decksDir: './custom-decks' }
    applyConfigUnset(config, 'decksDir')
    expect(config.decksDir).toBe('./custom-decks')
  })
})

describe('applyConfigGet', () => {
  test('returns the value of a set property', () => {
    const outcome = applyConfigGet(base, 'decksDir')
    expect(outcome).toEqual({ kind: 'value', value: './decks' })
  })

  test('resolves nested admin properties', () => {
    const outcome = applyConfigGet(base, 'admin.rateLimitMaxAttempts')
    expect(outcome).toEqual({ kind: 'value', value: 5 })
  })

  test('reports an optional key that was never set as unset', () => {
    const outcome = applyConfigGet(base, 'cacheFeedUrl')
    expect(outcome).toEqual({ kind: 'unset' })
  })

  test('resolves the nested collection-sync pull target', () => {
    const outcome = applyConfigGet(base, 'collectionSync.pullTarget')
    expect(outcome).toEqual({ kind: 'value', value: 'Inbox' })
  })

  test('resolves defaultLanguage', () => {
    const outcome = applyConfigGet({ ...base, defaultLanguage: 'ja' }, 'defaultLanguage')
    expect(outcome).toEqual({ kind: 'value', value: 'ja' })
  })

  test('reports site selection lists as unset before a site config exists', () => {
    const outcome = applyConfigGet(base, 'site.includeDecks')
    expect(outcome).toEqual({ kind: 'unset' })
  })

  test('allows reading exportPresets even though it is not settable', () => {
    const config = {
      ...base,
      exportPresets: { mine: { format: 'csv' } },
    } as unknown as typeof base
    const outcome = applyConfigGet(config, 'exportPresets')
    expect(outcome.kind).toBe('value')
  })

  test('returns unknown-property with the available key listing', () => {
    const outcome = applyConfigGet(base, 'site.ciSystem')
    expect(outcome.kind).toBe('unknown-property')
    if (outcome.kind === 'unknown-property') {
      expect(outcome.error).toContain('Unknown property')
      expect(outcome.error).toContain('decksDir')
      expect(outcome.error).toContain('exportPresets')
    }
  })
})

describe('listConfigEntries', () => {
  test('marks untouched defaulted keys as default and optional keys as unset', () => {
    const entries = listConfigEntries(base)
    const byKey = new Map(entries.map((entry) => [entry.property, entry]))

    expect(byKey.get('decksDir')).toEqual({
      property: 'decksDir',
      value: './decks',
      isDefault: true,
    })
    expect(byKey.get('cacheFeedUrl')?.value).toBeUndefined()
    expect(byKey.get('admin.rateLimitEnabled')).toEqual({
      property: 'admin.rateLimitEnabled',
      value: true,
      isDefault: true,
    })
    expect(byKey.get('collectionSync.pullTarget')).toEqual({
      property: 'collectionSync.pullTarget',
      value: 'Inbox',
      isDefault: true,
    })
    // No site object yet: the site lists are unset (their effective defaults
    // only materialize once a site config exists).
    expect(byKey.get('site.includeDecks')?.value).toBeUndefined()
  })

  test('marks customized values as non-default by value equality', () => {
    const config = {
      ...base,
      decksDir: './custom',
      admin: { ...base.admin, ipAllowList: ['1.2.3.4'] },
    }
    const entries = listConfigEntries(config)
    const byKey = new Map(entries.map((entry) => [entry.property, entry]))

    expect(byKey.get('decksDir')?.isDefault).toBeFalse()
    expect(byKey.get('admin.ipAllowList')?.isDefault).toBeFalse()
  })

  test('marks a site selection list holding its documented default as default', () => {
    const seeded = applyConfigSet(base, 'site.includeDecks', ['*'], 'replace')
    if ('error' in seeded) throw new Error(seeded.error)
    const entries = listConfigEntries(seeded.updatedConfig)
    const entry = entries.find((candidate) => candidate.property === 'site.includeDecks')
    expect(entry?.value).toEqual(['*'])
    expect(entry?.isDefault).toBeTrue()
  })
})
