import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from './base-dir'
import { CardCommandError, ExitCode, getErrorMessage, hasErrorCode } from '../util/errors'
import {
  DEFAULT_CURRENCY,
  isPriceCurrency,
  VALID_CURRENCIES,
  type PriceCurrency,
} from '../pricing/price-currency'
import { DEFAULT_PRICE_SOURCES, parsePriceSources, type PriceSource } from '../pricing/price-source'
import { isValidSemver } from './semver'
import { DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS } from '../cache/constants'
import { INCLUDE_ALL, defaultSiteSelection, type SiteSelectionConfig } from '../site/list-selection'
import { parseExportPresets, type ExportPreset } from '../export/presets'
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '../editor/search-debounce'
import {
  DEFAULT_CARD_LANGUAGE,
  invalidLanguageMessage,
  isCardLanguage,
  type CardLanguage,
} from '../card/card-language'
import { printingKey } from '../card/printing-key'
import { isLocaleTagError, parseLocaleTag } from '../i18n/locale-tag'
import { DEFAULT_LOCALE } from '../i18n/runtime'
import type { LocaleTag } from '../i18n/types'

export { INCLUDE_ALL } from '../site/list-selection'
export type { SiteSelectionConfig } from '../site/list-selection'

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
  /**
   * Base URL of a live read-only API backing the built public site, baked into
   * `index.json` so a statically-deployed site (e.g. a CDN) uses a separately
   * hosted `ritual serve --api` instance. `''` means "same origin" (the site is
   * reverse-proxied together with its API). Absent = fully static site.
   */
  apiBaseUrl?: string
  /**
   * Whether the site offers sell mode: the buylist filter, per-card buyer
   * quotes, buylist grouping/sorting, and the sell-cart export. **Disabled
   * unless explicitly set to `true`** — see {@link getSiteSellMode} — because
   * enabling it makes every build and cache refresh download and index Card
   * Kingdom's ~70 MB buylist. A single run can opt in without changing the
   * config through `--sell-mode` ({@link setSiteSellModeOverride}).
   */
  sellMode?: boolean
}

/**
 * Settings primarily configured through, and for, the admin server: git
 * integration for admin file changes, network access control, and login rate
 * limiting. Configured via the admin Settings page or `config set admin.<field>`.
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

/**
 * Settings for `ritual collection-sync`. Always present, defaulting to
 * {@link DEFAULT_COLLECTION_SYNC_CONFIG}.
 */
export interface CollectionSyncConfig {
  /**
   * The collection list a pull writes new cards into, created on first use. A
   * pulled card belongs in *some* binder and only you know which, so every
   * addition lands here unless `collection-sync --into` overrides it.
   */
  pullTarget: string
}

export interface RitualConfig {
  decksDir: string
  collectionsDir: string
  wantedDir: string
  /**
   * Where custom card art lives: the directory a card's `.art.json` `file`
   * reference is relative to. Always present, defaulting to `./art`. Nothing
   * creates it — a missing directory simply means the workspace has no local
   * art, and only a reference to a file that is not there is an error.
   */
  artDir: string
  /**
   * The currency every price-touching surface defaults to (the `price` command,
   * editor price displays, and the public site's initial currency). Always
   * present, defaulting to `usd`.
   */
  defaultCurrency: PriceCurrency
  /**
   * The stores whose prices the sites offer: `tcgplayer` (Scryfall USD, the
   * default), `cardmarket` (Scryfall EUR), and `cardkingdom` (Card Kingdom NM
   * retail from the buylist pricelist feed). Always present, defaulting to
   * `['tcgplayer']`. An explicit empty array means the sites display no prices
   * at all; the CLI `price` command and sell mode are unaffected by it.
   * Enabling `cardkingdom` makes builds and servers download/refresh the Card
   * Kingdom feed exactly as `site.sellMode` does.
   */
  priceSources: PriceSource[]
  /**
   * The language stamped on newly added cards, and the selector for which
   * Scryfall bulk backs the card cache (`en` → `default_cards`, anything else →
   * `all_cards`). A bare card line always means `en` regardless of this setting —
   * files stay self-describing. Always present, defaulting to `en`.
   */
  defaultLanguage: CardLanguage
  /**
   * The BCP-47 tag naming the language Ritual's own interface speaks — CLI help,
   * prompts, status output, and both web UIs. Deliberately *not* spelled
   * "language": {@link RitualConfig.defaultLanguage} picks which *printing* of a
   * card is used and switches which Scryfall bulk is downloaded. The two are
   * orthogonal — a German interface listing English card names is valid and
   * expected. Always present, defaulting to `en`.
   *
   * Note for locale resolution: the loader materializes `en` here whether or not
   * the file names a value, because a defaulted key is what `config get`/`list`
   * must report. The *precedence* chain therefore reads the file directly (see
   * `src/i18n/config-preread.ts`) so "absent" stays distinguishable from
   * "explicitly en" — only the latter outranks OS detection.
   */
  uiLocale: LocaleTag
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
  /**
   * How long (ms) the web editors' add-card search waits after a keystroke
   * before firing an autocomplete request. Applies to the admin editors at
   * runtime and is baked into the public site at build time. `0` disables the
   * debounce entirely. Always present, defaulting to 500.
   */
  searchDebounceMs: number
  /** Admin-server settings; always present, defaulting to {@link DEFAULT_ADMIN_CONFIG}. */
  admin: AdminConfig
  /**
   * Collection-sync settings; always present, defaulting to
   * {@link DEFAULT_COLLECTION_SYNC_CONFIG}.
   */
  collectionSync: CollectionSyncConfig
  /** Present only when `ritual init-site` has been run; managed exclusively by that command. */
  site?: SiteConfig
  /**
   * Named `ritual export` output-shape presets (format, columns, CSV toggles),
   * managed via `ritual export --save-preset` or the interactive wizard.
   * Present only when at least one preset has been saved.
   */
  exportPresets?: Record<string, ExportPreset>
}

