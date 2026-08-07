import {
  DEFAULT_ADMIN_CONFIG,
  getRitualConfigPath,
  isConfigParseError,
  loadRitualConfig,
  parseAdminConfig,
  parseCacheFeedUrl,
  parseCacheLockTimeoutSeconds,
  parseCacheSource,
  parseCollectionSyncConfig,
  parseDefaultCurrency,
  parseDefaultLanguage,
  parseSearchDebounceMs,
  parseSiteConfig,
  refreshRitualConfig,
  saveRitualConfig,
  type ConfigParseError,
  type RitualConfig,
} from '../../ritual-config'
import { parseExportPresets } from '../../export/presets'
import { shouldAutoCommit, commitFiles } from '../git'
import { apiHandler } from '../utils'
import { badRequest, readJsonObjectBody } from './save-helpers'
import { getBaseDir } from '../../base-dir'

/**
 * `GET /api/config` and `PUT /api/config` — the effective configuration:
 * ritual.config.json merged over the built-in defaults (the file is optional
 * and may not exist yet).
 */
export interface ConfigResponse {
  success: true
  config: RitualConfig
}

/** Marks every RitualConfig key; `satisfies` keeps the allowlist exhaustive. */
type KnownConfigKeyMap = Record<keyof RitualConfig, true>

/** Top-level ritual.config.json keys a PUT /api/config body may carry. */
const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set(
  Object.keys({
    decksDir: true,
    collectionsDir: true,
    wantedDir: true,
    defaultCurrency: true,
    defaultLanguage: true,
    cacheLockTimeoutSeconds: true,
    cacheSource: true,
    cacheFeedUrl: true,
    searchDebounceMs: true,
    admin: true,
    collectionSync: true,
    site: true,
    exportPresets: true,
  } satisfies KnownConfigKeyMap),
)

/**
 * Nested `admin` keys a PUT /api/config body may carry, derived from the
 * default admin config (which `satisfies AdminConfig`, so it names every key).
 */
const KNOWN_ADMIN_CONFIG_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_ADMIN_CONFIG))

/** The directory keys, all plain (unconstrained) strings. */
const DIRECTORY_CONFIG_KEYS = ['decksDir', 'collectionsDir', 'wantedDir'] as const

/**
 * The constrained scalar keys sharing one presence-check → parse → stage shape.
 * `cacheFeedUrl` is deliberately not one of them: its empty-string-clears rule
 * needs its own branch.
 */
type ScalarConfigKey =
  | 'defaultCurrency'
  | 'defaultLanguage'
  | 'cacheLockTimeoutSeconds'
  | 'cacheSource'
  | 'searchDebounceMs'

/**
 * Validate one constrained scalar key of a PUT /api/config body and stage it
 * into `updates`. Returns the parse error message when the value is malformed,
 * or null when the key is absent or was staged successfully.
 */
function applyScalarUpdate<K extends ScalarConfigKey>(
  raw: Record<string, unknown>,
  updates: Partial<RitualConfig>,
  key: K,
  parse: (value: unknown) => RitualConfig[K] | ConfigParseError,
): string | null {
  const value = raw[key]
  if (value === undefined) return null
  const parsed = parse(value)
  if (isConfigParseError(parsed)) return parsed.error
  updates[key] = parsed
  return null
}

export function handleGetConfig(): Promise<Response> {
  // apiHandler so a config file hand-edited into invalid JSON while the server
  // runs answers with its actionable parse message, not a contentless 500.
  return apiHandler(async () => {
    const config = await loadRitualConfig()
    const resp: ConfigResponse = { success: true, config }
    return Response.json(resp)
  })
}

