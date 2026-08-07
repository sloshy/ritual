import {
  getDefaultRitualConfig,
  getSiteSelectionConfig,
  getSiteSellMode,
  isConfigParseError,
  parseBannedPrinting,
  parseCacheFeedUrl,
  parseCacheLockTimeoutSeconds,
  parseCacheSource,
  parseCollectionSyncPullTarget,
  parseDefaultCurrency,
  parseSiteApiBaseUrl,
  type AdminConfig,
  type CollectionSyncConfig,
  type RitualConfig,
  type SiteConfig,
  type SiteSelectionConfig,
} from './ritual-config'
import { invalidLanguageMessage, normalizeLanguageValue } from './card-language'
import { getAtPath } from './utils'

type ConfigFieldType = 'string' | 'boolean' | 'number' | 'string[]'

// Maps a RitualConfig field's value type to its ConfigFieldType tag.
// Returns never for unmappable types (e.g. SiteConfig), which excludes them from SettableFieldsMap.
type ConfigFieldTypeFor<T> = T extends string
  ? 'string'
  : T extends boolean
    ? 'boolean'
    : T extends number
      ? 'number'
      : T extends string[]
        ? 'string[]'
        : never

// A mapped type over RitualConfig that only includes keys with a supported ConfigFieldType.
// The `admin` and `site` object keys are automatically excluded because
// ConfigFieldTypeFor<object> = never.
type SettableFieldsMap = {
  [K in keyof RitualConfig as ConfigFieldTypeFor<RitualConfig[K]> extends never
    ? never
    : K]: ConfigFieldTypeFor<RitualConfig[K]>
}

// The admin settings live under `admin`. Like the site selection lists below,
// they are exposed as dotted nested paths handled through the same machinery.
// The `satisfies` check keeps the keys in sync with AdminConfig.
type SettableAdminFieldsMap = {
  [K in keyof AdminConfig as `admin.${K & string}`]: ConfigFieldTypeFor<AdminConfig[K]>
}

// The collection-sync settings live under `collectionSync`, exposed as dotted
// nested paths through the same machinery. The `satisfies` check keeps the keys
// in sync with CollectionSyncConfig.
type SettableCollectionSyncFieldsMap = {
  [K in keyof CollectionSyncConfig as `collectionSync.${K & string}`]: ConfigFieldTypeFor<
    CollectionSyncConfig[K]
  >
}

export type ArrayMode = 'replace' | 'add' | 'remove'

/**
 * Merge new values into an array property per the mode, deduped and in
 * first-seen order. The one merge behind `config set` and `metadata set`
 * (documented as sharing a subcommand shape), so `--add`/`--remove` can never
 * behave differently between the two.
 */
export function mergeArrayValues(
  current: readonly string[],
  values: readonly string[],
  mode: ArrayMode,
): string[] {
  if (mode === 'replace') return [...new Set(values)]
  if (mode === 'add') return [...new Set([...current, ...values])]
  const toRemove = new Set(values)
  return current.filter((item) => !toRemove.has(item))
}

/**
 * Split values that may arrive as separate arguments or comma-joined
 * (`a,b`) into trimmed, non-empty tokens. Shared by `metadata set`'s labels
 * and tags paths and the editor's tags prompt, so the surfaces tokenize alike.
 */
export function splitCommaTokens(values: readonly string[]): string[] {
  return values
    .flatMap((value) => value.split(','))
    .map((token) => token.trim())
    .filter((token) => token !== '')
}

/**
 * Render a settable value for text output: scalars verbatim, arrays/objects as
 * JSON. Shared by `config` and `metadata` so the twin commands print alike.
 */
export function formatSettableValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

export type SettableValue = string | boolean | number | string[]

export type ConfigSetSuccess = {
  property: string
  newValue: SettableValue
  updatedConfig: RitualConfig
}

export type ConfigSetError = {
  error: string
}

export type ConfigSetOutcome = ConfigSetSuccess | ConfigSetError

// Typed as Record<string, ConfigFieldType> to allow runtime string-key lookups (noUncheckedIndexedAccess
// returns ConfigFieldType | undefined). The `satisfies SettableFieldsMap` check enforces that all keys
// are valid RitualConfig property names and each value matches that field's actual type.
export const SETTABLE_FIELDS: Record<string, ConfigFieldType> = {
  decksDir: 'string',
  collectionsDir: 'string',
  wantedDir: 'string',
  defaultCurrency: 'string',
  defaultLanguage: 'string',
  cacheLockTimeoutSeconds: 'number',
  cacheSource: 'string',
  cacheFeedUrl: 'string',
  searchDebounceMs: 'number',
} satisfies SettableFieldsMap

