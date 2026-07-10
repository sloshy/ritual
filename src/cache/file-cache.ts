import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { type PriceData, type ScryfallCard } from '../types'
import {
  createDefaultFileSystemClient,
  type CacheManager,
  type CacheStreamEntryMeta,
} from '../interfaces'
import { writeFileAtomic } from './atomic-write'
import { getLogger } from '../logger'
import { getBaseDir } from '../base-dir'

export function getCacheDir(): string {
  return path.join(getBaseDir(), 'cache')
}
export function getImageCacheDir(): string {
  return path.join(getCacheDir(), 'images')
}
export function getCacheFile(): string {
  return path.join(getCacheDir(), 'cache.json')
}
export const DEFAULT_EXPIRATION_MS = 86400000 // 24 hours
const BLOCKLIST_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

const fileSystem = createDefaultFileSystemClient()

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
  metadata?: Partial<Record<CacheSection, { lastRefreshedAt?: number }>>
}

// Conditional type helper: extracts the data type for a given CacheSection key
export type DataType<K extends CacheSection> = CacheSchema[K] extends
  | Record<string, CachedItem<infer D>>
  | undefined
  ? D
  : never

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

  private async load(): Promise<CacheSchema> {
    if (this.memoryCache) return this.memoryCache

    const defaultSchema: CacheSchema = { prices: {}, cards: {} }
    let result: CacheSchema = defaultSchema
    try {
      const file = Bun.file(this.filePathGetter())
      if (await file.exists()) {
        const text = await file.text()
        const json = JSON.parse(text) as Partial<CacheSchema>

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
              getLogger().info('Detected old cache schema (single objects). Resetting cards cache.')
              json.cards = {}
            }
          }

          result = json as CacheSchema
        } else {
          getLogger().warn('Detected invalid cache format. Resetting cache.')
        }
      }
    } catch (e) {
      getLogger().error('Failed to load cache, starting fresh.', e)
    }
    this.memoryCache = result
    return result
  }

  private async save(): Promise<void> {
    if (!this.memoryCache) return
    try {
      const filePath = this.filePathGetter()
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFileAtomic(fileSystem, filePath, JSON.stringify(this.memoryCache, null, 2))
    } catch (e) {
      getLogger().error('Failed to save cache:', e)
    }
  }

  async get(key: string): Promise<DataType<K> | null> {
    const cache = await this.load()
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>> | undefined

    // Safety check if section was somehow undefined despite load defaults
    if (!sectionData) return null

    const entry = sectionData[key]

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
    const entry = sectionData?.[key]
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

  async set(key: string, value: DataType<K>): Promise<void> {
    const cache = await this.load()
    // Ensure section exists
    if (!cache[this.section]) {
      cache[this.section] = {}
    }
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>>

    const item: CachedItem<DataType<K>> = {
      timestamp: this.now(),
      data: value,
    }
    if (this.section === 'cards') {
      item.lowercaseName = key.toLowerCase()
      cache.cardNameIndex = cache.cardNameIndex ?? {}
      cache.cardNameIndex[key.toLowerCase()] = key
    }
    sectionData[key] = item
    await this.save()
  }

  async bulkSet(entries: Record<string, DataType<K>>): Promise<void> {
    const cache = await this.load()
    if (!cache[this.section]) {
      cache[this.section] = {}
    }
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>>

    const now = this.now()
    if (this.section === 'cards') {
      cache.cardNameIndex = cache.cardNameIndex ?? {}
    }
    for (const [key, value] of Object.entries(entries)) {
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
    await this.save()
  }

  async isEmpty(): Promise<boolean> {
    const cache = await this.load()
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>> | undefined
    return !sectionData || Object.keys(sectionData).length === 0
  }

  async delete(key: string): Promise<void> {
    const cache = await this.load()
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>> | undefined
    if (sectionData && key in sectionData) {
      delete sectionData[key]
      await this.save()
    }
  }

  async clear(): Promise<void> {
    const cache = await this.load()
    cache[this.section] = {}
    if (cache.metadata) {
      delete cache.metadata[this.section]
    }
    await this.save()
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
    return cache.cardNameIndex?.[lowercaseName] ?? null
  }

  async addToBlocklist(name: string): Promise<void> {
    const normalized = name.toLowerCase()
    const expiry = this.now() + BLOCKLIST_EXPIRY_MS
    const cache = await this.load()
    cache.cardBlocklist = cache.cardBlocklist ?? {}
    cache.cardBlocklist[normalized] = expiry
    getLogger().info(`Card '${normalized}' added to blocklist (expires ${new Date(expiry).toISOString()}).`)
    await this.save()
  }

  async isBlocked(name: string): Promise<boolean> {
    const normalized = name.toLowerCase()
    const cache = await this.load()
    const expiry = cache.cardBlocklist?.[normalized]
    if (expiry === undefined) return false
    return expiry > this.now()
  }

  async purgeExpiredBlocklist(): Promise<void> {
    const cache = await this.load()
    if (!cache.cardBlocklist) return
    const now = this.now()
    let changed = false
    for (const [name, expiry] of Object.entries(cache.cardBlocklist)) {
      if (expiry <= now) {
        delete cache.cardBlocklist[name]
        getLogger().info(`Card '${name}' removed from blocklist (expired).`)
        changed = true
      }
    }
    if (changed) await this.save()
  }
}
