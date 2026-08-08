import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  getBannedPrintings,
  getDecksDir,
  getCollectionsDir,
  getWantedDir,
  getDefaultLanguage,
  getDefaultRitualConfig,
  getRitualConfig,
  getSiteDeployConfig,
  getSiteSelectionConfig,
  refreshRitualConfig,
  isConfigParseError,
  loadRitualConfig,
  normalizeBannedPrintings,
  parseAdminConfig,
  parseBannedPrinting,
  parseCacheFeedUrl,
  parseCacheLockTimeoutSeconds,
  parseCacheSource,
  parseCollectionSyncConfig,
  parseDefaultCurrency,
  parseDefaultLanguage,
  getSiteApiBaseUrl,
  getSiteSellMode,
  parseSearchDebounceMs,
  parseSiteApiBaseUrl,
  parseSiteConfig,
  resetRitualConfigCache,
  RitualConfigParseError,
  saveRitualConfig,
  type RitualConfig,
  type SiteConfig,
} from '../../src/ritual-config'
import { defaultSiteSelection } from '../../src/site/list-selection'
import { setBaseDir } from '../../src/base-dir'
import { localeTag } from '../../src/i18n/locale-tag'

const testDir = path.join(import.meta.dir, '../.test-ritual-config')
const configPath = path.join(testDir, 'ritual.config.json')

/** What bun:test's `toThrow` accepts: an error class, instance, or message match. */
type ThrowMatcher = string | RegExp | Error | (new (...args: never[]) => Error)

/**
 * Assert `load` rejects with `expected` (an error class, or a message
 * substring). Wraps the carve-out bun:test's `rejects` chain needs: it resolves
 * at runtime but the Matchers type doesn't expose a Promise.
 */
async function expectRejection(load: Promise<unknown>, expected: ThrowMatcher): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
  await expect(load).rejects.toThrow(expected)
}

/** Assert `result` is the shared ConfigParseError branch naming `substring`. */
function expectParseError(result: unknown, substring: string): void {
  expect(isConfigParseError(result)).toBeTrue()
  if (isConfigParseError(result)) {
    expect(result.error).toContain(substring)
  }
}