// The admin settings, exposed as dotted `admin.<field>` paths handled through the
// same machinery as SETTABLE_FIELDS. The `satisfies` check keeps the keys in sync
// with AdminConfig.
export const SETTABLE_ADMIN_FIELDS: Record<string, ConfigFieldType> = {
  'admin.gitEnabled': 'boolean',
  'admin.gitAutoCommit': 'boolean',
  'admin.gitAutoPush': 'boolean',
  'admin.trustProxy': 'boolean',
  'admin.secureCookies': 'boolean',
  'admin.ipAllowList': 'string[]',
  'admin.ipDenyList': 'string[]',
  'admin.userAgentAllowList': 'string[]',
  'admin.userAgentDenyList': 'string[]',
  'admin.rateLimitEnabled': 'boolean',
  'admin.rateLimitMaxAttempts': 'number',
  'admin.rateLimitWindowMinutes': 'number',
  'admin.failedAuthDelayMs': 'number',
} satisfies SettableAdminFieldsMap

export const SETTABLE_COLLECTION_SYNC_FIELDS: Record<string, ConfigFieldType> = {
  'collectionSync.pullTarget': 'string',
} satisfies SettableCollectionSyncFieldsMap

// The dotted path of the banned-printings list. Its values are validated and
// normalized to canonical `set:collectorNumber` keys before being stored.
export const SITE_BANNED_PRINTINGS = 'site.bannedPrintings'

// The public-site selection lists and the banned-printings list live under
// `site` but, unlike the rest of the init-site-managed `site` object, are
// user-tunable. They are exposed here as dotted nested paths handled through the
// same string[] machinery. The `satisfies` check keeps the keys in sync with
// SiteSelectionConfig and SiteConfig.
type SettableSiteFieldsMap = {
  [K in keyof SiteSelectionConfig as `site.${K & string}`]: ConfigFieldTypeFor<
    SiteSelectionConfig[K]
  >
} & {
  'site.bannedPrintings': ConfigFieldTypeFor<NonNullable<SiteConfig['bannedPrintings']>>
  'site.apiBaseUrl': ConfigFieldTypeFor<NonNullable<SiteConfig['apiBaseUrl']>>
  'site.sellMode': ConfigFieldTypeFor<NonNullable<SiteConfig['sellMode']>>
}
export const SETTABLE_SITE_FIELDS: Record<string, ConfigFieldType> = {
  'site.includeDecks': 'string[]',
  'site.includeCollections': 'string[]',
  'site.includeWantedLists': 'string[]',
  'site.excludeDecks': 'string[]',
  'site.excludeCollections': 'string[]',
  'site.excludeWantedLists': 'string[]',
  'site.bannedPrintings': 'string[]',
  'site.apiBaseUrl': 'string',
  'site.sellMode': 'boolean',
} satisfies SettableSiteFieldsMap

/**
 * Config keys readable through `config get` but not settable here: they are
 * managed by their own commands (export presets via `ritual export --save-preset`).
 */
const READ_ONLY_FIELDS: readonly string[] = ['exportPresets']

/** Every property `config set`/`config unset` accepts, in display order. */
function settableProperties(): string[] {
  return [
    ...Object.keys(SETTABLE_FIELDS),
    ...Object.keys(SETTABLE_ADMIN_FIELDS),
    ...Object.keys(SETTABLE_COLLECTION_SYNC_FIELDS),
    ...Object.keys(SETTABLE_SITE_FIELDS),
  ]
}

/**
 * True when `property` targets the init-site-managed portion of the `site`
 * object (deployment settings) rather than one of the user-tunable site lists.
 */
function isSiteDeployManagedPath(property: string): boolean {
  return (
    (property === 'site' || property.startsWith('site.')) && !(property in SETTABLE_SITE_FIELDS)
  )
}

function siteDeployGuardError(verb: 'set' | 'unset'): string {
  return (
    `The "site" property is managed by "ritual init-site" and cannot be ${verb} with "config ${verb}", ` +
    'except for the public-site selection lists: ' +
    `${Object.keys(SETTABLE_SITE_FIELDS).join(', ')}.`
  )
}

