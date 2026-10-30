import path from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import type { PriceData } from '../pricing/price-data'
import type { ScryfallCard } from '../scryfall/types'
import {
  type BulkSetOptions,
  type CacheManager,
  type CacheStreamEntryMeta,
} from '../util/interfaces'
import { writeFileAtomic } from '../util/atomic-write'
import { getLogger } from '../util/logger'
import { t } from '../i18n/t'
import { getErrorMessage } from '../util/errors'
import { getBaseDir } from '../config/base-dir'
import {
  cacheDirCheckContext,
  getRitualConfig,
  isConfigParseError,
  parseCacheDir,
} from '../config/ritual-config'
import { renderSyncMessage } from '../sync/message'
import { foldRepeatedFaceNames } from '../scryfall/card-utils'
import {
  LEGACY_CACHE_DIR,
  resolveCacheDir,
  SHARED_CACHE_MIGRATION_ID,
  type CacheDirLocation,
  type CacheDirCheckContext,
  type RejectedCacheDir,
} from '../config/cache-location'
import { hasCacheDataSync } from './cache-entries'
import { COMMAND, CONFIG_KEY, ENV_VAR, FILE, commandLine } from '../util/cli-tokens'
import { isRecord } from '../util/json'
import { namesIgnoreCase } from '../util/path-validation'

/** What the legacy-tier check last saw for a workspace, and its answer. */
type LegacyProbe = {
  /** The config file's and the old folder's modification times (-1: missing). */
  configStamp: number
  legacyStamp: number
  pending: boolean
}

/** The last {@link LegacyProbe} per base dir. */
const legacyProbes = new Map<string, LegacyProbe>()

/** A path's modification time, or -1 when it cannot be read. */
function mtimeOrMissing(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return -1
  }
}

/** The migration counter the config file records now, or 0 when it records none. */
function recordedMigration(configPath: string): number {
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown
    const migration = isRecord(raw) && isRecord(raw.managed) ? raw.managed.migration : undefined
    return typeof migration === 'number' ? migration : 0
  } catch {
    return 0
  }
}

/**
 * Whether the workspace at `baseDir` should still read its own old `cache/`
 * folder: it holds cache data and the config file does not yet record
 * migration 3. Read from disk rather than the loaded config, because a
 * long-running server never reloads it while another process migrates; the
 * answer is kept only while neither the config file nor the folder changes,
 * so a move or a recorded migration ends it at once.
 */
function legacyCachePending(baseDir: string): boolean {
  const configPath = path.join(baseDir, FILE.config)
  const legacy = path.join(baseDir, LEGACY_CACHE_DIR)
  const configStamp = mtimeOrMissing(configPath)
  const legacyStamp = mtimeOrMissing(legacy)
  const known = legacyProbes.get(baseDir)
  if (known?.configStamp === configStamp && known.legacyStamp === legacyStamp) return known.pending
  const pending =
    legacyStamp !== -1 &&
    recordedMigration(configPath) < SHARED_CACHE_MIGRATION_ID &&
    hasCacheDataSync(legacy)
  legacyProbes.set(baseDir, { configStamp, legacyStamp, pending })
  return pending
}

/**
 * Where this process's card cache lives, and which setting chose it
 * (`RITUAL_CACHE_DIR`, the `cacheDir` config key, the workspace's own old
 * `cache/` folder while migration 3 is pending, or the shared per-user
 * default). Resolved on every call: the base dir and config can change within
 * one process (tests, the admin server's config writes).
 */
export function getCacheDirLocation(): CacheDirLocation {
  const baseDir = getBaseDir()
  const config = getRitualConfig()
  const check = cacheDirCheckContext(config)
  return resolveCacheDir({
    baseDir,
    configured: config.cacheDir,
    legacyPending: () => legacyCachePending(baseDir),
    // The CLI refuses an unsafe RITUAL_CACHE_DIR before any command runs; a
    // server or the MCP server reaching here skips it (and an unsafe cacheDir
    // the loader let through) rather than writing into such a folder.
    check,
    onRejected: (rejected) => warnRejectedCacheDirOnce(rejected, check),
  })
}

/** The overrides already warned about, so each is reported once per process. */
const warnedRejections = new Set<string>()

/**
 * Warn, once per value, that an unusable cache folder setting is being
 * ignored, worded by the same refusal `config set` gives, checked against
 * `context`.
 */