describe('ritual config', () => {
  const originalCwd = process.cwd()

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true })
    setBaseDir(testDir)
    resetRitualConfigCache()
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
    resetRitualConfigCache()
    await fs.rm(testDir, { recursive: true, force: true })
  })

  test('getDefaultRitualConfig returns default values including wantedDir', () => {
    const config = getDefaultRitualConfig()
    expect(config.decksDir).toBe('./decks')
    expect(config.collectionsDir).toBe('./collections')
    expect(config.wantedDir).toBe('./wanted')
    expect(config.defaultCurrency).toBe('usd')
    expect(config.admin.gitEnabled).toBe(false)
    expect(config.admin.gitAutoCommit).toBe(false)
    expect(config.admin.gitAutoPush).toBe(false)
  })

  test('loadRitualConfig returns defaults when file does not exist', async () => {
    const config = await loadRitualConfig()
    expect(config.decksDir).toBe('./decks')
    expect(config.wantedDir).toBe('./wanted')
    expect(config.admin.gitEnabled).toBe(false)
  })

  test('loadRitualConfig rejects a malformed config file instead of ignoring it', async () => {
    await fs.writeFile(configPath, '{ "decksDir": "./my-decks",')
    await expectRejection(loadRitualConfig(), RitualConfigParseError)
    // The message has to name the file and the parser's complaint — the user
    // has to know which file to fix.
    await expectRejection(loadRitualConfig(), configPath)
    await expectRejection(loadRitualConfig(), 'JSON Parse error')
  })

  test('refreshRitualConfig rejects a malformed config file rather than caching defaults', async () => {
    await fs.writeFile(configPath, '{ not valid json }')
    await expectRejection(refreshRitualConfig(), RitualConfigParseError)
  })

  test('a JSON document that is not an object is a config parse error', async () => {
    await fs.writeFile(configPath, '["decksDir"]')
    await expectRejection(loadRitualConfig(), 'must contain a JSON object')
  })

  test('an empty config object loads as the defaults', async () => {
    await fs.writeFile(configPath, '{}')
    expect(await loadRitualConfig()).toEqual(getDefaultRitualConfig())
  })

  test('saveRitualConfig and loadRitualConfig round-trip', async () => {
    const config: RitualConfig = {
      decksDir: './my-decks',
      collectionsDir: './my-collections',
      wantedDir: './my-wanted',
      defaultCurrency: 'eur',
      defaultLanguage: 'ja',
      uiLocale: localeTag('de-AT'),
      cacheLockTimeoutSeconds: 120,
      cacheSource: 'feed',
      cacheFeedUrl: 'https://feed.example/feed.json',
      searchDebounceMs: 250,
      admin: {
        gitEnabled: true,
        gitAutoCommit: true,
        gitAutoPush: false,
        trustProxy: false,
        secureCookies: false,
        ipAllowList: ['192.168.1.*'],
        ipDenyList: [],
        userAgentAllowList: [],
        userAgentDenyList: ['*bot*'],
        rateLimitEnabled: true,
        rateLimitMaxAttempts: 10,
        rateLimitWindowMinutes: 10,
        failedAuthDelayMs: 5000,
      },
      collectionSync: { pullTarget: 'Binder' },
      site: {
        version: '1.0.0',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: true,
        includeDecks: ['*'],
        includeCollections: ['*'],
        includeWantedLists: ['*'],
        excludeDecks: ['Old Brew'],
        excludeCollections: [],
        excludeWantedLists: [],
      },
    }
    await saveRitualConfig(config)

    const loaded = await loadRitualConfig()
    expect(loaded).toEqual(config)
  })

  test('loadRitualConfig merges partial config with defaults', async () => {
    await fs.writeFile(configPath, JSON.stringify({ admin: { gitEnabled: true } }))
    const config = await loadRitualConfig()
    expect(config.admin.gitEnabled).toBe(true)
    expect(config.decksDir).toBe('./decks')
    expect(config.wantedDir).toBe('./wanted')
    // Omitted admin fields fall back to their defaults.
    expect(config.admin.gitAutoCommit).toBe(false)
    expect(config.admin.rateLimitEnabled).toBe(true)
    expect(config.admin.rateLimitMaxAttempts).toBe(5)
  })

  test('defaultCurrency, cacheLockTimeoutSeconds, cacheSource, and searchDebounceMs default when absent', async () => {
    await fs.writeFile(configPath, JSON.stringify({ decksDir: './d' }))
    const config = await loadRitualConfig()
    expect(config.defaultCurrency).toBe('usd')
    expect(config.defaultLanguage).toBe('en')
    expect(config.cacheLockTimeoutSeconds).toBe(300)
    expect(config.cacheSource).toBe('scryfall')
    expect(config.cacheFeedUrl).toBeUndefined()
    expect(config.searchDebounceMs).toBe(500)
  })

  test('defaultLanguage loads a valid value, normalizing case', async () => {
    await fs.writeFile(configPath, JSON.stringify({ defaultLanguage: 'JA' }))
    const config = await loadRitualConfig()
    expect(config.defaultLanguage).toBe('ja')
    expect(getDefaultLanguage(config)).toBe('ja')
  })

  test.each([['"jp"'], ['"klingon"'], ['5'], ['true']])(
    'defaultLanguage falls back to en when %s',
    async (raw) => {
      // Aliases like "jp" are a `config set` convenience only — the persisted
      // spelling must be the canonical Scryfall code.
      await fs.writeFile(configPath, `{ "defaultLanguage": ${raw} }`)
      const config = await loadRitualConfig()
      expect(config.defaultLanguage).toBe('en')
    },
  )

  test('searchDebounceMs loads a valid value, allowing 0', async () => {
    await fs.writeFile(configPath, JSON.stringify({ searchDebounceMs: 0 }))
    const config = await loadRitualConfig()
    expect(config.searchDebounceMs).toBe(0)
  })

  test.each([['-50'], ['2.5'], ['"fast"'], ['true']])(
    'searchDebounceMs falls back to 500 when %s',
    async (raw) => {
      await fs.writeFile(configPath, `{ "searchDebounceMs": ${raw} }`)
      const config = await loadRitualConfig()
      expect(config.searchDebounceMs).toBe(500)
    },
  )

  test('defaultCurrency loads a valid value, normalizing case', async () => {
    await fs.writeFile(configPath, JSON.stringify({ defaultCurrency: 'EUR' }))
    const config = await loadRitualConfig()
    expect(config.defaultCurrency).toBe('eur')
  })

  test.each([['"gbp"'], ['5']])('defaultCurrency falls back to usd when %s', async (raw) => {
    await fs.writeFile(configPath, `{ "defaultCurrency": ${raw} }`)
    const config = await loadRitualConfig()
    expect(config.defaultCurrency).toBe('usd')
  })

  test('cacheLockTimeoutSeconds loads a valid value', async () => {
    await fs.writeFile(configPath, JSON.stringify({ cacheLockTimeoutSeconds: 60 }))
    const config = await loadRitualConfig()
    expect(config.cacheLockTimeoutSeconds).toBe(60)
  })

  test.each([['0'], ['-5'], ['2.5'], ['"fast"']])(
    'cacheLockTimeoutSeconds falls back to 300 when %s',
    async (raw) => {
      await fs.writeFile(configPath, `{ "cacheLockTimeoutSeconds": ${raw} }`)
      const config = await loadRitualConfig()
      expect(config.cacheLockTimeoutSeconds).toBe(300)
    },
  )

  test('cacheSource loads a valid value', async () => {
    await fs.writeFile(configPath, JSON.stringify({ cacheSource: 'feed' }))
    const config = await loadRitualConfig()
    expect(config.cacheSource).toBe('feed')
  })

  test.each([['"torrent"'], ['5'], ['true']])(
    'cacheSource falls back to scryfall when %s',
    async (raw) => {
      await fs.writeFile(configPath, `{ "cacheSource": ${raw} }`)
      const config = await loadRitualConfig()
      expect(config.cacheSource).toBe('scryfall')
    },
  )

  test('cacheFeedUrl loads a valid http(s) URL', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ cacheFeedUrl: 'https://feed.example/feed.json' }),
    )
    const config = await loadRitualConfig()
    expect(config.cacheFeedUrl).toBe('https://feed.example/feed.json')
  })

  test.each([['"not a url"'], ['"ftp://feed.example/feed.json"'], ['5']])(
    'cacheFeedUrl is dropped when %s',
    async (raw) => {
      await fs.writeFile(configPath, `{ "cacheFeedUrl": ${raw} }`)
      const config = await loadRitualConfig()
      expect(config.cacheFeedUrl).toBeUndefined()
    },
  )

  test('loadRitualConfig falls back to admin defaults when admin is absent', async () => {
    await fs.writeFile(configPath, JSON.stringify({ decksDir: './d' }))
    const config = await loadRitualConfig()
    expect(config.admin).toEqual(getDefaultRitualConfig().admin)
  })

  test('loadRitualConfig falls back to admin defaults when admin is not an object', async () => {
    await fs.writeFile(configPath, JSON.stringify({ admin: 'nope' }))
    const config = await loadRitualConfig()
    expect(config.admin).toEqual(getDefaultRitualConfig().admin)
  })

  test('loadRitualConfig falls back to the collectionSync default when the section is absent', async () => {
    // The pull target has to resolve for every config file, including the ones
    // written before this section existed.
    await fs.writeFile(configPath, JSON.stringify({ decksDir: './d' }))
    const config = await loadRitualConfig()
    expect(config.collectionSync).toEqual({ pullTarget: 'Inbox' })
  })

  test('loadRitualConfig keeps a configured collectionSync.pullTarget', async () => {
    await fs.writeFile(configPath, JSON.stringify({ collectionSync: { pullTarget: 'Red Binder' } }))
    const config = await loadRitualConfig()
    expect(config.collectionSync.pullTarget).toBe('Red Binder')
  })

  test('loadRitualConfig falls back to the collectionSync default when the section is malformed', async () => {
    await fs.writeFile(configPath, JSON.stringify({ collectionSync: { pullTarget: '  ' } }))
    const config = await loadRitualConfig()
    expect(config.collectionSync).toEqual({ pullTarget: 'Inbox' })
  })

  test('exportPresets survive a save/load round-trip', async () => {
    const presets = {
      deckbox: { format: 'csv', columns: ['name', 'quantity'], quoteAll: true },
    }
    await fs.writeFile(configPath, JSON.stringify({ exportPresets: presets }))
    const config = await loadRitualConfig()
    expect(config.exportPresets).toEqual({
      deckbox: { format: 'csv', columns: ['name', 'quantity'], quoteAll: true },
    })

    await saveRitualConfig(config)
    const reloaded = await loadRitualConfig()
    expect(reloaded.exportPresets).toEqual(config.exportPresets)
  })

  test('exportPresets are dropped with a warning when malformed', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ exportPresets: { bad: { format: 'xml', columns: ['name'] } } }),
    )
    const config = await loadRitualConfig()
    expect(config.exportPresets).toBeUndefined()
  })

  test('refreshRitualConfig caches defaults without creating the file when missing', async () => {
    const config = await refreshRitualConfig()
    expect(config).toEqual(getDefaultRitualConfig())
    expect(await Bun.file(configPath).exists()).toBeFalse()
  })

  test('refreshRitualConfig populates the cache for sync getters', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ decksDir: './custom-decks', wantedDir: './custom-wanted' }),
    )
    await refreshRitualConfig()
    const cached = getRitualConfig()
    expect(cached.decksDir).toBe('./custom-decks')
    expect(cached.wantedDir).toBe('./custom-wanted')
  })

  test('directory helpers resolve relative to base dir', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        decksDir: './my-decks',
        collectionsDir: 'collections',
        wantedDir: '../shared-wanted',
      }),
    )
    await refreshRitualConfig()
    expect(getDecksDir()).toBe(path.join(testDir, 'my-decks'))
    expect(getCollectionsDir()).toBe(path.join(testDir, 'collections'))
    expect(getWantedDir()).toBe(path.resolve(testDir, '../shared-wanted'))
  })

  test('config without site key loads with site undefined', async () => {
    await fs.writeFile(configPath, JSON.stringify({ admin: { gitEnabled: true } }))
    const loaded = await loadRitualConfig()
    expect(loaded.site).toBeUndefined()
  })

  test('site key without selection lists loads with defaults applied', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        site: {
          version: '1.0.0',
          ciSystem: 'manual',
        },
      }),
    )
    const loaded = await loadRitualConfig()
    expect(loaded.site).toEqual({
      version: '1.0.0',
      ciSystem: 'manual',
      includeDecks: ['*'],
      includeCollections: ['*'],
      includeWantedLists: ['*'],
      excludeDecks: [],
      excludeCollections: [],
      excludeWantedLists: [],
    })
  })

  test('config with invalid site key drops the site value', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        admin: { gitEnabled: true },
        site: { ciSystem: 'github-actions' }, // missing version, deployMode, etc
      }),
    )
    const loaded = await loadRitualConfig()
    expect(loaded.site).toBeUndefined()
    expect(loaded.admin.gitEnabled).toBe(true)
  })
})

