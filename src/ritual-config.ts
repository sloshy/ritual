import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from './base-dir'
import {
  DEFAULT_CURRENCY,
  isPriceCurrency,
  VALID_CURRENCIES,
  type PriceCurrency,
} from './price-currency'
import { isValidSemver } from './semver'
import { DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS } from './cache/constants'
import { INCLUDE_ALL, defaultSiteSelection, type SiteSelectionConfig } from './site/list-selection'
import { parseExportPresets, type ExportPreset } from './export/presets'

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
  /**
   * Printings barred from being auto-selected as a card's default (representative)
   * printing, as canonical `set:collectorNumber` keys (set code lowercased, e.g.
   * `sld:123`). A banned printing can still be viewed or entered manually; it is
   * only skipped when Ritual picks the featured printing on its own.
   */
  bannedPrintings?: string[]
}

/**
 * Settings primarily configured through, and for, the admin server: git
 * integration for admin file changes, network access control, and login rate
 * limiting. Configured via the admin Settings page or `config-set admin.<field>`.
 */
export interface AdminConfig {
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
}

export interface RitualConfig {
  decksDir: string
  collectionsDir: string
  wantedDir: string
  /**
   * The currency every price-touching surface defaults to (the `price` command,
   * editor price displays, and the public site's initial currency). Always
   * present, defaulting to `usd`.
   */
  defaultCurrency: PriceCurrency
  /**
   * How long cache-refreshing operations wait for the cache-write lock held by
   * another process before failing. Always present, defaulting to 300 (5 minutes).
   */
  cacheLockTimeoutSeconds: number
  /**
   * Where card-cache refreshes download from: 'scryfall' hits Scryfall's bulk
   * API directly; 'feed' syncs from a peer-to-peer cache feed (falling back to
   * Scryfall when the feed is unreachable). Always present, defaulting to 'scryfall'.
   */
  cacheSource: CacheSource
  /** Cache feed URL used when `cacheSource` is 'feed'; the built-in default when absent. */
  cacheFeedUrl?: string
  /** Admin-server settings; always present, defaulting to {@link DEFAULT_ADMIN_CONFIG}. */
  admin: AdminConfig
  /** Present only when `ritual init-site` has been run; managed exclusively by that command. */
  site?: SiteConfig
  /**
   * Named `ritual export` output-shape presets (format, columns, CSV toggles),
   * managed via `ritual export --save-preset` or the interactive wizard.
   * Present only when at least one preset has been saved.
   */
  exportPresets?: Record<string, ExportPreset>
}

const DEFAULT_ADMIN_CONFIG = {
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
} satisfies AdminConfig

export type CacheSource = 'scryfall' | 'feed'

export const CACHE_SOURCES: readonly CacheSource[] = ['scryfall', 'feed']

const DEFAULT_CONFIG = {
  decksDir: './decks',
  collectionsDir: './collections',
  wantedDir: './wanted',
  defaultCurrency: DEFAULT_CURRENCY,
  cacheLockTimeoutSeconds: DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS,
  cacheSource: 'scryfall',
} satisfies Omit<RitualConfig, 'admin' | 'site' | 'cacheFeedUrl'>

const CONFIG_FILENAME = 'ritual.config.json'

let cachedConfig: RitualConfig | null = null

export function getRitualConfigPath(): string {
  return path.join(getBaseDir(), CONFIG_FILENAME)
}