export function warnRejectedCacheDirOnce(
  rejected: RejectedCacheDir,
  context: CacheDirCheckContext,
): void {
  const key = `${rejected.source}\0${rejected.value}`
  if (warnedRejections.has(key)) return
  warnedRejections.add(key)
  const field = rejected.source === 'env' ? ENV_VAR.cacheDir : CONFIG_KEY.cacheDir
  const parsed = parseCacheDir(rejected.value, context, field)
  if (!isConfigParseError(parsed)) return
  getLogger().warn(t('cli.cacheStore.unsafeDirIgnored', { reason: renderSyncMessage(parsed.error) }))
}

/** The card cache directory — every cache file's parent. See {@link getCacheDirLocation}. */
export function getCacheDir(): string {
  return getCacheDirLocation().dir
}
export function getImageCacheDir(): string {
  return path.join(getCacheDir(), 'images')
}
export function getCacheFile(): string {
  return path.join(getCacheDir(), 'cache.json')
}
export const DEFAULT_EXPIRATION_MS = 86400000 // 24 hours
const BLOCKLIST_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface CachedItem<T> {
  timestamp: number
  data: T
  lowercaseName?: string
}

export type CacheSection = 'prices' | 'cards'

export interface CacheSchema {
  prices: Record<string, CachedItem<PriceData>>
  cards?: Record<string, CachedItem<ScryfallCard[]>>
  cardNameIndex?: Record<string, string>
  cardBlocklist?: Record<string, number>
  metadata?: Partial<Record<CacheSection, SectionMetadata>>
}

/** What the cache records about one section as a whole. */
export type SectionMetadata = {
  /** When a bulk load last filled the section, in epoch ms. */
  lastRefreshedAt?: number
}

// Conditional type helper: extracts the data type for a given CacheSection key
export type DataType<K extends CacheSection> = CacheSchema[K] extends
  | Record<string, CachedItem<infer D>>
  | undefined
  ? D
  : never

/**
 * A file's modification time and size as one comparable token, or null when
 * it does not exist (or cannot be read — the load that follows reports why).
 */
async function fileStamp(filePath: string): Promise<string | null> {
  try {
    const stats = await stat(filePath)
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return null
  }
}

/** A loaded cache: its contents, the file and stamp it was read at, and why it could not be read. */
type LoadedCache = {
  cache: CacheSchema
  path: string
  stamp: string | null
  /** Set when the file exists but could not be read or parsed; the cache then reads as empty. */
  failure: unknown
}

/** Thrown from `beforeRename` when the cache file changed since it was loaded. */
class StaleCacheWrite extends Error {}

/** How many times a write starts over on a newer copy before it gives up. */
const STALE_WRITE_ATTEMPTS = 5

/**
 * The tail of each cache file's write queue in this process, keyed by path:
 * every manager over one file (the price and card managers share
 * `cache.json`) writes through the same queue, one write at a time.
 */
const writeQueues = new Map<string, Promise<void>>()

/** One key per file: resolved, and case-folded where the file system ignores case. */
function queueKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return namesIgnoreCase() ? resolved.toLowerCase() : resolved
}

function enqueueWrite(filePath: string, run: () => Promise<void>): Promise<void> {
  const key = queueKey(filePath)
  const next = (writeQueues.get(key) ?? Promise.resolve()).then(run, run)
  const tail = next.catch(() => undefined)
  writeQueues.set(key, tail)
  void tail.then(() => {
    if (writeQueues.get(key) === tail) writeQueues.delete(key)
  })
  return next
}

/** Test seams for {@link FileCacheManager}; production passes none. */
export type FileCacheSeams = {
  /** Runs after a write has loaded and changed the cache, before it writes the file. */
  beforeWrite?: (filePath: string) => Promise<void>
}

/** What a write may do. */
type MutateOptions = {
  /**
   * Write even over a cache file that cannot be read: only a write that
   * replaces the cache's whole contents (a full bulk refresh) may, which is
   * how a damaged cache heals.
   */
  overwriteUnreadable?: boolean
}

export function streamFromBatchResults<T>(
  keys: string[],
  results: Record<string, T>,
  onEntry: (key: string, value: T, meta: CacheStreamEntryMeta) => void,
): Record<string, T> {
  const streamed: Record<string, T> = {}
  for (const key of keys) {
    const value = results[key]
    if (value === undefined) continue
    streamed[key] = value
    onEntry(key, value, { updated: false })
  }
  return streamed
}