describe('parseAdminConfig', () => {
  const defaults = getDefaultRitualConfig().admin

  test('returns admin defaults when value is undefined', () => {
    expect(parseAdminConfig(undefined)).toEqual(defaults)
  })

  test('defaults absent fields and keeps provided ones', () => {
    const result = parseAdminConfig({ gitEnabled: true, ipAllowList: ['10.0.0.1'] })
    expect(result).toEqual({ ...defaults, gitEnabled: true, ipAllowList: ['10.0.0.1'] })
  })

  test('returns a parse error when not an object', () => {
    expectParseError(parseAdminConfig('nope'), 'admin config')
    expect(isConfigParseError(parseAdminConfig(42))).toBeTrue()
    expect(isConfigParseError(parseAdminConfig(null))).toBeTrue()
  })

  test('returns error naming the field when a boolean field is malformed', () => {
    expectParseError(parseAdminConfig({ gitEnabled: 'yes' }), 'gitEnabled')
  })

  test.each([
    ['rateLimitMaxAttempts', { rateLimitMaxAttempts: 'lots' }],
    ['rateLimitWindowMinutes', { rateLimitWindowMinutes: 'a while' }],
    ['failedAuthDelayMs', { failedAuthDelayMs: 'slow' }],
  ])('returns error naming the field when number field %s is malformed', (field, input) => {
    expectParseError(parseAdminConfig(input), field)
  })

  test('returns error when a list field is not an array of strings', () => {
    expect(isConfigParseError(parseAdminConfig({ ipAllowList: '10.0.0.1' }))).toBeTrue()
    expect(isConfigParseError(parseAdminConfig({ userAgentDenyList: [1, 2] }))).toBeTrue()
  })

  test('ignores unknown extra fields', () => {
    const result = parseAdminConfig({ gitEnabled: true, somethingElse: 'ignored' })
    expect(result).toEqual({ ...defaults, gitEnabled: true })
  })
})