export function getDefaultRitualConfig(): RitualConfig {
  return { ...DEFAULT_CONFIG, admin: { ...DEFAULT_ADMIN_CONFIG } }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * Parse one of the `include*`/`exclude*` selection lists. Returns the supplied
 * `fallback` when absent (`['*']` for include lists, `[]` for exclude lists), the
 * array when valid, or an error string when malformed.
 */
function parseSelectionList(value: unknown, field: string, fallback: string[]): string[] | string {
  if (value === undefined) {
    return fallback
  }
  if (!isStringArray(value)) {
    return `site config: "${field}" must be an array of strings`
  }
  return value
}

export type ParsedBannedPrinting = { set: string; collectorNumber: string; key: string }

/**
 * Parse one `bannedPrintings` entry of the form `SET:COLLECTOR` (e.g. `sld:123`).
 * The set code is normalized to lowercase; the collector number is kept verbatim.
 * Returns the parsed pieces plus the canonical `set:collectorNumber` key, or an
 * error string when the entry is malformed.
 */
export function parseBannedPrinting(raw: string): ParsedBannedPrinting | string {
  const trimmed = raw.trim()
  const colon = trimmed.indexOf(':')
  // Require exactly one ':' with non-empty text on each side.
  if (colon <= 0 || trimmed.indexOf(':', colon + 1) !== -1) {
    return `banned printing "${raw}" must be in "SET:COLLECTOR" form (e.g. "sld:123")`
  }
  const set = trimmed.slice(0, colon).toLowerCase()
  const collectorNumber = trimmed.slice(colon + 1).trim()
  if (set.length === 0 || collectorNumber.length === 0) {
    return `banned printing "${raw}" must be in "SET:COLLECTOR" form (e.g. "sld:123")`
  }
  return { set, collectorNumber, key: `${set}:${collectorNumber}` }
}

/**
 * Validate and normalize a `bannedPrintings` list. Every entry must parse as a
 * `SET:COLLECTOR` pair. Returns the deduped, normalized `set:collectorNumber`
 * keys (set codes lowercased) or an error string describing the first bad entry.
 */
export function normalizeBannedPrintings(value: unknown): string[] | string {
  if (!isStringArray(value)) {
    return 'site config: "bannedPrintings" must be an array of strings'
  }
  const keys: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const parsed = parseBannedPrinting(entry)
    if (typeof parsed === 'string') return `site config: ${parsed}`
    if (!seen.has(parsed.key)) {
      seen.add(parsed.key)
      keys.push(parsed.key)
    }
  }
  return keys
}

/**
 * Parse the `site` sub-object of a ritual.config.json. Returns the parsed
 * site config or an error string describing what is wrong.
 *
 * The selection settings (`includeDecks`, `includeCollections`,
 * `includeWantedLists` and their `exclude*` counterparts) always resolve, the
 * include lists defaulting to `['*']` and the exclude lists to `[]`. The
 * deployment settings are validated only when present (i.e. once `init-site` has run).
 */
export function parseSiteConfig(value: unknown): SiteConfig | string {
  if (typeof value !== 'object' || value === null) {
    return 'site config must be a JSON object'
  }
  const obj = value as Record<string, unknown>

  const includeDecks = parseSelectionList(obj.includeDecks, 'includeDecks', [INCLUDE_ALL])
  if (typeof includeDecks === 'string') return includeDecks
  const includeCollections = parseSelectionList(obj.includeCollections, 'includeCollections', [
    INCLUDE_ALL,
  ])
  if (typeof includeCollections === 'string') return includeCollections
  const includeWantedLists = parseSelectionList(obj.includeWantedLists, 'includeWantedLists', [
    INCLUDE_ALL,
  ])
  if (typeof includeWantedLists === 'string') return includeWantedLists
  const excludeDecks = parseSelectionList(obj.excludeDecks, 'excludeDecks', [])
  if (typeof excludeDecks === 'string') return excludeDecks
  const excludeCollections = parseSelectionList(obj.excludeCollections, 'excludeCollections', [])
  if (typeof excludeCollections === 'string') return excludeCollections
  const excludeWantedLists = parseSelectionList(obj.excludeWantedLists, 'excludeWantedLists', [])
  if (typeof excludeWantedLists === 'string') return excludeWantedLists
  const selection: SiteSelectionConfig = {
    includeDecks,
    includeCollections,
    includeWantedLists,
    excludeDecks,
    excludeCollections,
    excludeWantedLists,
  }

  let bannedPrintings: string[] | undefined
  if (obj.bannedPrintings !== undefined) {
    const parsed = normalizeBannedPrintings(obj.bannedPrintings)
    if (typeof parsed === 'string') return parsed
    bannedPrintings = parsed
  }
  // Only carry the key when present, so a selection-only config still equals its
  // selection object (no spurious empty `bannedPrintings`).
  const banned = bannedPrintings !== undefined ? { bannedPrintings } : {}

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
    return { ...selection, ...banned }
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
      ...banned,
      version: obj.version,
      ciSystem: obj.ciSystem,
      deployMode: obj.deployMode,
      distDir: obj.distDir,
      detectChanges: obj.detectChanges,
    }
  }

  return { ...selection, ...banned, version: obj.version, ciSystem: obj.ciSystem }
}

/**
 * Resolve the public-site selection settings, defaulting each include list to
 * `['*']` (include everything) and each exclude list to `[]` (exclude nothing)
 * when the `site` object or an individual list is absent.
 */
