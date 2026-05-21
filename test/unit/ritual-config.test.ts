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
    expect(config.gitEnabled).toBe(false)
    expect(config.gitAutoCommit).toBe(false)
    expect(config.gitAutoPush).toBe(false)
  })

  test('loadRitualConfig returns defaults when file does not exist', async () => {
    const config = await loadRitualConfig()
    expect(config.decksDir).toBe('./decks')
    expect(config.wantedDir).toBe('./wanted')
    expect(config.gitEnabled).toBe(false)
  })

  test('saveRitualConfig and loadRitualConfig round-trip', async () => {
    const config: RitualConfig = {
      decksDir: './my-decks',
      collectionsDir: './my-collections',
      wantedDir: './my-wanted',
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
    }
    await saveRitualConfig(config)

    const loaded = await loadRitualConfig()
    expect(loaded).toEqual(config)
  })

  test('loadRitualConfig merges partial config with defaults', async () => {
    await fs.writeFile(configPath, JSON.stringify({ gitEnabled: true }))
    const config = await loadRitualConfig()
    expect(config.gitEnabled).toBe(true)
    expect(config.decksDir).toBe('./decks')
    expect(config.wantedDir).toBe('./wanted')
    expect(config.gitAutoCommit).toBe(false)
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
    await fs.writeFile(configPath, JSON.stringify({ gitEnabled: true }))
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
    })
  })

  test('site key with only selection lists (no deployment) is valid', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        site: {
          includeDecks: ['Izzet Storm', 'Black Panther'],
          includeWantedLists: [],
        },
      }),
    )
    const loaded = await loadRitualConfig()
    expect(loaded.site).toEqual({
      includeDecks: ['Izzet Storm', 'Black Panther'],
      includeCollections: ['*'],
      includeWantedLists: [],
    })
    expect(loaded.site?.version).toBeUndefined()
  })

  test('config with invalid site key drops the site value', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        gitEnabled: true,
        site: { ciSystem: 'github-actions' }, // missing version, deployMode, etc
      }),
    )
    const loaded = await loadRitualConfig()
    expect(loaded.site).toBeUndefined()
    expect(loaded.gitEnabled).toBe(true)
  })
})

describe('parseSiteConfig', () => {
  // Selection lists default to ['*'] (include all) when absent from the input.
  const defaultSelection = {
    includeDecks: ['*'],
    includeCollections: ['*'],
    includeWantedLists: ['*'],
  }

  test('parses valid github-actions publish-for-me config', () => {
    const result = parseSiteConfig({
      version: '0.1.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: false,
    })
    expect(result).toEqual({
      ...defaultSelection,
      version: '0.1.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: false,
    })
  })

  test('parses valid github-actions local-build config', () => {
    const result = parseSiteConfig({
      version: '0.2.0-beta1',
      ciSystem: 'github-actions',
      deployMode: 'local-build',
      distDir: 'public',
      detectChanges: false,
    })
    expect(result).toEqual({
      ...defaultSelection,
      version: '0.2.0-beta1',
      ciSystem: 'github-actions',
      deployMode: 'local-build',
      distDir: 'public',
      detectChanges: false,
    })
  })

  test('parses valid manual config', () => {
    const result = parseSiteConfig({ version: '1.0.0', ciSystem: 'manual' })
    expect(result).toEqual({ ...defaultSelection, version: '1.0.0', ciSystem: 'manual' })
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
    })
  })

  test('returns error when a selection list is not an array of strings', () => {
    expect(typeof parseSiteConfig({ includeDecks: 'Izzet Storm' })).toBe('string')
    expect(parseSiteConfig({ includeDecks: 'Izzet Storm' }) as string).toContain('includeDecks')
    expect(typeof parseSiteConfig({ includeCollections: [1, 2] })).toBe('string')
  })

  test('returns error string when not an object', () => {
    expect(typeof parseSiteConfig('just a string')).toBe('string')
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

  test('ignores extra unknown fields for github-actions config', () => {
    const result = parseSiteConfig({
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: false,
      unknown: 'field',
    })
    expect(result).toEqual({
      ...defaultSelection,
      version: '1.0.0',
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: false,
    })
  })

  test('ignores extra unknown fields for manual config', () => {
    const result = parseSiteConfig({ version: '1.0.0', ciSystem: 'manual', unknown: 'field' })
    expect(result).toEqual({ ...defaultSelection, version: '1.0.0', ciSystem: 'manual' })
  })
})

describe('getSiteSelectionConfig', () => {
  test('defaults every list to ["*"] when site is undefined', () => {
    expect(getSiteSelectionConfig(undefined)).toEqual({
      includeDecks: ['*'],
      includeCollections: ['*'],
      includeWantedLists: ['*'],
    })
  })

  test('returns the configured selection lists', () => {
    const selection = getSiteSelectionConfig({
      includeDecks: ['Izzet Storm'],
      includeCollections: [],
      includeWantedLists: ['*'],
    })
    expect(selection).toEqual({
      includeDecks: ['Izzet Storm'],
      includeCollections: [],
      includeWantedLists: ['*'],
    })
  })
})

describe('getSiteDeployConfig', () => {
  test('returns null when site is undefined', () => {
    expect(getSiteDeployConfig(undefined)).toBeNull()
  })

  test('returns null for a selection-only site (no deployment settings)', () => {
    expect(
      getSiteDeployConfig({
        includeDecks: ['*'],
        includeCollections: ['*'],
        includeWantedLists: ['*'],
      }),
    ).toBeNull()
  })

  test('reconstructs the github-actions deployment config', () => {
    expect(
      getSiteDeployConfig({
        includeDecks: ['*'],
        includeCollections: ['*'],
        includeWantedLists: ['*'],
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
        includeDecks: ['*'],
        includeCollections: ['*'],
        includeWantedLists: ['*'],
        version: '2.1.0',
        ciSystem: 'manual',
      }),
    ).toEqual({ version: '2.1.0', ciSystem: 'manual' })
  })
})