describe('parseCollectionSyncConfig', () => {
  const defaults = getDefaultRitualConfig().collectionSync

  test('returns the defaults when the section is undefined', () => {
    expect(parseCollectionSyncConfig(undefined)).toEqual(defaults)
  })

  test('defaults an absent pullTarget', () => {
    expect(parseCollectionSyncConfig({})).toEqual(defaults)
  })

  test('trims the configured pull target', () => {
    expect(parseCollectionSyncConfig({ pullTarget: '  Red Binder ' })).toEqual({
      pullTarget: 'Red Binder',
    })
  })

  test('returns a parse error when the section is not an object', () => {
    expectParseError(parseCollectionSyncConfig('nope'), 'collectionSync config')
  })

  test.each([['""'], ['"   "'], ['5'], ['null']])(
    'returns a parse error when pullTarget is %s',
    (raw) => {
      const value = JSON.parse(`{ "pullTarget": ${raw} }`) as unknown
      expectParseError(parseCollectionSyncConfig(value), 'pullTarget')
    },
  )
})

describe('parseSiteConfig', () => {
  // Include lists default to ['*'] (include all) and exclude lists to [] when
  // absent from the input.
  const defaultSelection = {
    includeDecks: ['*'],
    includeCollections: ['*'],
    includeWantedLists: ['*'],
    excludeDecks: [],
    excludeCollections: [],
    excludeWantedLists: [],
  }

  test.each([
    [
      'github-actions/publish-for-me',
      {
        version: '0.1.0',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: false,
      },
    ],
    [
      'github-actions/local-build',
      {
        version: '0.2.0-beta1',
        ciSystem: 'github-actions',
        deployMode: 'local-build',
        distDir: 'public',
        detectChanges: false,
      },
    ],
    ['manual', { version: '1.0.0', ciSystem: 'manual' }],
  ] as const)('parses valid %s config', (_label, input) => {
    expect(parseSiteConfig(input)).toEqual({ ...defaultSelection, ...input } as SiteConfig)
  })

  test('parses selection-only config with no deployment settings', () => {
    const result = parseSiteConfig({
      includeDecks: ['Izzet Storm'],
      includeCollections: ['*'],
      includeWantedLists: ['High Priority', 'Trade Targets'],
    })
    expect(result).toEqual({
      includeDecks: ['Izzet Storm'],
      includeCollections: ['*'],
      includeWantedLists: ['High Priority', 'Trade Targets'],
      excludeDecks: [],
      excludeCollections: [],
      excludeWantedLists: [],
    })
  })

  test('preserves explicit selection lists alongside deployment settings', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'manual',
      includeDecks: ['Atraxa'],
      includeCollections: [],
    })
    expect(result).toEqual({
      version: '1.0.0',
      ciSystem: 'manual',
      includeDecks: ['Atraxa'],
      includeCollections: [],
      includeWantedLists: ['*'],
      excludeDecks: [],
      excludeCollections: [],
      excludeWantedLists: [],
    })
  })

  test('parses explicit exclude lists', () => {
    const result = parseSiteConfig({
      excludeDecks: ['Old Brew'],
      excludeWantedLists: ['Done'],
    })
    expect(result).toEqual({
      includeDecks: ['*'],
      includeCollections: ['*'],
      includeWantedLists: ['*'],
      excludeDecks: ['Old Brew'],
      excludeCollections: [],
      excludeWantedLists: ['Done'],
    })
  })

  test('returns error when a selection list is not an array of strings', () => {
    expectParseError(parseSiteConfig({ includeDecks: 'Izzet Storm' }), 'includeDecks')
    expect(isConfigParseError(parseSiteConfig({ includeCollections: [1, 2] }))).toBeTrue()
    expectParseError(parseSiteConfig({ excludeDecks: 'Old Brew' }), 'excludeDecks')
  })

  test('returns a parse error when not an object', () => {
    expectParseError(parseSiteConfig('just a string'), 'site config')
    expect(isConfigParseError(parseSiteConfig(null))).toBeTrue()
    expect(isConfigParseError(parseSiteConfig(42))).toBeTrue()
  })

  test('returns a parse error when version is not valid semver', () => {
    const result = parseSiteConfig({
      version: 'latest',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })
    expectParseError(result, '"version"')
  })

  test('returns a parse error when version is missing', () => {
    const result = parseSiteConfig({
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })
    expectParseError(result, '"version"')
  })

  test('returns a parse error when ciSystem is invalid', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'gitlab',
    })
    expectParseError(result, '"ciSystem"')
  })

  test('returns a parse error when deployMode is invalid for github-actions', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'invalid',
      distDir: 'dist',
    })
    expectParseError(result, '"deployMode"')
  })

  test('returns error when distDir is missing for github-actions', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      detectChanges: false,
    })
    expectParseError(result, '"distDir"')
  })

  test('returns error when detectChanges is missing for github-actions', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })
    expectParseError(result, '"detectChanges"')
  })

  test('returns error when detectChanges is the wrong type for github-actions', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: 'yes',
    })
    expectParseError(result, '"detectChanges"')
  })

  test.each([
    [
      'github-actions',
      {
        version: '1.0.0',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: false,
      },
    ],
    ['manual', { version: '1.0.0', ciSystem: 'manual' }],
  ] as const)('ignores extra unknown fields for %s config', (_label, input) => {
    const result = parseSiteConfig({ ...input, unknown: 'field' })
    expect(result).toEqual({ ...defaultSelection, ...input } as SiteConfig)
  })

  test('parses and normalizes bannedPrintings alongside selection', () => {
    const result = parseSiteConfig({ bannedPrintings: ['SLD:123', 'mh2:42'] })
    expect(result).toEqual({ ...defaultSelection, bannedPrintings: ['sld:123', 'mh2:42'] })
  })

  test('returns error when a bannedPrintings entry is malformed', () => {
    expectParseError(parseSiteConfig({ bannedPrintings: ['SLD:123', 'oops'] }), 'oops')
  })

  test('returns error when bannedPrintings is not an array of strings', () => {
    expect(isConfigParseError(parseSiteConfig({ bannedPrintings: 'SLD:123' }))).toBeTrue()
  })

  test('parses apiBaseUrl alongside selection, stripping trailing slashes', () => {
    const result = parseSiteConfig({ apiBaseUrl: 'https://api.example.com/' })
    expect(result).toEqual({ ...defaultSelection, apiBaseUrl: 'https://api.example.com' })
  })

  test('accepts an empty apiBaseUrl (same-origin reverse proxy)', () => {
    const result = parseSiteConfig({ apiBaseUrl: '' })
    expect(result).toEqual({ ...defaultSelection, apiBaseUrl: '' })
  })

  test('returns error when apiBaseUrl is not an http(s) URL', () => {
    expectParseError(parseSiteConfig({ apiBaseUrl: 'ftp://example.com' }), 'apiBaseUrl')
    expectParseError(parseSiteConfig({ apiBaseUrl: 'not a url' }), 'apiBaseUrl')
    expectParseError(parseSiteConfig({ apiBaseUrl: 42 }), 'apiBaseUrl')
  })

  test('carries sellMode through the selection-only branch', () => {
    expect(parseSiteConfig({ sellMode: false })).toEqual({ ...defaultSelection, sellMode: false })
  })

  test('carries sellMode through the deployment branches too', () => {
    // Four return sites build the parsed object; dropping the key in one of them
    // would silently disable sell mode for init-site-configured workspaces only.
    const manual = parseSiteConfig({ version: '1.2.3', ciSystem: 'manual', sellMode: false })
    expect(manual).toMatchObject({ sellMode: false, ciSystem: 'manual' })

    const actions = parseSiteConfig({
      version: '1.2.3',
      ciSystem: 'github-actions',
      deployMode: 'local-build',
      distDir: 'dist',
      detectChanges: false,
      sellMode: false,
    })
    expect(actions).toMatchObject({ sellMode: false, ciSystem: 'github-actions' })
  })

  test('returns error when sellMode is not a boolean', () => {
    expectParseError(parseSiteConfig({ sellMode: 'false' }), 'sellMode')
  })
})