export class FileCacheManager<K extends CacheSection> implements CacheManager<DataType<K>> {
  private filePathGetter: () => string
  private section: K
  private memoryCache: CacheSchema | null = null
  /**
   * The file {@link memoryCache} was read from. The path is resolved per call
   * (the cache directory follows the base dir, `RITUAL_CACHE_DIR` and the
   * `cacheDir` key), so a memo of another file is never served or saved over
   * the new one.
   */
  private memoryCachePath: string | null = null
  /**
   * The file's modification time and size when {@link memoryCache} last
   * matched it (`null`: the file did not exist). The cache directory may be
   * shared by every workspace, so another process can rewrite the file at any
   * time; a memo whose file has changed since is reloaded rather than served —
   * or, worse, saved back over the other process's write.
   */
  private memoryCacheStamp: string | null = null
  /** The file and stamp whose read failure was last reported, so it is reported once. */
  private reportedFailure: string | null = null
  private expirationMs: number
  private now: () => number

  constructor(
    filePath: string | (() => string),
    section: K,
    expirationMs: number = DEFAULT_EXPIRATION_MS,
    now: () => number = Date.now,
    seams: FileCacheSeams = {},
  ) {
    this.filePathGetter = typeof filePath === 'function' ? filePath : () => filePath
    this.section = section
    this.expirationMs = expirationMs
    this.now = now
    this.seams = seams
  }

  private seams: FileCacheSeams

  /**
   * Drop the in-process memo so the next read reloads the cache file. Needed by
   * long-running servers to pick up refreshes written by a separate process —
   * the memo otherwise lives for the lifetime of the process.
   */
  invalidate(): void {
    this.memoryCache = null
    this.memoryCachePath = null
    this.memoryCacheStamp = null
  }

  /**
   * The stored key for a requested one. Card names fold repeated faces
   * (`Forest // Forest` → `Forest`), the rule the ingest names printings by, so
   * every lookup — however the caller spelled the name — reaches the one entry
   * that holds all of the card's printings. Other sections store keys verbatim.
   */
  private storedKey(key: string): string {
    return this.section === 'cards' ? foldRepeatedFaceNames(key) : key
  }

  /**
   * The cache as the file at `filePath` (the resolved cache file by default)
   * holds it now, with the stamp it was read at. A file that exists but
   * cannot be read or parsed reads as an empty cache — and comes back with its
   * `failure`, so no ordinary write ever replaces it with that emptiness. A
   * failure is never memoized: the next call reads the file again (it may have
   * been fixed, or the failure was passing), though it is reported only once
   * per file state.
   */
  private async loadState(filePath: string = path.resolve(this.filePathGetter())): Promise<LoadedCache> {
    const stamp = await fileStamp(filePath)
    if (this.memoryCache && this.memoryCachePath === filePath && this.memoryCacheStamp === stamp) {
      return { cache: this.memoryCache, path: filePath, stamp, failure: undefined }
    }

    let result: CacheSchema = { prices: {}, cards: {} }
    if (stamp !== null) {
      try {
        const json = JSON.parse(await Bun.file(filePath).text()) as Partial<CacheSchema>

        // Basic validation
        if (typeof json === 'object' && json !== null) {
          // Ensure schema default keys exist if missing
          if (!json.prices) json.prices = {}
          if (!json.cards) json.cards = {}

          // Validate cards schema (migration check)
          const sampleCardKey = Object.keys(json.cards)[0]
          if (sampleCardKey) {
            const sampleData = json.cards[sampleCardKey]?.data
            if (!Array.isArray(sampleData)) {
              getLogger().info(t('cli.cacheStore.oldSchemaReset'))
              json.cards = {}
            }
          }

          result = json as CacheSchema
        } else {
          getLogger().warn(t('cli.cacheStore.invalidFormatReset'))
        }
      } catch (e) {
        const state = `${filePath}\0${stamp}`
        if (this.reportedFailure !== state) {
          this.reportedFailure = state
          getLogger().error(t('cli.cacheStore.loadFailed'), e)
        }
        this.invalidate()
        return { cache: { prices: {}, cards: {} }, path: filePath, stamp, failure: e }
      }
    }
    this.memoryCache = result
    this.memoryCachePath = filePath
    this.memoryCacheStamp = stamp
    return { cache: result, path: filePath, stamp, failure: undefined }
  }

  private async load(): Promise<CacheSchema> {
    return (await this.loadState()).cache
  }