export function setAtPath(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  const head = path[0]
  if (head === undefined) return obj
  const rest = path.slice(1)
  if (rest.length === 0) {
    return { ...obj, [head]: value }
  }
  const nested =
    typeof obj[head] === 'object' && obj[head] !== null
      ? (obj[head] as Record<string, unknown>)
      : {}
  return { ...obj, [head]: setAtPath(nested, rest, value) }
}

/**
 * Immutably remove the key at `path`, pruning parent objects that become empty
 * along the way (so unsetting the last nested key does not leave `{}` behind).
 * Returns the input object unchanged when the path does not exist.
 */
export function deleteAtPath(
  obj: Record<string, unknown>,
  path: string[],
): Record<string, unknown> {
  const head = path[0]
  if (head === undefined || !(head in obj)) return obj
  if (path.length === 1) {
    const remaining = { ...obj }
    delete remaining[head]
    return remaining
  }
  const nested = obj[head]
  if (typeof nested !== 'object' || nested === null) return obj
  const updatedNested = deleteAtPath(nested as Record<string, unknown>, path.slice(1))
  if (updatedNested === nested) return obj
  if (Object.keys(updatedNested).length === 0) {
    // Prune the now-empty parent object rather than leaving `{}` behind.
    const remaining = { ...obj }
    delete remaining[head]
    return remaining
  }
  return { ...obj, [head]: updatedNested }
}

