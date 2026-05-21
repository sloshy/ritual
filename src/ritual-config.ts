import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from './base-dir'
import { isValidSemver } from './semver'
import { INCLUDE_ALL, defaultSiteSelection, type SiteSelectionConfig } from './site/list-selection'

export { INCLUDE_ALL } from './site/list-selection'
export type { SiteSelectionConfig } from './site/list-selection'

export type CISystem = 'github-actions' | 'manual'
export type DeployMode = 'publish-for-me' | 'local-build'

export type GitHubActionsSiteConfig = {
  ciSystem: 'github-actions'
  deployMode: DeployMode
  distDir: string
  detectChanges: boolean
}

export type ManualSiteConfig = {
  ciSystem: 'manual'
}

/** Deployment config without a Ritual version — used during interactive `init-site` prompts. */
export type InitSiteConfig = GitHubActionsSiteConfig | ManualSiteConfig

/** Deployment config persisted on disk, including the Ritual version that initialized it. */
export type SiteDeployConfig = InitSiteConfig & { version: string }

/**
 * The persisted `site` object. The selection settings ({@link SiteSelectionConfig})
 * are always present, defaulting to `['*']` when absent. The init-site-managed
 * deployment settings are present only after `ritual init-site` has run;
 * reconstruct the discriminated deployment config with {@link getSiteDeployConfig}.
 */
export type SiteConfig = SiteSelectionConfig & {
  version?: string
  ciSystem?: CISystem
  deployMode?: DeployMode
  distDir?: string
  detectChanges?: boolean
}

export interface RitualConfig {
  decksDir: string
  collectionsDir: string
  wantedDir: string
  gitEnabled: boolean
  gitAutoCommit: boolean
  gitAutoPush: boolean
  trustProxy: boolean
  secureCookies: boolean
  ipAllowList: string[]
  ipDenyList: string[]
  userAgentAllowList: string[]
  userAgentDenyList: string[]
  rateLimitEnabled: boolean
  rateLimitMaxAttempts: number
  rateLimitWindowMinutes: number
  failedAuthDelayMs: number
  /** Present only when `ritual init-site` has been run; managed exclusively by that command. */
  site?: SiteConfig
}

const DEFAULT_CONFIG = {
  decksDir: './decks',
  collectionsDir: './collections',
  wantedDir: './wanted',
  gitEnabled: false,
  gitAutoCommit: false,
  gitAutoPush: false,
  trustProxy: false,
  secureCookies: false,
  ipAllowList: [] as string[],
  ipDenyList: [] as string[],
  userAgentAllowList: [] as string[],
  userAgentDenyList: [] as string[],
  rateLimitEnabled: true,
  rateLimitMaxAttempts: 5,
  rateLimitWindowMinutes: 5,
  failedAuthDelayMs: 3000,
} satisfies RitualConfig

const CONFIG_FILENAME = 'ritual.config.json'

let cachedConfig: RitualConfig | null = null

export function getRitualConfigPath(): string {
  return path.join(getBaseDir(), CONFIG_FILENAME)
}