  /**
   * Change the cache and write it back. `apply` edits the loaded cache in place
   * and says whether it changed anything (nothing is written when it did not).
   *
   * The cache file may be shared by every workspace's processes (and, within
   * one process, by every manager over it), and a write rewrites the whole
   * file. So:
   *
   * - writes to one file from this process are queued, whichever manager
   *   makes them, and the file is fixed when the write is queued;
   * - each write is checked against the file as this write loaded it, just
   *   before the new contents replace it; when another process rewrote it in
   *   the meantime, the write is abandoned, the file reloaded and `apply` run
   *   again on the newer copy — never an older copy saved over a newer one.
   *   A write that keeps losing that race gives up with an error;
   * - a file that exists but cannot be read is never overwritten, except by
   *   a write that replaces the whole cache (`overwriteUnreadable`): the write
   *   is refused with an error saying so.
   *
   * What remains is the instant between that last check and the rename: two
   * processes whose renames land within it can still lose one write (a
   * single-card save, fetched again on the next lookup; bulk refreshes also
   * hold the cache lock, so two of them never race).
   */
  private mutate(
    apply: (cache: CacheSchema) => boolean,
    options: MutateOptions = {},
  ): Promise<void> {
    const filePath = path.resolve(this.filePathGetter())
    const run = async (): Promise<void> => {
      for (let attempt = 1; attempt <= STALE_WRITE_ATTEMPTS; attempt++) {
        const state = await this.loadState(filePath)
        if (state.failure !== undefined && options.overwriteUnreadable !== true) {
          throw new Error(
            t('cli.cacheStore.unwritable', {
              path: state.path,
              reason: getErrorMessage(state.failure),
              command: commandLine(COMMAND.cachePreloadAll),
            }),
          )
        }
        if (!apply(state.cache)) return
        if (await this.save(state)) return
        // Another process rewrote the file since it was loaded: start over from it.
        this.invalidate()
      }
      throw new Error(t('cli.cacheStore.writeContended', { path: filePath }))
    }
    return enqueueWrite(filePath, run)
  }

  /**
   * Write `state.cache` over the file, unless the file has changed since
   * `state` was loaded. Returns false for that (the caller reloads and
   * retries); a failed write is reported and returns true — there is nothing
   * to retry.
   */
  private async save(state: LoadedCache): Promise<boolean> {
    // Serialized before any await: what is written is exactly what was applied.
    const text = JSON.stringify(state.cache, null, 2)
    let written: string | null = null
    try {
      await mkdir(path.dirname(state.path), { recursive: true })
      await this.seams.beforeWrite?.(state.path)
      await writeFileAtomic(state.path, text, {
        beforeRename: async (tmpPath) => {
          if ((await fileStamp(state.path)) !== state.stamp) throw new StaleCacheWrite()
          // A rename keeps the stamp, so this is the file's stamp once it lands.
          written = await fileStamp(tmpPath)
        },
      })
    } catch (e) {
      if (e instanceof StaleCacheWrite) return false
      getLogger().error(t('cli.cacheStore.saveFailed'), e)
      return true
    }
    // Our own write must not read as another process's.
    this.memoryCache = state.cache
    this.memoryCachePath = state.path
    this.memoryCacheStamp = written
    return true
  }

  async get(key: string): Promise<DataType<K> | null> {
    const cache = await this.load()
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>> | undefined

    // Safety check if section was somehow undefined despite load defaults
    if (!sectionData) return null

    const entry = sectionData[this.storedKey(key)]

    if (!entry) return null

    const age = this.now() - entry.timestamp

    if (this.expirationMs > 0 && age > this.expirationMs) {
      await this.delete(key)
      return null
    }

    return entry.data
  }

  async getTimestamp(key: string): Promise<number | null> {
    const cache = await this.load()
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>> | undefined
    const entry = sectionData?.[this.storedKey(key)]
    return entry?.timestamp ?? null
  }

  async getLastRefreshedAt(): Promise<number | null> {
    const cache = await this.load()
    const metadataTimestamp = cache.metadata?.[this.section]?.lastRefreshedAt
    if (typeof metadataTimestamp === 'number') return metadataTimestamp
    return null
  }

  async streamGetMany(
    keys: string[],
    onEntry: (key: string, value: DataType<K>, meta: CacheStreamEntryMeta) => void,
  ): Promise<Record<string, DataType<K>>> {
    const results: Record<string, DataType<K>> = {}
    for (const key of keys) {
      const value = await this.get(key)
      if (value === null) continue
      results[key] = value
    }
    return streamFromBatchResults(keys, results, onEntry)
  }