describe('getSiteSellMode', () => {
  test('is enabled by default, and by an absent site object', () => {
    expect(getSiteSellMode(getDefaultRitualConfig())).toBe(true)
    expect(getSiteSellMode({ ...getDefaultRitualConfig(), site: defaultSiteSelection() })).toBe(
      true,
    )
  })

  test('only an explicit false disables it', () => {
    const config = getDefaultRitualConfig()
    expect(
      getSiteSellMode({ ...config, site: { ...defaultSiteSelection(), sellMode: false } }),
    ).toBe(false)
    expect(
      getSiteSellMode({ ...config, site: { ...defaultSiteSelection(), sellMode: true } }),
    ).toBe(true)
  })
})

describe('getSiteApiBaseUrl', () => {
  test('reads site.apiBaseUrl, undefined when absent', () => {
    const config = getDefaultRitualConfig()
    expect(getSiteApiBaseUrl(config)).toBeUndefined()
    const withApi = {
      ...config,
      site: { ...defaultSiteSelection(), apiBaseUrl: 'https://api.example.com' },
    }
    expect(getSiteApiBaseUrl(withApi)).toBe('https://api.example.com')
  })
})

describe('parseSiteApiBaseUrl', () => {
  test('keeps a clean http(s) URL and strips trailing slashes', () => {
    expect(parseSiteApiBaseUrl('http://localhost:3000')).toBe('http://localhost:3000')
    expect(parseSiteApiBaseUrl('https://api.example.com//')).toBe('https://api.example.com')
  })

  test('accepts the empty string', () => {
    expect(parseSiteApiBaseUrl('')).toBe('')
  })

  test.each(['ws://x', 'example.com', 42, null])('rejects %p', (raw) => {
    expect(isConfigParseError(parseSiteApiBaseUrl(raw))).toBeTrue()
  })
})