export function applyConfigSet(
  config: RitualConfig,
  property: string,
  values: string[],
  mode: ArrayMode,
): ConfigSetOutcome {
  // The deployment portion of `site` is managed by init-site; only the
  // public-site selection lists may be set here.
  if (isSiteDeployManagedPath(property)) {
    return { error: siteDeployGuardError('set') }
  }

  const fieldType =
    SETTABLE_FIELDS[property] ??
    SETTABLE_ADMIN_FIELDS[property] ??
    SETTABLE_COLLECTION_SYNC_FIELDS[property] ??
    SETTABLE_SITE_FIELDS[property]
  if (!fieldType) {
    const available = settableProperties().join(', ')
    return {
      error: `Unknown property: "${property}". Available properties: ${available}`,
    }
  }

  if (values.length === 0) {
    return { error: 'At least one value must be provided.' }
  }

  if (mode !== 'replace' && fieldType !== 'string[]') {
    return {
      error: `--add and --remove can only be used with array properties. "${property}" is a ${fieldType}.`,
    }
  }

  if (fieldType !== 'string[]' && values.length > 1) {
    return {
      error: `"${property}" is a ${fieldType} and only accepts one value, but ${values.length} were provided.`,
    }
  }

  const path = property.split('.')
  const configObj = config as unknown as Record<string, unknown>

  if (fieldType === 'string[]') {
    // Banned printings are stored as canonical `set:collectorNumber` keys, so
    // normalize the inputs (lowercasing set codes) before any set operation —
    // this also lets `--remove SLD:123` match a stored `sld:123` entry.
    let inputValues = values
    if (property === SITE_BANNED_PRINTINGS) {
      const normalized: string[] = []
      for (const value of values) {
        const parsed = parseBannedPrinting(value)
        if (isConfigParseError(parsed)) return parsed
        normalized.push(parsed.key)
      }
      inputValues = normalized
    }

    const current = (getAtPath(config, path) as string[] | undefined) ?? []
    const newArr = mergeArrayValues(current, inputValues, mode)

    // Safe: path is a validated keyof RitualConfig, value is a string[].
    const updatedConfig = setAtPath(configObj, path, newArr) as unknown as RitualConfig
    return { property, newValue: newArr, updatedConfig }
  }

  // All scalar branches need exactly one value; the length checks above ensure this,
  // but noUncheckedIndexedAccess requires an explicit guard.
  const rawValue = values[0]
  if (rawValue === undefined) {
    return { error: 'At least one value must be provided.' }
  }

  if (fieldType === 'boolean') {
    const raw = rawValue.toLowerCase()
    if (raw !== 'true' && raw !== 'false') {
      return {
        error: `"${property}" expects a boolean. Use "true" or "false", got "${rawValue}".`,
      }
    }
    const newValue = raw === 'true'
    // Safe: path is a validated keyof RitualConfig, value matches the field's boolean type.
    const updatedConfig = setAtPath(configObj, path, newValue) as unknown as RitualConfig
    return { property, newValue, updatedConfig }
  }

  if (fieldType === 'number') {
    const trimmed = rawValue.trim()
    if (trimmed === '') {
      return { error: `"${property}" expects a number, got an empty string.` }
    }
    const num = Number(trimmed)
    if (!Number.isFinite(num)) {
      return { error: `"${property}" expects a number, got "${rawValue}".` }
    }
    if (!Number.isInteger(num)) {
      return { error: `"${property}" expects an integer, got "${rawValue}".` }
    }
    if (num < 0) {
      return { error: `"${property}" expects a non-negative integer, got "${rawValue}".` }
    }
    // cacheLockTimeoutSeconds is a constrained number (must be strictly positive); reject
    // 0 here rather than letting it round-trip to a value the config loader silently
    // discards (falling back to the default with only a console.warn) on the next load.
    if (property === 'cacheLockTimeoutSeconds') {
      const parsed = parseCacheLockTimeoutSeconds(num)
      if (isConfigParseError(parsed)) {
        return parsed
      }
    }
    // Safe: path is a validated keyof RitualConfig, value matches the field's number type.
    const updatedConfig = setAtPath(configObj, path, num) as unknown as RitualConfig
    return { property, newValue: num, updatedConfig }
  }

  // fieldType === 'string'
  // defaultCurrency is a constrained string; validate and normalize to lowercase.
  let newValue = rawValue
  if (property === 'defaultCurrency') {
    const parsed = parseDefaultCurrency(rawValue)
    if (isConfigParseError(parsed)) {
      return parsed
    }
    newValue = parsed
  }
  // defaultLanguage is a constrained string; accept the common aliases
  // (`jp`→`ja`, `sp`→`es`, full names like "Japanese") as a set-time
  // convenience, but persist only the canonical Scryfall code.
  if (property === 'defaultLanguage') {
    const normalized = normalizeLanguageValue(rawValue)
    if (normalized === null) {
      return {
        error: invalidLanguageMessage(rawValue, 'for "defaultLanguage"'),
      }
    }
    newValue = normalized
  }
  // cacheSource and cacheFeedUrl are constrained strings; reject invalid values
  // here rather than persisting something the loader silently resets.
  if (property === 'cacheSource') {
    const parsed = parseCacheSource(rawValue)
    if (isConfigParseError(parsed)) {
      return parsed
    }
    newValue = parsed
  }
  if (property === 'cacheFeedUrl') {
    const parsed = parseCacheFeedUrl(rawValue)
    if (isConfigParseError(parsed)) {
      return parsed
    }
    newValue = parsed
  }
  // collectionSync.pullTarget is a constrained string (a non-blank list name);
  // reject a blank one here rather than persisting a target a pull cannot use.
  if (property === 'collectionSync.pullTarget') {
    const parsed = parseCollectionSyncPullTarget(rawValue)
    if (isConfigParseError(parsed)) {
      return parsed
    }
    newValue = parsed
  }
  // site.apiBaseUrl is a constrained string ('' or an http(s) URL); validate and
  // normalize (trailing slash stripped) before persisting.
  if (property === 'site.apiBaseUrl') {
    const parsed = parseSiteApiBaseUrl(rawValue)
    if (isConfigParseError(parsed)) {
      return parsed
    }
    newValue = parsed
  }
  // Safe: path is a validated keyof RitualConfig, value matches the field's string type.
  const updatedConfig = setAtPath(configObj, path, newValue) as unknown as RitualConfig
  return { property, newValue, updatedConfig }
}

/**
 * The built-in default value for a config property, or undefined for genuinely
 * optional keys (cacheFeedUrl, site.bannedPrintings, exportPresets).
 *
 * Defaults come from {@link getDefaultRitualConfig} by value — never from what
 * happens to be on disk, since `saveRitualConfig` materializes defaults
 * into the file. The `site` keys are special-cased: the default config carries
 * no `site` object at all, but the selection lists (`['*']` for include lists,
 * `[]` for exclude lists) and `sellMode` (enabled) have documented effective
 * defaults their getters apply.
 */
export function defaultConfigValueAtPath(property: string): unknown {
  if (property === 'site.sellMode') return getSiteSellMode(getDefaultRitualConfig())
  if (property.startsWith('site.')) {
    const selection = getSiteSelectionConfig(undefined) as unknown as Record<string, unknown>
    return selection[property.slice('site.'.length)]
  }
  return getAtPath(getDefaultRitualConfig(), property.split('.'))
}