export const DEFAULT_ADMIN_CONFIG = {
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

export const DEFAULT_COLLECTION_SYNC_CONFIG = {
  pullTarget: 'Inbox',
} satisfies CollectionSyncConfig

export type CacheSource = 'scryfall' | 'feed'

export const CACHE_SOURCES: readonly CacheSource[] = ['scryfall', 'feed']

const DEFAULT_CONFIG = {
  decksDir: './decks',
  collectionsDir: './collections',
  wantedDir: './wanted',
  artDir: './art',
  defaultCurrency: DEFAULT_CURRENCY,
  priceSources: [...DEFAULT_PRICE_SOURCES],
  defaultLanguage: DEFAULT_CARD_LANGUAGE,
  uiLocale: DEFAULT_LOCALE,
  cacheLockTimeoutSeconds: DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS,
  cacheSource: 'scryfall',
  searchDebounceMs: DEFAULT_SEARCH_DEBOUNCE_MS,
} satisfies Omit<RitualConfig, 'admin' | 'collectionSync' | 'site' | 'cacheFeedUrl'>

const CONFIG_FILENAME = 'ritual.config.json'

let cachedConfig: RitualConfig | null = null

export function getRitualConfigPath(): string {
  return path.join(getBaseDir(), CONFIG_FILENAME)
}

export function getDefaultRitualConfig(): RitualConfig {
  return {
    ...DEFAULT_CONFIG,
    admin: { ...DEFAULT_ADMIN_CONFIG },
    collectionSync: { ...DEFAULT_COLLECTION_SYNC_CONFIG },
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * The error branch shared by every config parser: a structured `{ error }`
 * object rather than a bare string. Several parsers succeed with a string
 * (currencies, URLs), so a `T | string` union would not be discriminable —
 * every parser returns this shape instead, and every consumer branches via
 * {@link isConfigParseError}.
 */
export type ConfigParseError = { error: string }

/** True when a config parser result is the {@link ConfigParseError} branch. */
export function isConfigParseError(value: unknown): value is ConfigParseError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ConfigParseError>).error === 'string'
  )
}

/**
 * Parse one of the `include*`/`exclude*` selection lists. Returns the supplied
 * `fallback` when absent (`['*']` for include lists, `[]` for exclude lists), the
 * array when valid, or a parse error when malformed.
 */
function parseSelectionList(
  value: unknown,
  field: string,
  fallback: string[],
): string[] | ConfigParseError {
  if (value === undefined) {
    return fallback
  }
  if (!isStringArray(value)) {
    return { error: `site config: "${field}" must be an array of strings` }
  }
  return value
}

export type ParsedBannedPrinting = { set: string; collectorNumber: string; key: string }

/**
 * Parse one `bannedPrintings` entry of the form `SET:COLLECTOR` (e.g. `sld:123`).
 * The set code is normalized to lowercase; the collector number is kept verbatim.
 * Returns the parsed pieces plus the canonical `set:collectorNumber` key, or a
 * parse error when the entry is malformed.
 */
export function parseBannedPrinting(raw: string): ParsedBannedPrinting | ConfigParseError {
  const trimmed = raw.trim()
  const colon = trimmed.indexOf(':')
  // Require exactly one ':' with non-empty text on each side.
  if (colon <= 0 || trimmed.indexOf(':', colon + 1) !== -1) {
    return { error: `banned printing "${raw}" must be in "SET:COLLECTOR" form (e.g. "sld:123")` }
  }
  const set = trimmed.slice(0, colon).toLowerCase()
  const collectorNumber = trimmed.slice(colon + 1).trim()
  if (set.length === 0 || collectorNumber.length === 0) {
    return { error: `banned printing "${raw}" must be in "SET:COLLECTOR" form (e.g. "sld:123")` }
  }
  return { set, collectorNumber, key: printingKey(set, collectorNumber) }
}

/**
 * Validate and normalize a `bannedPrintings` list. Every entry must parse as a
 * `SET:COLLECTOR` pair. Returns the deduped, normalized `set:collectorNumber`
 * keys (set codes lowercased) or a parse error describing the first bad entry.
 */