describe('parseBannedPrinting', () => {
  test('lowercases the set code and keeps the collector number verbatim', () => {
    expect(parseBannedPrinting('SLD:123★')).toEqual({
      set: 'sld',
      collectorNumber: '123★',
      key: 'sld:123★',
    })
  })

  test.each(['sld', 'sld:', ':123', 'sld:12:3', '   '])('rejects malformed entry %p', (raw) => {
    expectParseError(parseBannedPrinting(raw), 'SET:COLLECTOR')
  })
})

describe('normalizeBannedPrintings', () => {
  test('dedupes after normalizing set codes', () => {
    expect(normalizeBannedPrintings(['SLD:123', 'sld:123', 'MH2:42'])).toEqual([
      'sld:123',
      'mh2:42',
    ])
  })

  test('returns error for a non-array', () => {
    expectParseError(normalizeBannedPrintings('SLD:123'), 'bannedPrintings')
  })
})

describe('config parser error shape', () => {
  test('isConfigParseError discriminates errors from success values', () => {
    expect(isConfigParseError({ error: 'nope' })).toBeTrue()
    expect(isConfigParseError('nope')).toBeFalse()
    expect(isConfigParseError(undefined)).toBeFalse()
    expect(isConfigParseError(null)).toBeFalse()
    expect(isConfigParseError({ set: 'sld', collectorNumber: '123', key: 'sld:123' })).toBeFalse()
  })

  test('parseDefaultCurrency returns the currency or a shared-shape error', () => {
    expect(parseDefaultCurrency('EUR')).toBe('eur')
    expectParseError(parseDefaultCurrency('gbp'), 'defaultCurrency')
  })

  test('parseDefaultLanguage returns the language or a shared-shape error', () => {
    expect(parseDefaultLanguage('JA')).toBe('ja')
    expect(parseDefaultLanguage(undefined)).toBe('en')
    // The error names every valid code, so the user can see the vocabulary.
    expectParseError(parseDefaultLanguage('jp'), 'defaultLanguage')
    expectParseError(parseDefaultLanguage('jp'), 'zhs')
  })

  test('parseCacheLockTimeoutSeconds returns the number or a shared-shape error', () => {
    expect(parseCacheLockTimeoutSeconds(60)).toBe(60)
    expectParseError(parseCacheLockTimeoutSeconds(0), 'positive integer')
  })

  test('parseCacheSource returns the source or a shared-shape error', () => {
    expect(parseCacheSource('feed')).toBe('feed')
    expectParseError(parseCacheSource('torrent'), 'cacheSource')
  })

  test('parseSearchDebounceMs returns the number or a shared-shape error', () => {
    expect(parseSearchDebounceMs(250)).toBe(250)
    expect(parseSearchDebounceMs(0)).toBe(0)
    expectParseError(parseSearchDebounceMs(-1), 'non-negative integer')
  })

  test('parseCacheFeedUrl parses only present values — absence is the caller’s check', () => {
    expect(parseCacheFeedUrl('https://feed.example/feed.json')).toBe(
      'https://feed.example/feed.json',
    )
    expectParseError(parseCacheFeedUrl('ftp://feed.example/feed.json'), 'http(s) URL')
    // undefined is no longer a success branch: callers skip parsing when absent.
    expectParseError(parseCacheFeedUrl(undefined), 'http(s) URL')
  })
})