/** Value equality for config values: scalars by identity, string[] element-wise. */
function configValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => value === b[i])
  }
  return a === b
}

export type ConfigGetValue = { kind: 'value'; value: unknown }
export type ConfigGetUnset = { kind: 'unset' }
export type ConfigGetUnknownProperty = { kind: 'unknown-property'; error: string }
export type ConfigGetOutcome = ConfigGetValue | ConfigGetUnset | ConfigGetUnknownProperty

/**
 * Resolve one config property from the effective config. Unknown keys are a
 * usage error; known-but-absent keys (genuinely optional values that were never
 * set, or site lists before a `site` object exists) report `unset`.
 */
export function applyConfigGet(config: RitualConfig, property: string): ConfigGetOutcome {
  const known =
    property in SETTABLE_FIELDS ||
    property in SETTABLE_ADMIN_FIELDS ||
    property in SETTABLE_COLLECTION_SYNC_FIELDS ||
    property in SETTABLE_SITE_FIELDS ||
    READ_ONLY_FIELDS.includes(property)
  if (!known) {
    const available = [...settableProperties(), ...READ_ONLY_FIELDS].join(', ')
    return {
      kind: 'unknown-property',
      error: `Unknown property: "${property}". Available properties: ${available}`,
    }
  }
  const value = getAtPath(config, property.split('.'))
  if (value === undefined) {
    return { kind: 'unset' }
  }
  return { kind: 'value', value }
}

export type ConfigUnsetSuccess = {
  property: string
  /**
   * The built-in default that now applies again; absent for genuinely optional
   * keys (cacheFeedUrl, site.bannedPrintings), which are simply removed.
   */
  defaultValue?: SettableValue
  /**
   * Partial: deleteAtPath may have removed keys RitualConfig declares as
   * required — the config loader's defaulting pass re-materializes them on the
   * next load.
   */
  updatedConfig: Partial<RitualConfig>
}

export type ConfigUnsetOutcome = ConfigUnsetSuccess | ConfigSetError

/**
 * Remove a settable property from the config, reverting defaulted keys to their
 * built-in defaults. Idempotent: unsetting an already-absent key succeeds and
 * returns the config unchanged.
 *
 * The returned `updatedConfig` may omit keys that RitualConfig declares as
 * required — the config loader's defaulting pass re-materializes them on the
 * next load. Always persist it through `savePartialRitualConfig` so that
 * round-trip stays intact; never hand-write the JSON file.
 */
export function applyConfigUnset(config: RitualConfig, property: string): ConfigUnsetOutcome {
  // Same guard as applyConfigSet: init-site owns the site deployment keys.
  if (isSiteDeployManagedPath(property)) {
    return { error: siteDeployGuardError('unset') }
  }

  const fieldType =
    SETTABLE_FIELDS[property] ??
    SETTABLE_ADMIN_FIELDS[property] ??
    SETTABLE_COLLECTION_SYNC_FIELDS[property] ??
    SETTABLE_SITE_FIELDS[property]
  if (!fieldType) {
    const available = settableProperties().join(', ')
    return {
      error: `Unknown property: "${property}". Available properties: ${available}`,
    }
  }

  const configObj = config as unknown as Record<string, unknown>
  // Safe: the path is a validated settable property, and the config loader
  // restores any removed defaulted key on the next load.
  const updatedConfig = deleteAtPath(configObj, property.split('.')) as Partial<RitualConfig>
  const defaultValue = defaultConfigValueAtPath(property) as SettableValue | undefined
  return defaultValue === undefined
    ? { property, updatedConfig }
    : { property, defaultValue, updatedConfig }
}

export type ConfigListEntry = {
  property: string
  /** The configured value; undefined when the key is not set. */
  value: unknown
  /** True when the value equals the built-in default by value equality. */
  isDefault: boolean
}

/**
 * Flatten the effective config into one entry per settable property (dotted
 * paths for nested keys), each marked as default or customized by comparing its
 * value against {@link defaultConfigValueAtPath}.
 */
export function listConfigEntries(config: RitualConfig): ConfigListEntry[] {
  const entries: ConfigListEntry[] = []
  for (const property of settableProperties()) {
    const value = getAtPath(config, property.split('.'))
    const defaultValue = defaultConfigValueAtPath(property)
    entries.push({
      property,
      value,
      isDefault: value !== undefined && configValuesEqual(value, defaultValue),
    })
  }
  return entries
}