export function normalizeBannedPrintings(value: unknown): string[] | ConfigParseError {
  if (!isStringArray(value)) {
    return { error: 'site config: "bannedPrintings" must be an array of strings' }
  }
  const keys: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const parsed = parseBannedPrinting(entry)
    if (isConfigParseError(parsed)) return { error: `site config: ${parsed.error}` }
    if (!seen.has(parsed.key)) {
      seen.add(parsed.key)
      keys.push(parsed.key)
    }
  }
  return keys
}

/**
 * Parse the `site` sub-object of a ritual.config.json. Returns the parsed
 * site config or a parse error describing what is wrong.
 *
 * The selection settings (`includeDecks`, `includeCollections`,
 * `includeWantedLists` and their `exclude*` counterparts) always resolve, the
 * include lists defaulting to `['*']` and the exclude lists to `[]`. The
 * deployment settings are validated only when present (i.e. once `init-site` has run).
 */
export function parseSiteConfig(value: unknown): SiteConfig | ConfigParseError {
  if (typeof value !== 'object' || value === null) {
    return { error: 'site config must be a JSON object' }
  }
  const obj = value as Record<string, unknown>

  const includeDecks = parseSelectionList(obj.includeDecks, 'includeDecks', [INCLUDE_ALL])
  if (isConfigParseError(includeDecks)) return includeDecks
  const includeCollections = parseSelectionList(obj.includeCollections, 'includeCollections', [
    INCLUDE_ALL,
  ])
  if (isConfigParseError(includeCollections)) return includeCollections
  const includeWantedLists = parseSelectionList(obj.includeWantedLists, 'includeWantedLists', [
    INCLUDE_ALL,
  ])
  if (isConfigParseError(includeWantedLists)) return includeWantedLists
  const excludeDecks = parseSelectionList(obj.excludeDecks, 'excludeDecks', [])
  if (isConfigParseError(excludeDecks)) return excludeDecks
  const excludeCollections = parseSelectionList(obj.excludeCollections, 'excludeCollections', [])
  if (isConfigParseError(excludeCollections)) return excludeCollections
  const excludeWantedLists = parseSelectionList(obj.excludeWantedLists, 'excludeWantedLists', [])
  if (isConfigParseError(excludeWantedLists)) return excludeWantedLists
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
    if (isConfigParseError(parsed)) return parsed
    bannedPrintings = parsed
  }
  // Only carry the key when present, so a selection-only config still equals its
  // selection object (no spurious empty `bannedPrintings`).
  const banned = bannedPrintings !== undefined ? { bannedPrintings } : {}

  let apiBaseUrl: string | undefined
  if (obj.apiBaseUrl !== undefined) {
    const parsed = parseSiteApiBaseUrl(obj.apiBaseUrl)
    if (isConfigParseError(parsed)) return parsed
    apiBaseUrl = parsed
  }
  const api = apiBaseUrl !== undefined ? { apiBaseUrl } : {}

  if (obj.sellMode !== undefined && typeof obj.sellMode !== 'boolean') {
    return { error: 'site config: "sellMode" must be a boolean' }
  }
  const sell = obj.sellMode !== undefined ? { sellMode: obj.sellMode } : {}

  // Deployment settings are written only by `init-site`. Detect their presence
  // so a site object carrying just selection settings (set via `config set` or the
  // admin UI before init-site has run) is still valid.
  const hasDeploy =
    obj.version !== undefined ||
    obj.ciSystem !== undefined ||
    obj.deployMode !== undefined ||
    obj.distDir !== undefined ||
    obj.detectChanges !== undefined

  if (!hasDeploy) {
    return { ...selection, ...banned, ...api, ...sell }
  }

  if (typeof obj.version !== 'string') {
    return { error: 'site config: "version" must be a string' }
  }
  if (!isValidSemver(obj.version)) {
    return { error: 'site config: "version" is not a valid semver string' }
  }
  if (obj.ciSystem !== 'github-actions' && obj.ciSystem !== 'manual') {
    return { error: 'site config: "ciSystem" must be "github-actions" or "manual"' }
  }

  if (obj.ciSystem === 'github-actions') {
    if (obj.deployMode !== 'publish-for-me' && obj.deployMode !== 'local-build') {
      return { error: 'site config: "deployMode" must be "publish-for-me" or "local-build"' }
    }
    if (typeof obj.distDir !== 'string') {
      return { error: 'site config: "distDir" must be a string' }
    }
    if (typeof obj.detectChanges !== 'boolean') {
      return { error: 'site config: "detectChanges" must be a boolean' }
    }
    return {
      ...selection,
      ...banned,
      ...api,
      ...sell,
      version: obj.version,
      ciSystem: obj.ciSystem,
      deployMode: obj.deployMode,
      distDir: obj.distDir,
      detectChanges: obj.detectChanges,
    }
  }

  return { ...selection, ...banned, ...api, ...sell, version: obj.version, ciSystem: obj.ciSystem }
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
 * The raw, unvalidated config as read from disk. The nested objects are widened
 * to `unknown` because JSON.parse returns untrusted data; {@link parseAdminConfig},
 * {@link parseCollectionSyncConfig}, and {@link parseSiteConfig} validate and
 * narrow them in {@link applyDefaults}.
 */