describe('getBannedPrintings', () => {
  test('returns the configured keys as a set', () => {
    const config = { ...getDefaultRitualConfig(), site: { bannedPrintings: ['sld:123'] } }
    const banned = getBannedPrintings(config as RitualConfig)
    expect(banned.has('sld:123')).toBeTrue()
    expect(banned.size).toBe(1)
  })

  test('is empty when no site config is present', () => {
    expect(getBannedPrintings(getDefaultRitualConfig()).size).toBe(0)
  })
})

describe('getSiteSelectionConfig', () => {
  test('defaults include lists to ["*"] and exclude lists to [] when site is undefined', () => {
    expect(getSiteSelectionConfig(undefined)).toEqual({
      includeDecks: ['*'],
      includeCollections: ['*'],
      includeWantedLists: ['*'],
      excludeDecks: [],
      excludeCollections: [],
      excludeWantedLists: [],
    })
  })

  test('defaults missing exclude lists to [] alongside configured include lists', () => {
    const selection = getSiteSelectionConfig({
      includeDecks: ['Izzet Storm'],
      includeCollections: ['*'],
      includeWantedLists: ['*'],
    } as SiteConfig)
    expect(selection.includeDecks).toEqual(['Izzet Storm'])
    expect(selection.includeCollections).toEqual(['*'])
    expect(selection.includeWantedLists).toEqual(['*'])
    expect(selection.excludeDecks).toEqual([])
    expect(selection.excludeCollections).toEqual([])
    expect(selection.excludeWantedLists).toEqual([])
  })
})

describe('getSiteDeployConfig', () => {
  const selectionBase: SiteConfig = {
    includeDecks: ['*'],
    includeCollections: ['*'],
    includeWantedLists: ['*'],
    excludeDecks: [],
    excludeCollections: [],
    excludeWantedLists: [],
  }

  test('returns null when site is undefined', () => {
    expect(getSiteDeployConfig(undefined)).toBeNull()
  })

  test('returns null for a selection-only site (no deployment settings)', () => {
    expect(getSiteDeployConfig(selectionBase)).toBeNull()
  })

  test('reconstructs the github-actions deployment config', () => {
    expect(
      getSiteDeployConfig({
        ...selectionBase,
        version: '1.0.0',
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: false,
      }),
    ).toEqual({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: false,
    })
  })

  test('reconstructs the manual deployment config', () => {
    expect(
      getSiteDeployConfig({
        ...selectionBase,
        version: '2.1.0',
        ciSystem: 'manual',
      }),
    ).toEqual({ version: '2.1.0', ciSystem: 'manual' })
  })
})
