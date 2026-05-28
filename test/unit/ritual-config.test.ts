import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  getDecksDir,
  getCollectionsDir,
  getWantedDir,
  getDefaultRitualConfig,
  getRitualConfig,
  getSiteDeployConfig,
  getSiteSelectionConfig,
  initRitualConfig,
  loadRitualConfig,
  parseAdminConfig,
  parseSiteConfig,
  resetRitualConfigCache,
  saveRitualConfig,
  type RitualConfig,
  type SiteConfig,
} from '../../src/ritual-config'
import { setBaseDir } from '../../src/base-dir'

const testDir = path.join(import.meta.dir, '../.test-ritual-config')
const configPath = path.join(testDir, 'ritual.config.json')

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

  test('loadRitualConfig falls back to defaults when file is malformed JSON', async () => {
    await fs.writeFile(configPath, '{ not valid json }')
    const config = await loadRitualConfig()
    expect(config).toEqual(getDefaultRitualConfig())
  })

  test('saveRitualConfig and loadRitualConfig round-trip', async () => {
    const config: RitualConfig = {
      decksDir: './my-decks',
      collectionsDir: './my-collections',
      wantedDir: './my-wanted',
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

  test('loadRitualConfig drops the whole admin object when a field has the wrong type', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ admin: { ipAllowList: ['1.2.3.4'], rateLimitMaxAttempts: 'lots' } }),
    )
    const config = await loadRitualConfig()
    expect(config.admin).toEqual(getDefaultRitualConfig().admin)
  })

  test('initRitualConfig creates ritual.config.json with defaults when missing', async () => {
    const config = await initRitualConfig()
    expect(config.decksDir).toBe('./decks')
    expect(config.wantedDir).toBe('./wanted')

    const written = await fs.readFile(configPath, 'utf-8')
    const parsed = JSON.parse(written)
    expect(parsed.decksDir).toBe('./decks')
    expect(parsed.wantedDir).toBe('./wanted')
  })

  test('initRitualConfig populates the cache for sync getters', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ decksDir: './custom-decks', wantedDir: './custom-wanted' }),
    )
    await initRitualConfig()
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
    await initRitualConfig()
    expect(getDecksDir()).toBe(path.join(testDir, 'my-decks'))
    expect(getCollectionsDir()).toBe(path.join(testDir, 'collections'))
    expect(getWantedDir()).toBe(path.resolve(testDir, '../shared-wanted'))
  })

  test('config without site key loads with site undefined', async () => {
    await fs.writeFile(configPath, JSON.stringify({ admin: { gitEnabled: true } }))
    const loaded = await loadRitualConfig()
    expect(loaded.site).toBeUndefined()
  })

  test('config with valid site key round-trips', async () => {
    const site: SiteConfig = {
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
    }
    const config = { ...getDefaultRitualConfig(), site }
    await saveRitualConfig(config)
    const loaded = await loadRitualConfig()
    expect(loaded.site).toEqual(site)
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

  test('site key with only selection lists (no deployment) is valid', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        site: {
          includeDecks: ['Izzet Storm', 'Black Panther'],
          includeWantedLists: [],
          excludeCollections: ['Secret Stash'],
        },
      }),
    )
    const loaded = await loadRitualConfig()
    expect(loaded.site).toEqual({
      includeDecks: ['Izzet Storm', 'Black Panther'],
      includeCollections: ['*'],
      includeWantedLists: [],
      excludeDecks: [],
      excludeCollections: ['Secret Stash'],
      excludeWantedLists: [],
    })
    expect(loaded.site?.version).toBeUndefined()
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

  test('returns error string when not an object', () => {
    expect(parseAdminConfig('nope') as string).toContain('admin config')
    expect(typeof parseAdminConfig(42)).toBe('string')
    expect(typeof parseAdminConfig(null)).toBe('string')
  })

  test('returns error naming the field when a boolean field is malformed', () => {
    const result = parseAdminConfig({ gitEnabled: 'yes' })
    expect(typeof result).toBe('string')
    expect(result as string).toContain('gitEnabled')
  })

  test.each([
    ['rateLimitMaxAttempts', { rateLimitMaxAttempts: 'lots' }],
    ['rateLimitWindowMinutes', { rateLimitWindowMinutes: 'a while' }],
    ['failedAuthDelayMs', { failedAuthDelayMs: 'slow' }],
  ])('returns error naming the field when number field %s is malformed', (field, input) => {
    const result = parseAdminConfig(input)
    expect(typeof result).toBe('string')
    expect(result as string).toContain(field)
  })

  test('returns error when a list field is not an array of strings', () => {
    expect(typeof parseAdminConfig({ ipAllowList: '10.0.0.1' })).toBe('string')
    expect(typeof parseAdminConfig({ userAgentDenyList: [1, 2] })).toBe('string')
  })

  test('ignores unknown extra fields', () => {
    const result = parseAdminConfig({ gitEnabled: true, somethingElse: 'ignored' })
    expect(result).toEqual({ ...defaults, gitEnabled: true })
  })
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
    expect(typeof parseSiteConfig({ includeDecks: 'Izzet Storm' })).toBe('string')
    expect(parseSiteConfig({ includeDecks: 'Izzet Storm' }) as string).toContain('includeDecks')
    expect(typeof parseSiteConfig({ includeCollections: [1, 2] })).toBe('string')
    expect(typeof parseSiteConfig({ excludeDecks: 'Old Brew' })).toBe('string')
    expect(parseSiteConfig({ excludeDecks: 'Old Brew' }) as string).toContain('excludeDecks')
  })

  test('returns error string when not an object', () => {
    expect(parseSiteConfig('just a string') as string).toContain('site config')
    expect(typeof parseSiteConfig(null)).toBe('string')
    expect(typeof parseSiteConfig(42)).toBe('string')
  })

  test('returns error string when version is not valid semver', () => {
    const result = parseSiteConfig({
      version: 'latest',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"version"')
  })

  test('returns error string when version is missing', () => {
    const result = parseSiteConfig({
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"version"')
  })

  test('returns error string when ciSystem is invalid', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'gitlab',
    })
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"ciSystem"')
  })

  test('returns error string when deployMode is invalid for github-actions', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'invalid',
      distDir: 'dist',
    })
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"deployMode"')
  })

  test('returns error when distDir is missing for github-actions', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      detectChanges: false,
    })
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"distDir"')
  })

  test('returns error when detectChanges is missing for github-actions', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"detectChanges"')
  })

  test('returns error when detectChanges is the wrong type for github-actions', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: 'yes',
    })
    expect(typeof result).toBe('string')
    expect(result as string).toContain('"detectChanges"')
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