export function getSiteSelectionConfig(site: SiteConfig | undefined): SiteSelectionConfig {
  const defaults = defaultSiteSelection()
  return {
    includeDecks: site?.includeDecks ?? defaults.includeDecks,
    includeCollections: site?.includeCollections ?? defaults.includeCollections,
    includeWantedLists: site?.includeWantedLists ?? defaults.includeWantedLists,
    excludeDecks: site?.excludeDecks ?? defaults.excludeDecks,
    excludeCollections: site?.excludeCollections ?? defaults.excludeCollections,
    excludeWantedLists: site?.excludeWantedLists ?? defaults.excludeWantedLists,
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
 * The raw, unvalidated config as read from disk. `admin` and `site` are widened
 * to `unknown` because JSON.parse returns untrusted data; {@link parseAdminConfig}
 * and {@link parseSiteConfig} validate and narrow them in {@link applyDefaults}.
 */
type ParsedConfig = Omit<Partial<RitualConfig>, 'admin' | 'site' | 'exportPresets'> & {
  admin?: unknown
  site?: unknown
  exportPresets?: unknown
}

/** Validate a boolean admin field, defaulting when absent or erroring when malformed. */
function parseAdminBoolean(value: unknown, field: string, fallback: boolean): boolean | string {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') return `admin config: "${field}" must be a boolean`
  return value
}

/** Validate a numeric admin field, defaulting when absent or erroring when malformed. */
function parseAdminNumber(value: unknown, field: string, fallback: number): number | string {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `admin config: "${field}" must be a number`
  }
  return value
}

/** Validate a string-list admin field, defaulting when absent or erroring when malformed. */
function parseAdminStringList(
  value: unknown,
  field: string,
  fallback: string[],
): string[] | string {
  if (value === undefined) return fallback
  if (!isStringArray(value)) return `admin config: "${field}" must be an array of strings`
  return value
}

/**
 * Parse the `admin` sub-object of a ritual.config.json. Returns the parsed admin
 * config — each absent field defaulted from {@link DEFAULT_ADMIN_CONFIG} — or an
 * error string describing the first malformed field. Mirrors {@link parseSiteConfig}:
 * a single bad field invalidates the whole admin object (the caller falls back to
 * defaults), so settings cannot be silently coerced to the wrong type.
 */
export function parseAdminConfig(value: unknown): AdminConfig | string {
  if (value === undefined) return { ...DEFAULT_ADMIN_CONFIG }
  if (typeof value !== 'object' || value === null) {
    return 'admin config must be a JSON object'
  }
  const obj = value as Record<string, unknown>
  const d = DEFAULT_ADMIN_CONFIG

  const gitEnabled = parseAdminBoolean(obj.gitEnabled, 'gitEnabled', d.gitEnabled)
  if (typeof gitEnabled === 'string') return gitEnabled
  const gitAutoCommit = parseAdminBoolean(obj.gitAutoCommit, 'gitAutoCommit', d.gitAutoCommit)
  if (typeof gitAutoCommit === 'string') return gitAutoCommit
  const gitAutoPush = parseAdminBoolean(obj.gitAutoPush, 'gitAutoPush', d.gitAutoPush)
  if (typeof gitAutoPush === 'string') return gitAutoPush
  const trustProxy = parseAdminBoolean(obj.trustProxy, 'trustProxy', d.trustProxy)
  if (typeof trustProxy === 'string') return trustProxy
  const secureCookies = parseAdminBoolean(obj.secureCookies, 'secureCookies', d.secureCookies)
  if (typeof secureCookies === 'string') return secureCookies
  const ipAllowList = parseAdminStringList(obj.ipAllowList, 'ipAllowList', d.ipAllowList)
  if (typeof ipAllowList === 'string') return ipAllowList
  const ipDenyList = parseAdminStringList(obj.ipDenyList, 'ipDenyList', d.ipDenyList)
  if (typeof ipDenyList === 'string') return ipDenyList
  const userAgentAllowList = parseAdminStringList(
    obj.userAgentAllowList,
    'userAgentAllowList',
    d.userAgentAllowList,
  )
  if (typeof userAgentAllowList === 'string') return userAgentAllowList
  const userAgentDenyList = parseAdminStringList(
    obj.userAgentDenyList,
    'userAgentDenyList',
    d.userAgentDenyList,
  )
  if (typeof userAgentDenyList === 'string') return userAgentDenyList
  const rateLimitEnabled = parseAdminBoolean(
    obj.rateLimitEnabled,
    'rateLimitEnabled',
    d.rateLimitEnabled,
  )
  if (typeof rateLimitEnabled === 'string') return rateLimitEnabled
  const rateLimitMaxAttempts = parseAdminNumber(
    obj.rateLimitMaxAttempts,
    'rateLimitMaxAttempts',
    d.rateLimitMaxAttempts,
  )
  if (typeof rateLimitMaxAttempts === 'string') return rateLimitMaxAttempts
  const rateLimitWindowMinutes = parseAdminNumber(
    obj.rateLimitWindowMinutes,
    'rateLimitWindowMinutes',
    d.rateLimitWindowMinutes,
  )
  if (typeof rateLimitWindowMinutes === 'string') return rateLimitWindowMinutes
  const failedAuthDelayMs = parseAdminNumber(
    obj.failedAuthDelayMs,
    'failedAuthDelayMs',
    d.failedAuthDelayMs,
  )
  if (typeof failedAuthDelayMs === 'string') return failedAuthDelayMs

  return {
    gitEnabled,
    gitAutoCommit,
    gitAutoPush,
    trustProxy,
    secureCookies,
    ipAllowList,
    ipDenyList,
    userAgentAllowList,
    userAgentDenyList,
    rateLimitEnabled,
    rateLimitMaxAttempts,
    rateLimitWindowMinutes,
    failedAuthDelayMs,
  }
}

/** The error branch of {@link parseDefaultCurrency}. A currency is itself a
 * string, so the usual `T | string` parser union would not be discriminable —
 * the error is wrapped in a structured object instead. */
export type DefaultCurrencyParseError = { error: string }

/**
 * Parse the `defaultCurrency` config value. Absent falls back to `usd`; an
 * unrecognized value is reported as a structured error for the caller to surface.
 */
export function parseDefaultCurrency(value: unknown): PriceCurrency | DefaultCurrencyParseError {
  if (value === undefined) return DEFAULT_CURRENCY
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (isPriceCurrency(lower)) return lower
  }
  return { error: `"defaultCurrency" must be one of: ${VALID_CURRENCIES.join(', ')}` }
}