type ParsedConfig = Omit<
  Partial<RitualConfig>,
  'admin' | 'collectionSync' | 'site' | 'exportPresets' | 'priceSources'
> & {
  admin?: unknown
  collectionSync?: unknown
  site?: unknown
  exportPresets?: unknown
  /** Untrusted until {@link parsePriceSources} has run. */
  priceSources?: unknown
}

/** Validate a boolean admin field, defaulting when absent or erroring when malformed. */
function parseAdminBoolean(
  value: unknown,
  field: string,
  fallback: boolean,
): boolean | ConfigParseError {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') return { error: `admin config: "${field}" must be a boolean` }
  return value
}

/** Validate a numeric admin field, defaulting when absent or erroring when malformed. */
function parseAdminNumber(
  value: unknown,
  field: string,
  fallback: number,
): number | ConfigParseError {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { error: `admin config: "${field}" must be a number` }
  }
  return value
}

/** Validate a string-list admin field, defaulting when absent or erroring when malformed. */
function parseAdminStringList(
  value: unknown,
  field: string,
  fallback: string[],
): string[] | ConfigParseError {
  if (value === undefined) return fallback
  if (!isStringArray(value)) {
    return { error: `admin config: "${field}" must be an array of strings` }
  }
  return value
}

/**
 * Parse the `admin` sub-object of a ritual.config.json. Returns the parsed admin
 * config — each absent field defaulted from {@link DEFAULT_ADMIN_CONFIG} — or a
 * parse error describing the first malformed field. Mirrors {@link parseSiteConfig}:
 * a single bad field invalidates the whole admin object (the caller falls back to
 * defaults), so settings cannot be silently coerced to the wrong type.
 */
export function parseAdminConfig(value: unknown): AdminConfig | ConfigParseError {
  if (value === undefined) return { ...DEFAULT_ADMIN_CONFIG }
  if (typeof value !== 'object' || value === null) {
    return { error: 'admin config must be a JSON object' }
  }
  const obj = value as Record<string, unknown>
  const d = DEFAULT_ADMIN_CONFIG

  const gitEnabled = parseAdminBoolean(obj.gitEnabled, 'gitEnabled', d.gitEnabled)
  if (isConfigParseError(gitEnabled)) return gitEnabled
  const gitAutoCommit = parseAdminBoolean(obj.gitAutoCommit, 'gitAutoCommit', d.gitAutoCommit)
  if (isConfigParseError(gitAutoCommit)) return gitAutoCommit
  const gitAutoPush = parseAdminBoolean(obj.gitAutoPush, 'gitAutoPush', d.gitAutoPush)
  if (isConfigParseError(gitAutoPush)) return gitAutoPush
  const trustProxy = parseAdminBoolean(obj.trustProxy, 'trustProxy', d.trustProxy)
  if (isConfigParseError(trustProxy)) return trustProxy
  const secureCookies = parseAdminBoolean(obj.secureCookies, 'secureCookies', d.secureCookies)
  if (isConfigParseError(secureCookies)) return secureCookies
  const ipAllowList = parseAdminStringList(obj.ipAllowList, 'ipAllowList', d.ipAllowList)
  if (isConfigParseError(ipAllowList)) return ipAllowList
  const ipDenyList = parseAdminStringList(obj.ipDenyList, 'ipDenyList', d.ipDenyList)
  if (isConfigParseError(ipDenyList)) return ipDenyList
  const userAgentAllowList = parseAdminStringList(
    obj.userAgentAllowList,
    'userAgentAllowList',
    d.userAgentAllowList,
  )
  if (isConfigParseError(userAgentAllowList)) return userAgentAllowList
  const userAgentDenyList = parseAdminStringList(
    obj.userAgentDenyList,
    'userAgentDenyList',
    d.userAgentDenyList,
  )
  if (isConfigParseError(userAgentDenyList)) return userAgentDenyList
  const rateLimitEnabled = parseAdminBoolean(
    obj.rateLimitEnabled,
    'rateLimitEnabled',
    d.rateLimitEnabled,
  )
  if (isConfigParseError(rateLimitEnabled)) return rateLimitEnabled
  const rateLimitMaxAttempts = parseAdminNumber(
    obj.rateLimitMaxAttempts,
    'rateLimitMaxAttempts',
    d.rateLimitMaxAttempts,
  )
  if (isConfigParseError(rateLimitMaxAttempts)) return rateLimitMaxAttempts
  const rateLimitWindowMinutes = parseAdminNumber(
    obj.rateLimitWindowMinutes,
    'rateLimitWindowMinutes',
    d.rateLimitWindowMinutes,
  )
  if (isConfigParseError(rateLimitWindowMinutes)) return rateLimitWindowMinutes
  const failedAuthDelayMs = parseAdminNumber(
    obj.failedAuthDelayMs,
    'failedAuthDelayMs',
    d.failedAuthDelayMs,
  )
  if (isConfigParseError(failedAuthDelayMs)) return failedAuthDelayMs

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

/**
 * Parse a `collectionSync.pullTarget` value: the name of the collection list a
 * pull writes new cards into. Absent falls back to `Inbox`; anything that is
 * not a non-blank list name is a parse error, since a blank target would leave
 * a pull with nowhere to put the cards it found.
 */
export function parseCollectionSyncPullTarget(value: unknown): string | ConfigParseError {
  if (value === undefined) return DEFAULT_COLLECTION_SYNC_CONFIG.pullTarget
  if (typeof value !== 'string' || value.trim() === '') {
    return { error: 'collectionSync config: "pullTarget" must be a non-empty list name' }
  }
  return value.trim()
}

/**
 * Parse the `collectionSync` sub-object of a ritual.config.json. Mirrors
 * {@link parseAdminConfig}: an absent object (or an absent field within it)
 * defaults from {@link DEFAULT_COLLECTION_SYNC_CONFIG}, and a single malformed
 * field invalidates the whole object rather than being silently coerced.
 */
export function parseCollectionSyncConfig(value: unknown): CollectionSyncConfig | ConfigParseError {
  if (value === undefined) return { ...DEFAULT_COLLECTION_SYNC_CONFIG }
  if (typeof value !== 'object' || value === null) {
    return { error: 'collectionSync config must be a JSON object' }
  }
  const obj = value as Record<string, unknown>
  const pullTarget = parseCollectionSyncPullTarget(obj.pullTarget)
  if (isConfigParseError(pullTarget)) return pullTarget
  return { pullTarget }
}

/**
 * Parse the `defaultCurrency` config value. Absent falls back to `usd`; an
 * unrecognized value is reported as a parse error for the caller to surface.
 */
export function parseDefaultCurrency(value: unknown): PriceCurrency | ConfigParseError {
  if (value === undefined) return DEFAULT_CURRENCY
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (isPriceCurrency(lower)) return lower
  }
  return { error: `"defaultCurrency" must be one of: ${VALID_CURRENCIES.join(', ')}` }
}