  async set(requestedKey: string, value: DataType<K>): Promise<void> {
    const key = this.storedKey(requestedKey)
    const timestamp = this.now()
    await this.mutate((cache) => {
      // Ensure section exists
      if (!cache[this.section]) {
        cache[this.section] = {}
      }
      const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>>

      const item: CachedItem<DataType<K>> = { timestamp, data: value }
      if (this.section === 'cards') {
        item.lowercaseName = key.toLowerCase()
        cache.cardNameIndex = cache.cardNameIndex ?? {}
        cache.cardNameIndex[key.toLowerCase()] = key
      }
      sectionData[key] = item
      return true
    })
  }

  async bulkSet(entries: Record<string, DataType<K>>, options?: BulkSetOptions): Promise<void> {
    const now = this.now()
    await this.mutate((cache) => {
      if (!cache[this.section] || options?.replace) {
        cache[this.section] = {}
      }
      const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>>

      if (this.section === 'cards') {
        cache.cardNameIndex = options?.replace ? {} : (cache.cardNameIndex ?? {})
      }
      for (const [requestedKey, value] of Object.entries(entries)) {
        const key = this.storedKey(requestedKey)
        const item: CachedItem<DataType<K>> = {
          timestamp: now,
          data: value,
        }
        if (this.section === 'cards') {
          item.lowercaseName = key.toLowerCase()
          cache.cardNameIndex![key.toLowerCase()] = key
        }
        sectionData[key] = item
      }
      cache.metadata = cache.metadata ?? {}
      cache.metadata[this.section] = { lastRefreshedAt: now }
      return true
    }, { overwriteUnreadable: options?.replace === true })
  }

  async isEmpty(): Promise<boolean> {
    const cache = await this.load()
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>> | undefined
    return !sectionData || Object.keys(sectionData).length === 0
  }

  async delete(key: string): Promise<void> {
    const storedKey = this.storedKey(key)
    await this.mutate((cache) => {
      const sectionData = cache[this.section] as
        | Record<string, CachedItem<DataType<K>>>
        | undefined
      if (!sectionData || !(storedKey in sectionData)) return false
      delete sectionData[storedKey]
      return true
    })
  }

  async clear(): Promise<void> {
    await this.mutate((cache) => {
      cache[this.section] = {}
      if (cache.metadata) {
        delete cache.metadata[this.section]
      }
      return true
    })
  }

  async keys(): Promise<string[]> {
    const cache = await this.load()
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>> | undefined
    return sectionData ? Object.keys(sectionData) : []
  }

  async values(): Promise<DataType<K>[]> {
    const cache = await this.load()
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>> | undefined
    return sectionData ? Object.values(sectionData).map((item) => item.data) : []
  }

  async resolveCardName(lowercaseName: string): Promise<string | null> {
    const cache = await this.load()
    return cache.cardNameIndex?.[foldRepeatedFaceNames(lowercaseName)] ?? null
  }

  async addToBlocklist(name: string): Promise<void> {
    const normalized = name.toLowerCase()
    const expiry = this.now() + BLOCKLIST_EXPIRY_MS
    await this.mutate((cache) => {
      cache.cardBlocklist = cache.cardBlocklist ?? {}
      cache.cardBlocklist[normalized] = expiry
      return true
    })
    getLogger().info(
      t('cli.cacheStore.blocklisted', {
        name: normalized,
        expires: new Date(expiry).toISOString(),
      }),
    )
  }

  async isBlocked(name: string): Promise<boolean> {
    const normalized = name.toLowerCase()
    const cache = await this.load()
    const expiry = cache.cardBlocklist?.[normalized]
    if (expiry === undefined) return false
    return expiry > this.now()
  }

  async purgeExpiredBlocklist(): Promise<void> {
    const now = this.now()
    let purged: string[] = []
    await this.mutate((cache) => {
      purged = []
      if (!cache.cardBlocklist) return false
      for (const [name, expiry] of Object.entries(cache.cardBlocklist)) {
        if (expiry <= now) {
          delete cache.cardBlocklist[name]
          purged.push(name)
        }
      }
      return purged.length > 0
    })
    for (const name of purged) getLogger().info(t('cli.cacheStore.unblocklisted', { name }))
  }
}