export function handleUpdateConfig(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response
    const raw = parsedBody.body

    // Validate every present top-level key before merging, so an invalid value
    // is rejected with feedback here instead of persisted and then silently
    // reset to its default (with only a console.warn) on the next config load.
    for (const key of Object.keys(raw)) {
      if (!KNOWN_CONFIG_KEYS.has(key)) {
        return badRequest(`Unknown config key "${key}"`)
      }
    }

    const updates = raw as Partial<RitualConfig>

    for (const key of DIRECTORY_CONFIG_KEYS) {
      if (raw[key] !== undefined && typeof raw[key] !== 'string') {
        return badRequest(`"${key}" must be a string`)
      }
    }

    // Validate each present constrained scalar, rejecting on the first
    // malformed value. `??` chains to the next key only while no error has
    // been produced, so a bad update never half-applies.
    const scalarError =
      applyScalarUpdate(raw, updates, 'defaultCurrency', parseDefaultCurrency) ??
      applyScalarUpdate(raw, updates, 'defaultLanguage', parseDefaultLanguage) ??
      applyScalarUpdate(raw, updates, 'cacheLockTimeoutSeconds', parseCacheLockTimeoutSeconds) ??
      applyScalarUpdate(raw, updates, 'cacheSource', parseCacheSource) ??
      applyScalarUpdate(raw, updates, 'searchDebounceMs', parseSearchDebounceMs)
    if (scalarError !== null) {
      return badRequest(scalarError)
    }

    // An empty string clears the override (falls back to the built-in default);
    // the key must be removed from the merged config, not just from the update.
    let clearCacheFeedUrl = false
    if (raw.cacheFeedUrl !== undefined) {
      if (raw.cacheFeedUrl === '') {
        clearCacheFeedUrl = true
        delete updates.cacheFeedUrl
      } else {
        const parsed = parseCacheFeedUrl(raw.cacheFeedUrl)
        if (isConfigParseError(parsed)) {
          return badRequest(parsed.error)
        }
        updates.cacheFeedUrl = parsed
      }
    }

    // `admin` merges deep (see below), so parseAdminConfig is used purely as a
    // validator of the present fields — the raw partial is what gets merged,
    // never the parsed result, whose defaulted absent fields would clobber the
    // current values. Because the raw partial is merged verbatim, unknown
    // nested keys must be rejected here (parseAdminConfig silently ignores
    // them), mirroring the top-level allowlist and the CLI's
    // `config set admin.<field>` behavior.
    if (raw.admin !== undefined) {
      const parsed = parseAdminConfig(raw.admin)
      if (isConfigParseError(parsed)) {
        return badRequest(parsed.error)
      }
      if (typeof raw.admin === 'object' && raw.admin !== null) {
        for (const key of Object.keys(raw.admin)) {
          if (!KNOWN_ADMIN_CONFIG_KEYS.has(key)) {
            return badRequest(`Unknown admin config key "${key}"`)
          }
        }
      }
    }

    // `collectionSync` replaces wholesale, like `site` below: the parser
    // defaults every absent field, so a partial object round-trips to a
    // complete one rather than dropping what it omitted.
    if (raw.collectionSync !== undefined) {
      const parsed = parseCollectionSyncConfig(raw.collectionSync)
      if (isConfigParseError(parsed)) {
        return badRequest(parsed.error)
      }
      updates.collectionSync = parsed
    }

    // `site` replaces wholesale: parseSiteConfig validates the full object and
    // normalizes bannedPrintings to canonical lowercase `set:collectorNumber`
    // keys, matching what `config set` writes. Unlike `config set`, there is
    // deliberately no guard on the init-site-managed deployment keys here —
    // the admin Settings UI round-trips the full site object (deployment keys
    // included), so the admin path must accept them.
    if (raw.site !== undefined) {
      const parsed = parseSiteConfig(raw.site)
      if (isConfigParseError(parsed)) {
        return badRequest(parsed.error)
      }
      updates.site = parsed
    }

    if (raw.exportPresets !== undefined) {
      const parsed = parseExportPresets(raw.exportPresets)
      if (typeof parsed === 'string') {
        return badRequest(parsed)
      }
      updates.exportPresets = parsed
    }

    const current = await loadRitualConfig()
    // `admin` is nested, so a partial update must merge into it rather than
    // replace it wholesale (the top-level spread would otherwise drop omitted
    // admin fields).
    const merged: RitualConfig = {
      ...current,
      ...updates,
      admin: updates.admin ? { ...current.admin, ...updates.admin } : current.admin,
    }
    if (clearCacheFeedUrl) {
      delete merged.cacheFeedUrl
    }
    await saveRitualConfig(merged)
    await refreshRitualConfig()

    if (shouldAutoCommit(merged, getBaseDir())) {
      commitFiles([getRitualConfigPath()], 'Update ritual configuration')
    }

    const resp: ConfigResponse = { success: true, config: merged }
    return Response.json(resp)
  })
}