/**
 * Parse a `cacheLockTimeoutSeconds` value. Returns the number when it is a
 * positive integer, the default when absent, or an error string when malformed.
 */
export function parseCacheLockTimeoutSeconds(value: unknown): number | string {
  if (value === undefined) return DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return '"cacheLockTimeoutSeconds" must be a positive integer'
  }
  return value
}

export type CacheSourceParseError = { error: string }

/**
 * Parse a `cacheSource` value. Returns the source when valid, the default
 * when absent, or a structured error when malformed.
 */
export function parseCacheSource(value: unknown): CacheSource | CacheSourceParseError {
  if (value === undefined) return 'scryfall'
  if (typeof value === 'string' && (CACHE_SOURCES as readonly string[]).includes(value)) {
    return value as CacheSource
  }
  return { error: `"cacheSource" must be one of: ${CACHE_SOURCES.join(', ')}` }
}

export type CacheFeedUrlParseError = { error: string }

/**
 * Parse a `cacheFeedUrl` value. Returns the URL when it is a valid http(s)
 * URL, undefined when absent, or a structured error when malformed.
 */
export function parseCacheFeedUrl(value: unknown): string | undefined | CacheFeedUrlParseError {
  if (value === undefined) return undefined
  if (typeof value === 'string') {
    try {
      const url = new URL(value)
      if (url.protocol === 'http:' || url.protocol === 'https:') return value
    } catch {
      // Fall through to the error below.
    }
  }
  return { error: '"cacheFeedUrl" must be an http(s) URL' }
}