/**
 * Parse the `defaultLanguage` config value. Absent falls back to `en`; an
 * unrecognized value is reported as a parse error for the caller to surface.
 * Only the canonical Scryfall codes are accepted here — aliases like `jp` are
 * a `config set`-time convenience, not a persisted spelling.
 */
export function parseDefaultLanguage(value: unknown): CardLanguage | ConfigParseError {
  if (value === undefined) return DEFAULT_CARD_LANGUAGE
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (isCardLanguage(lower)) return lower
  }
  return { error: invalidLanguageMessage(value, 'for "defaultLanguage"') }
}

/**
 * Parse a UI locale tag: the `uiLocale` config value, the `--locale` flag, and
 * `RITUAL_LOCALE` all funnel through here. Absent falls back to `en`.
 *
 * Two gates, because BCP-47 well-formedness alone is not enough: `new
 * Intl.Locale()` accepts `zz-ZZ` (structurally fine, no such language), which
 * would then silently render English forever. `supportedLocalesOf` is the
 * engine's own answer to "is this a language I know", so a typo is rejected at
 * the edge instead of degrading invisibly.
 *
 * The returned tag is canonicalized (`de-at` → `de-AT`) so cache keys,
 * comparisons, and the persisted value all agree.
 *
 * The message names no config key: it is shared verbatim by the `--locale`
 * flag's argParser and by `RITUAL_LOCALE`, and the config load path prefixes the
 * field label itself (see {@link parseOrWarn}).
 */
export function parseUiLocale(value: unknown): LocaleTag | ConfigParseError {
  if (value === undefined) return DEFAULT_LOCALE
  const parsed = parseLocaleTag(value)
  if (isLocaleTagError(parsed)) {
    return { error: `invalid UI locale: ${parsed.error}` }
  }
  if (!isRecognizedLocale(parsed)) {
    return {
      error: `invalid UI locale "${parsed}": no such language is known (expected a BCP-47 tag such as "en" or "de-AT")`,
    }
  }
  return parsed
}

/**
 * Whether the engine recognizes the tag's language at all. Called only with a
 * structurally valid tag (so `supportedLocalesOf` cannot throw), but guarded
 * anyway — an unrecognized locale must degrade to "not a locale", never to a
 * crash on the validation path.
 */
function isRecognizedLocale(tag: LocaleTag): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0
  } catch {
    return false
  }
}

/**
 * Parse a `cacheLockTimeoutSeconds` value. Returns the number when it is a
 * positive integer, the default when absent, or a parse error when malformed.
 */
export function parseCacheLockTimeoutSeconds(value: unknown): number | ConfigParseError {
  if (value === undefined) return DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { error: '"cacheLockTimeoutSeconds" must be a positive integer' }
  }
  return value
}

/**
 * Parse a `searchDebounceMs` value. Returns the number when it is a
 * non-negative integer (0 disables the debounce), the default when absent, or
 * a parse error when malformed.
 */
export function parseSearchDebounceMs(value: unknown): number | ConfigParseError {
  if (value === undefined) return DEFAULT_SEARCH_DEBOUNCE_MS
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { error: '"searchDebounceMs" must be a non-negative integer' }
  }
  return value
}