export function getDefaultRitualConfig(): RitualConfig {
  return { ...DEFAULT_CONFIG }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * Parse one of the `include*` selection lists. Returns the default `['*']` when
 * absent, the array when valid, or an error string when malformed.
 */
function parseIncludeList(value: unknown, field: string): string[] | string {
  if (value === undefined) {
    return [INCLUDE_ALL]
  }
  if (!isStringArray(value)) {
    return `site config: "${field}" must be an array of strings`
  }
  return value
}

/**
 * Parse the `site` sub-object of a ritual.config.json. Returns the parsed
 * site config or an error string describing what is wrong.
 *
 * The selection settings (`includeDecks`, `includeCollections`,
 * `includeWantedLists`) always resolve, defaulting to `['*']`. The deployment
 * settings are validated only when present (i.e. once `init-site` has run).
 */
export function parseSiteConfig(value: unknown): SiteConfig | string {
  if (typeof value !== 'object' || value === null) {
    return 'site config must be a JSON object'
  }
  const obj = value as Record<string, unknown>

  const includeDecks = parseIncludeList(obj.includeDecks, 'includeDecks')
  if (typeof includeDecks === 'string') return includeDecks
  const includeCollections = parseIncludeList(obj.includeCollections, 'includeCollections')
  if (typeof includeCollections === 'string') return includeCollections
  const includeWantedLists = parseIncludeList(obj.includeWantedLists, 'includeWantedLists')
  if (typeof includeWantedLists === 'string') return includeWantedLists
  const selection: SiteSelectionConfig = { includeDecks, includeCollections, includeWantedLists }

  // Deployment settings are written only by `init-site`. Detect their presence
  // so a site object carrying just selection settings (set via config-set or the
  // admin UI before init-site has run) is still valid.
  const hasDeploy =
    obj.version !== undefined ||
    obj.ciSystem !== undefined ||
    obj.deployMode !== undefined ||
    obj.distDir !== undefined ||
    obj.detectChanges !== undefined

  if (!hasDeploy) {
    return selection
  }

  if (typeof obj.version !== 'string') {
    return 'site config: "version" must be a string'
  }
  if (!isValidSemver(obj.version)) {
    return 'site config: "version" is not a valid semver string'
  }
  if (obj.ciSystem !== 'github-actions' && obj.ciSystem !== 'manual') {
    return 'site config: "ciSystem" must be "github-actions" or "manual"'
  }

  if (obj.ciSystem === 'github-actions') {
    if (obj.deployMode !== 'publish-for-me' && obj.deployMode !== 'local-build') {
      return 'site config: "deployMode" must be "publish-for-me" or "local-build"'
    }
    if (typeof obj.distDir !== 'string') {
      return 'site config: "distDir" must be a string'
    }
    if (typeof obj.detectChanges !== 'boolean') {
      return 'site config: "detectChanges" must be a boolean'
    }
    return {
      ...selection,
      version: obj.version,
      ciSystem: obj.ciSystem,
      deployMode: obj.deployMode,
      distDir: obj.distDir,
      detectChanges: obj.detectChanges,
    }
  }

  return { ...selection, version: obj.version, ciSystem: obj.ciSystem }
}

/**
 * Resolve the public-site selection settings, defaulting each list to `['*']`
 * (include everything) when the `site` object or an individual list is absent.
 */
export function getSiteSelectionConfig(site: SiteConfig | undefined): SiteSelectionConfig {
  const defaults = defaultSiteSelection()
  return {
    includeDecks: site?.includeDecks ?? defaults.includeDecks,
    includeCollections: site?.includeCollections ?? defaults.includeCollections,
    includeWantedLists: site?.includeWantedLists ?? defaults.includeWantedLists,
  }
}

/**
 * Reconstruct the discriminated deployment config from a persisted `site`
 * object, or `null` when `init-site` has not run (no deployment settings).
 */
export function getSiteDeployConfig(site: SiteConfig | undefined): SiteDeployConfig | null {
  if (!site || site.version === undefined || site.ciSystem === undefined) {
    return null
  }
  if (site.ciSystem === 'github-actions') {
    if (
      site.deployMode === undefined ||
      site.distDir === undefined ||
      site.detectChanges === undefined
    ) {
      return null
    }
    return {
      version: site.version,
      ciSystem: 'github-actions',
      deployMode: site.deployMode,
      distDir: site.distDir,
      detectChanges: site.detectChanges,
    }
  }
  return { version: site.version, ciSystem: 'manual' }
}

/**
 * The raw, unvalidated config as read from disk. `site` is widened to `unknown`
 * because JSON.parse returns untrusted data; {@link parseSiteConfig} validates
 * and narrows it in {@link applyDefaults}.
 */
type ParsedConfigWithSite = Partial<RitualConfig> & { site?: unknown }

function applyDefaults(parsed: ParsedConfigWithSite): RitualConfig {
  const merged: RitualConfig = { ...DEFAULT_CONFIG, ...parsed, site: undefined }
  if (parsed.site !== undefined) {
    const site = parseSiteConfig(parsed.site)
    if (typeof site !== 'string') {
      merged.site = site
    } else {
      console.warn(`ritual.config.json: ignoring invalid site config — ${site}`)
    }
  }
  return merged
}

async function readConfigFromDisk(): Promise<RitualConfig | null> {
  try {
    const content = await fs.readFile(getRitualConfigPath(), 'utf-8')
    const parsed = JSON.parse(content) as ParsedConfigWithSite
    return applyDefaults(parsed)
  } catch {
    return null
  }
}

/**
 * Load ritual.config.json from the base dir, merging with defaults.
 * Returns the default config if the file does not exist.
 */
export async function loadRitualConfig(): Promise<RitualConfig> {
  const fromDisk = await readConfigFromDisk()
  return fromDisk ?? { ...DEFAULT_CONFIG }
}

export async function saveRitualConfig(config: RitualConfig): Promise<void> {
  await fs.writeFile(getRitualConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
  cachedConfig = { ...config }
}

/**
 * Initialize the cached ritual config. Reads ritual.config.json from the base
 * dir, or creates it with default settings if it does not exist. Must be
 * called after setBaseDir() and before any sync getter is used.
 */
export async function initRitualConfig(): Promise<RitualConfig> {
  const fromDisk = await readConfigFromDisk()
  if (fromDisk) {
    cachedConfig = fromDisk
    return fromDisk
  }
  const defaults = { ...DEFAULT_CONFIG }
  try {
    await saveRitualConfig(defaults)
  } catch {
    // If we can't persist (e.g. read-only fs), still cache defaults so the
    // current invocation works.
    cachedConfig = defaults
  }
  return defaults
}

/**
 * Re-read ritual.config.json into the cache. Use after the admin server
 * persists a config update so subsequent reads reflect the new values.
 */
export async function reloadRitualConfig(): Promise<RitualConfig> {
  const fromDisk = await readConfigFromDisk()
  cachedConfig = fromDisk ?? { ...DEFAULT_CONFIG }
  return cachedConfig
}

/**
 * Sync access to the cached ritual config. Falls back to defaults if
 * initRitualConfig() was never called (e.g. in tests that bypass index.ts).
 */
export function getRitualConfig(): RitualConfig {
  return cachedConfig ?? { ...DEFAULT_CONFIG }
}

function resolveDir(dir: string): string {
  return path.resolve(getBaseDir(), dir)
}

export function getDecksDir(config: RitualConfig = getRitualConfig()): string {
  return resolveDir(config.decksDir)
}

export function getCollectionsDir(config: RitualConfig = getRitualConfig()): string {
  return resolveDir(config.collectionsDir)
}

export function getWantedDir(config: RitualConfig = getRitualConfig()): string {
  return resolveDir(config.wantedDir)
}

/**
 * Reset the cached config. Intended for tests.
 */
export function resetRitualConfigCache(): void {
  cachedConfig = null
}
