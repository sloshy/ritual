import path from 'node:path'
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
import { getRitualConfig } from '../config/ritual-config'
import { foldRepeatedFaceNames } from '../scryfall/card-utils'
import {
  LEGACY_CACHE_DIR,
  resolveCacheDir,
  SHARED_CACHE_MIGRATION_ID,
  type CacheDirLocation,
} from '../config/cache-location'
import { hasCacheDataSync } from './cache-entries'
import { ENV_VAR } from '../util/cli-tokens'
import { nonBlank } from '../util/user-dirs'

/**
 * Whether a workspace's old `cache/` folder still holds cache data, keyed by
 * base dir. Asked only while migration 3 is pending there, and remembered for
 * the process: nothing but `ritual migrate` moves that folder, and a migrate
 * run changes the recorded migration, which ends the question.
 */
const legacyCacheHasData = new Map<string, boolean>()

/** Whether the workspace at `baseDir` should still read its own old `cache/` folder. */
function legacyCachePending(baseDir: string, migration: number): boolean {
  if (migration >= SHARED_CACHE_MIGRATION_ID) return false
  let known = legacyCacheHasData.get(baseDir)
  if (known === undefined) {
    known = hasCacheDataSync(path.join(baseDir, LEGACY_CACHE_DIR))
    legacyCacheHasData.set(baseDir, known)
  }
  return known
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
  const overridden =
    nonBlank(process.env[ENV_VAR.cacheDir]) !== undefined || nonBlank(config.cacheDir) !== undefined
  return resolveCacheDir({
    baseDir,
    configured: config.cacheDir,
    legacyPending: !overridden && legacyCachePending(baseDir, config.managed?.migration ?? 0),
  })
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

function enqueueWrite(filePath: string, run: () => Promise<void>): Promise<void> {
  const next = (writeQueues.get(filePath) ?? Promise.resolve()).then(run, run)
  const tail = next.catch(() => undefined)
  writeQueues.set(filePath, tail)
  void tail.then(() => {
    if (writeQueues.get(filePath) === tail) writeQueues.delete(filePath)
  })
  return next
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
  /** Why the file at {@link memoryCachePath} could not be read, when it could not. */
  private memoryCacheFailure: unknown = undefined
  private expirationMs: number
  private now: () => number

  constructor(
    filePath: string | (() => string),
    section: K,
    expirationMs: number = DEFAULT_EXPIRATION_MS,
    now: () => number = Date.now,
  ) {
    this.filePathGetter = typeof filePath === 'function' ? filePath : () => filePath
    this.section = section
    this.expirationMs = expirationMs
    this.now = now
  }

  /**
   * Drop the in-process memo so the next read reloads the cache file. Needed by
   * long-running servers to pick up refreshes written by a separate process —
   * the memo otherwise lives for the lifetime of the process.
   */
  invalidate(): void {
    this.memoryCache = null
    this.memoryCachePath = null
    this.memoryCacheStamp = null
    this.memoryCacheFailure = undefined
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
   * The cache as the file holds it now, with the stamp it was read at. A file
   * that exists but cannot be read or parsed reads as an empty cache — and
   * comes back `unreadable`, so no write ever replaces it with that emptiness.
   * The failure is remembered for the file's current stamp, so it is reported
   * once rather than on every lookup.
   */
  private async loadState(): Promise<LoadedCache> {
    const filePath = this.filePathGetter()
    const stamp = await fileStamp(filePath)
    if (this.memoryCache && this.memoryCachePath === filePath && this.memoryCacheStamp === stamp) {
      return { cache: this.memoryCache, path: filePath, stamp, failure: this.memoryCacheFailure }
    }

    const empty: CacheSchema = { prices: {}, cards: {} }
    let result: CacheSchema = empty
    let failure: unknown = undefined
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
        failure = e
        getLogger().error(t('cli.cacheStore.loadFailed'), e)
      }
    }
    this.memoryCache = result
    this.memoryCachePath = filePath
    this.memoryCacheStamp = stamp
    this.memoryCacheFailure = failure
    return { cache: result, path: filePath, stamp, failure }
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
   * - writes to one file from this process are queued, whichever manager makes them;
   * - each write is checked against the file as this write loaded it, just
   *   before the new contents replace it; when another process rewrote it in
   *   the meantime, the write is abandoned, the file reloaded and `apply` run
   *   again on the newer copy — never an older copy saved over a newer one;
   * - a file that exists but cannot be read is never overwritten: the write
   *   is refused with an error saying so.
   *
   * What remains is the instant between that last check and the rename: two
   * processes whose renames land within it can still lose one write (a
   * single-card save, fetched again on the next lookup; bulk refreshes also
   * hold the cache lock, so two of them never race).
   */
  private mutate(apply: (cache: CacheSchema) => boolean): Promise<void> {
    const run = async (): Promise<void> => {
      for (let attempt = 1; ; attempt++) {
        const state = await this.loadState()
        if (state.failure !== undefined) {
          throw new Error(
            t('cli.cacheStore.unwritable', {
              path: state.path,
              reason: getErrorMessage(state.failure),
            }),
          )
        }
        if (!apply(state.cache)) return
        const written = await this.save(state)
        if (written || attempt === STALE_WRITE_ATTEMPTS) return
        // Another process rewrote the file since it was loaded: start over from it.
        this.invalidate()
      }
    }
    return enqueueWrite(this.filePathGetter(), run)
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
    this.memoryCacheFailure = undefined
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
    })
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