/**
 * Parse a `cacheSource` value. Returns the source when valid, the default
 * when absent, or a parse error when malformed.
 */
export function parseCacheSource(value: unknown): CacheSource | ConfigParseError {
  if (value === undefined) return 'scryfall'
  if (typeof value === 'string' && (CACHE_SOURCES as readonly string[]).includes(value)) {
    return value as CacheSource
  }
  return { error: `"cacheSource" must be one of: ${CACHE_SOURCES.join(', ')}` }
}

/**
 * Parse a `cacheFeedUrl` value. Returns the URL when it is a valid http(s)
 * URL, or a parse error when malformed. Absence means "use the built-in
 * default" and is the caller's concern: check for `undefined` before parsing —
 * an `undefined` input is malformed here.
 */
export function parseCacheFeedUrl(value: unknown): string | ConfigParseError {
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

/**
 * Parse a `site.apiBaseUrl` value. `''` is valid and means "same origin" (the
 * site is reverse-proxied together with its API); otherwise the value must be
 * an http(s) URL, normalized to carry no trailing slash. Absence means "fully
 * static site" and is the caller's concern — an `undefined` input is malformed
 * here.
 */
export function parseSiteApiBaseUrl(value: unknown): string | ConfigParseError {
  if (typeof value !== 'string') {
    return { error: 'site config: "apiBaseUrl" must be a string' }
  }
  if (value === '') return ''
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return value.replace(/\/+$/, '')
    }
  } catch {
    // Fall through to the error below.
  }
  return { error: 'site config: "apiBaseUrl" must be an http(s) URL or an empty string' }
}

/**
 * Collapse a parser result to its value, or warn and return `fallback` when it
 * is the error branch. The load path never fails on a bad field — it logs and
 * continues with the field's default.
 */
function parseOrWarn<T>(parsed: T | ConfigParseError, fieldLabel: string, fallback: T): T {
  if (isConfigParseError(parsed)) {
    console.warn(`ritual.config.json: ignoring invalid ${fieldLabel} — ${parsed.error}`)
    return fallback
  }
  return parsed
}