function applyDefaults(parsed: ParsedConfig): RitualConfig {
  const admin = parseAdminConfig(parsed.admin)
  if (typeof admin === 'string') {
    console.warn(`ritual.config.json: ignoring invalid admin config — ${admin}`)
  }
  const defaultCurrency = parseDefaultCurrency(parsed.defaultCurrency)
  if (typeof defaultCurrency !== 'string') {
    console.warn(`ritual.config.json: ignoring invalid defaultCurrency — ${defaultCurrency.error}`)
  }
  const cacheLockTimeoutSeconds = parseCacheLockTimeoutSeconds(parsed.cacheLockTimeoutSeconds)
  if (typeof cacheLockTimeoutSeconds === 'string') {
    console.warn(
      `ritual.config.json: ignoring invalid cacheLockTimeoutSeconds — ${cacheLockTimeoutSeconds}`,
    )
  }
  const cacheSource = parseCacheSource(parsed.cacheSource)
  if (typeof cacheSource !== 'string') {
    console.warn(`ritual.config.json: ignoring invalid cacheSource — ${cacheSource.error}`)
  }
  const cacheFeedUrl = parseCacheFeedUrl(parsed.cacheFeedUrl)
  if (cacheFeedUrl !== undefined && typeof cacheFeedUrl !== 'string') {
    console.warn(`ritual.config.json: ignoring invalid cacheFeedUrl — ${cacheFeedUrl.error}`)
  }
  const merged: RitualConfig = {
    decksDir: parsed.decksDir ?? DEFAULT_CONFIG.decksDir,
    collectionsDir: parsed.collectionsDir ?? DEFAULT_CONFIG.collectionsDir,
    wantedDir: parsed.wantedDir ?? DEFAULT_CONFIG.wantedDir,
    defaultCurrency: typeof defaultCurrency === 'string' ? defaultCurrency : DEFAULT_CURRENCY,
    cacheLockTimeoutSeconds:
      typeof cacheLockTimeoutSeconds === 'number'
        ? cacheLockTimeoutSeconds
        : DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS,
    cacheSource: typeof cacheSource === 'string' ? cacheSource : 'scryfall',
    admin: typeof admin === 'string' ? { ...DEFAULT_ADMIN_CONFIG } : admin,
  }
  if (typeof cacheFeedUrl === 'string') {
    merged.cacheFeedUrl = cacheFeedUrl
  }
  if (parsed.site !== undefined) {
    const site = parseSiteConfig(parsed.site)
    if (typeof site !== 'string') {
      merged.site = site
    } else {
      console.warn(`ritual.config.json: ignoring invalid site config — ${site}`)
    }
  }
  if (parsed.exportPresets !== undefined) {
    const exportPresets = parseExportPresets(parsed.exportPresets)
    if (typeof exportPresets !== 'string') {
      merged.exportPresets = exportPresets
    } else {
      console.warn(`ritual.config.json: ignoring invalid exportPresets — ${exportPresets}`)
    }
  }
  return merged
}

async function readConfigFromDisk(): Promise<RitualConfig | null> {
  try {
    const content = await fs.readFile(getRitualConfigPath(), 'utf-8')
    const parsed = JSON.parse(content) as ParsedConfig
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
  return fromDisk ?? getDefaultRitualConfig()
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
  const defaults = getDefaultRitualConfig()
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
  cachedConfig = fromDisk ?? getDefaultRitualConfig()
  return cachedConfig
}

/**
 * Sync access to the cached ritual config. Falls back to defaults if
 * initRitualConfig() was never called (e.g. in tests that bypass index.ts).
 */
export function getRitualConfig(): RitualConfig {
  return cachedConfig ?? getDefaultRitualConfig()
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

/** The configured default price currency (`usd` unless overridden). */
export function getDefaultCurrency(config: RitualConfig = getRitualConfig()): PriceCurrency {
  return config.defaultCurrency
}

/** How long to wait for the cache-write lock, in seconds (300 unless overridden). */
export function getCacheLockTimeoutSeconds(config: RitualConfig = getRitualConfig()): number {
  return config.cacheLockTimeoutSeconds
}

/** Where card-cache refreshes download from ('scryfall' unless overridden). */
export function getCacheSource(config: RitualConfig = getRitualConfig()): CacheSource {
  return config.cacheSource
}

/** The configured cache feed URL, or undefined to use the built-in default. */
export function getCacheFeedUrl(config: RitualConfig = getRitualConfig()): string | undefined {
  return config.cacheFeedUrl
}

/**
 * The set of `set:collectorNumber` keys barred from default-printing selection,
 * derived from `site.bannedPrintings`. Keys are already normalized (set code
 * lowercased) so callers match against `${card.set.toLowerCase()}:${card.collector_number}`.
 */
export function getBannedPrintings(config: RitualConfig = getRitualConfig()): Set<string> {
  return new Set(config.site?.bannedPrintings ?? [])
}

/** The saved `ritual export` presets, keyed by preset name (empty when none saved). */
export function getExportPresets(
  config: RitualConfig = getRitualConfig(),
): Record<string, ExportPreset> {
  return config.exportPresets ?? {}
}

/**
 * Reset the cached config. Intended for tests.
 */
export function resetRitualConfigCache(): void {
  cachedConfig = null
}