function applyDefaults(parsed: ParsedConfig): RitualConfig {
  // Absence means "use the built-in default", so cacheFeedUrl only parses when
  // present; a malformed value falls back to absent.
  const cacheFeedUrl =
    parsed.cacheFeedUrl !== undefined
      ? parseOrWarn<string | undefined>(
          parseCacheFeedUrl(parsed.cacheFeedUrl),
          'cacheFeedUrl',
          undefined,
        )
      : undefined
  const merged: RitualConfig = {
    decksDir: parsed.decksDir ?? DEFAULT_CONFIG.decksDir,
    collectionsDir: parsed.collectionsDir ?? DEFAULT_CONFIG.collectionsDir,
    wantedDir: parsed.wantedDir ?? DEFAULT_CONFIG.wantedDir,
    artDir: parsed.artDir ?? DEFAULT_CONFIG.artDir,
    defaultCurrency: parseOrWarn(
      parseDefaultCurrency(parsed.defaultCurrency),
      'defaultCurrency',
      DEFAULT_CURRENCY,
    ),
    priceSources: parseOrWarn(parsePriceSources(parsed.priceSources), 'priceSources', [
      ...DEFAULT_PRICE_SOURCES,
    ]),
    defaultLanguage: parseOrWarn(
      parseDefaultLanguage(parsed.defaultLanguage),
      'defaultLanguage',
      DEFAULT_CARD_LANGUAGE,
    ),
    uiLocale: parseOrWarn(parseUiLocale(parsed.uiLocale), 'uiLocale', DEFAULT_LOCALE),
    cacheLockTimeoutSeconds: parseOrWarn(
      parseCacheLockTimeoutSeconds(parsed.cacheLockTimeoutSeconds),
      'cacheLockTimeoutSeconds',
      DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS,
    ),
    cacheSource: parseOrWarn(parseCacheSource(parsed.cacheSource), 'cacheSource', 'scryfall'),
    searchDebounceMs: parseOrWarn(
      parseSearchDebounceMs(parsed.searchDebounceMs),
      'searchDebounceMs',
      DEFAULT_SEARCH_DEBOUNCE_MS,
    ),
    admin: parseOrWarn(parseAdminConfig(parsed.admin), 'admin config', { ...DEFAULT_ADMIN_CONFIG }),
    // Defaulted unconditionally rather than only when the key is present, so a
    // config file written before this section existed still yields the default.
    collectionSync: parseOrWarn(
      parseCollectionSyncConfig(parsed.collectionSync),
      'collectionSync config',
      { ...DEFAULT_COLLECTION_SYNC_CONFIG },
    ),
  }
  if (cacheFeedUrl !== undefined) {
    merged.cacheFeedUrl = cacheFeedUrl
  }
  if (parsed.site !== undefined) {
    const site = parseSiteConfig(parsed.site)
    if (isConfigParseError(site)) {
      console.warn(`ritual.config.json: ignoring invalid site config — ${site.error}`)
    } else {
      merged.site = site
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

/**
 * Thrown when ritual.config.json exists but does not contain a JSON object.
 * Hand-editing the file is the documented workflow, so a syntax error must stop
 * the command with the file path and the parser's complaint — treating it as
 * "no config" would silently run against defaults and, worse, let the next
 * write replace settings the user still has on disk.
 */
export class RitualConfigParseError extends CardCommandError {
  readonly configPath: string
  constructor(configPath: string, reason: string) {
    super(
      'runtime_error',
      `ritual.config.json is not valid JSON: ${configPath}\n  ${reason}\n` +
        'Fix the file (or delete it to fall back to defaults) and try again.',
      ExitCode.RuntimeError,
    )
    this.name = 'RitualConfigParseError'
    this.configPath = configPath
  }
}

/**
 * Read ritual.config.json, or `null` when the file does not exist. Only absence
 * is benign: a malformed file raises {@link RitualConfigParseError} and any
 * other read failure propagates as-is.
 */
async function readConfigFromDisk(): Promise<RitualConfig | null> {
  const configPath = getRitualConfigPath()
  let content: string
  try {
    content = await fs.readFile(configPath, 'utf-8')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new RitualConfigParseError(configPath, getErrorMessage(error))
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RitualConfigParseError(configPath, 'the file must contain a JSON object')
  }
  return applyDefaults(parsed)
}

/**
 * Load ritual.config.json from the base dir, merging with defaults.
 * Returns the default config if the file does not exist.
 */
export async function loadRitualConfig(): Promise<RitualConfig> {
  const fromDisk = await readConfigFromDisk()
  return fromDisk ?? getDefaultRitualConfig()
}

async function writeRitualConfigFile(config: Partial<RitualConfig>): Promise<void> {
  await fs.writeFile(getRitualConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export async function saveRitualConfig(config: RitualConfig): Promise<void> {
  await writeRitualConfigFile(config)
  cachedConfig = { ...config }
}

/**
 * Persist a config object that may omit defaulted keys — the `config unset`
 * path. The omitted keys stay absent in the file (so the loader's defaulting
 * pass re-materializes them on every load), and the in-process cache is
 * refreshed from disk so the sync getters never observe a partial config.
 */
export async function savePartialRitualConfig(config: Partial<RitualConfig>): Promise<void> {
  await writeRitualConfigFile(config)
  await refreshRitualConfig()
}

/**
 * Read ritual.config.json from the base dir into the process-wide cache,
 * falling back to defaults when the file does not exist. Run once per CLI
 * invocation (after setBaseDir(), before any sync getter) and again whenever a
 * write path persists an update, so subsequent reads reflect the new values.
 *
 * Reading never creates the file: a workspace is defined by its list
 * directories, not by a config file, and seeding one into every directory a
 * command happens to run in (including `license`) made stray directories look
 * like workspaces. The file is materialized only by an actual write —
 * {@link saveRitualConfig} / {@link savePartialRitualConfig}.
 */
export async function refreshRitualConfig(): Promise<RitualConfig> {
  const fromDisk = await readConfigFromDisk()
  cachedConfig = fromDisk ?? getDefaultRitualConfig()
  return cachedConfig
}

/**
 * Sync access to the cached ritual config. Falls back to defaults if
 * refreshRitualConfig() was never called (e.g. in tests that bypass index.ts).
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

/**
 * Where custom card art lives (`./art` unless overridden). The directory is
 * never created: absence means the workspace has no local art.
 */
export function getArtDir(config: RitualConfig = getRitualConfig()): string {
  return resolveDir(config.artDir)
}

/** The configured default price currency (`usd` unless overridden). */
export function getDefaultCurrency(config: RitualConfig = getRitualConfig()): PriceCurrency {
  return config.defaultCurrency
}

/**
 * The stores whose prices the sites offer (`['tcgplayer']` unless overridden).
 * An empty array is meaningful: the sites display no prices at all.
 */
export function getPriceSources(config: RitualConfig = getRitualConfig()): readonly PriceSource[] {
  return config.priceSources
}

/**
 * Whether Card Kingdom retail prices are enabled as a site price source. One of
 * the two reasons a build or server wants the Card Kingdom feed — see
 * {@link wantsCardKingdomFeed}.
 */
export function cardKingdomPricesEnabled(config: RitualConfig = getRitualConfig()): boolean {
  return config.priceSources.includes('cardkingdom')
}

/**
 * Whether this build/server needs the Card Kingdom pricelist feed at all:
 * sell mode (buylist quotes) or the `cardkingdom` price source. Every feed
 * warm/ensure/bake gate reads this one answer, so the two consumers can never
 * disagree about whether the ~70 MB download is warranted.
 */
export function wantsCardKingdomFeed(config: RitualConfig = getRitualConfig()): boolean {
  return getSiteSellMode(config) || cardKingdomPricesEnabled(config)
}

/**
 * The configured default card language (`en` unless overridden): the language
 * stamped on newly added cards and the selector for which Scryfall bulk backs
 * the card cache.
 */
export function getDefaultLanguage(config: RitualConfig = getRitualConfig()): CardLanguage {
  return config.defaultLanguage
}

/**
 * The configured UI locale (`en` unless overridden): the language Ritual's own
 * text speaks. Not the card language — see {@link RitualConfig.uiLocale}.
 */
export function getUiLocale(config: RitualConfig = getRitualConfig()): LocaleTag {
  return config.uiLocale
}

/** How long to wait for the cache-write lock, in seconds (300 unless overridden). */
export function getCacheLockTimeoutSeconds(config: RitualConfig = getRitualConfig()): number {
  return config.cacheLockTimeoutSeconds
}

/** Where card-cache refreshes download from ('scryfall' unless overridden). */
export function getCacheSource(config: RitualConfig = getRitualConfig()): CacheSource {
  return config.cacheSource
}

/** The web editors' add-card search debounce in ms (500 unless overridden). */
export function getSearchDebounceMs(config: RitualConfig = getRitualConfig()): number {
  return config.searchDebounceMs
}

/**
 * The collection list `collection-sync pull` writes new cards into (`Inbox`
 * unless overridden). The command's `--into` flag takes precedence over it.
 */
export function getCollectionSyncPullTarget(config: RitualConfig = getRitualConfig()): string {
  return config.collectionSync.pullTarget
}

/** The configured cache feed URL, or undefined to use the built-in default. */
export function getCacheFeedUrl(config: RitualConfig = getRitualConfig()): string | undefined {
  return config.cacheFeedUrl
}

/**
 * The set of `set:collectorNumber` keys barred from default-printing selection,
 * derived from `site.bannedPrintings`. Keys are already normalized through
 * {@link printingKey}, so callers match with `cardPrintingKey(card)`.
 */
export function getBannedPrintings(config: RitualConfig = getRitualConfig()): Set<string> {
  return new Set(config.site?.bannedPrintings ?? [])
}

/**
 * The configured `site.apiBaseUrl`: `''` for a same-origin API, an absolute
 * http(s) URL for a separately hosted one, or undefined for a fully static site.
 */
export function getSiteApiBaseUrl(config: RitualConfig = getRitualConfig()): string | undefined {
  return config.site?.apiBaseUrl
}

/**
 * Whether sell mode is offered when `site.sellMode` is unset: off. Sell mode
 * costs a ~70 MB buylist download on every build and cache refresh, so it is
 * opt-in rather than something a workspace pays for by default.
 */
export const DEFAULT_SITE_SELL_MODE = false

/**
 * The session-scoped `--sell-mode` override, or null when the run follows the
 * config. Enable-only in practice: the flag has no negative form, so the value
 * here is only ever `true` outside tests.
 */
let siteSellModeOverride: boolean | null = null

/**
 * Turn sell mode on (or off) for this process, whatever `site.sellMode` says.
 *
 * Backs the `--sell-mode` flag on `build-site`, `serve` and `admin`: a run that
 * asks for buylist prices gets them without a config write, and everything that
 * consults {@link getSiteSellMode} — the CK feed refresh, the baked quotes, the
 * served `index.json`, the buylist routes — agrees for the whole run.
 */
export function setSiteSellModeOverride(enabled: boolean): void {
  siteSellModeOverride = enabled
}

/** Drop the `--sell-mode` override, so sell mode follows the config again. */
export function clearSiteSellModeOverride(): void {
  siteSellModeOverride = null
}

/**
 * Whether sell mode is offered: the buylist filter, per-card buyer quotes,
 * buylist grouping/sorting and the sell-cart export.
 *
 * Off unless `site.sellMode` is explicitly `true` or this run passed
 * `--sell-mode` ({@link setSiteSellModeOverride}), which wins over the config.
 * `ritual sell` is deliberately *not* gated on this — running it is itself the
 * request for Card Kingdom prices.
 */
export function getSiteSellMode(config: RitualConfig = getRitualConfig()): boolean {
  if (siteSellModeOverride !== null) return siteSellModeOverride
  return config.site?.sellMode ?? DEFAULT_SITE_SELL_MODE
}

/**
 * What this process is operating with in place of the stored config, keyed by
 * the dotted config path each override displaces.
 *
 * Room for more keys is deliberate: an override reported here needs no wire
 * change to join the existing ones.
 */
export type SessionOverrides = {
  /** Set by `--sell-mode` ({@link setSiteSellModeOverride}); see {@link getSiteSellMode}. */
  'site.sellMode'?: boolean
}

/**
 * The session overrides in force, or `{}` when this process follows the stored
 * config in every respect.
 *
 * Overrides are process-local, so this only says something in the API of a
 * *running* server: `GET /api/config` and the MCP `get_config` tool report it
 * beside the stored config, which is the only way a client can tell that (say)
 * an `admin --sell-mode` instance answers its sell routes despite
 * `site.sellMode` being unset. A fresh CLI process never has any, which is why
 * `ritual config get` is unaffected.
 */
export function getSessionOverrides(): SessionOverrides {
  if (siteSellModeOverride === null) return {}
  return { 'site.sellMode': siteSellModeOverride }
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
