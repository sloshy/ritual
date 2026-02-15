import path from 'path'
import { mkdir } from 'fs/promises'
import { type PriceData, type ScryfallCard } from './types'

import { type CacheManager } from './interfaces'

export const CACHE_DIR = path.join(process.cwd(), 'cache')
export const IMAGE_CACHE_DIR = path.join(CACHE_DIR, 'images')
const CACHE_FILE = path.join(CACHE_DIR, 'cache.json')
const DEFAULT_EXPIRATION_MS = 86400000 // 24 hours

interface CachedItem<T> {
  timestamp: number
  data: T
}

interface CacheSchema {
  prices: Record<string, CachedItem<PriceData>>
  cards?: Record<string, CachedItem<ScryfallCard[]>>
}

// Helper generic class
type DataType<K extends keyof CacheSchema> = CacheSchema[K] extends
  | Record<string, CachedItem<infer D>>
  | undefined
  ? D
  : never

export class FileCacheManager<K extends keyof CacheSchema> implements CacheManager<DataType<K>> {
  private filePath: string
  private section: K
  private memoryCache: CacheSchema | null = null
  private expirationMs: number

  constructor(filePath: string, section: K, expirationMs: number = DEFAULT_EXPIRATION_MS) {
    this.filePath = filePath
    this.section = section
    this.expirationMs = expirationMs
  }

  private async load(): Promise<CacheSchema> {
    if (this.memoryCache) return this.memoryCache

    const defaultCache: CacheSchema = { prices: {}, cards: {} }
    try {
      const file = Bun.file(this.filePath)
      if (await file.exists()) {
        const text = await file.text()
        const json = JSON.parse(text)

        // Basic validation
        if (typeof json === 'object' && json !== null) {
          // Ensure schema default keys exist if missing
          if (!json.prices) json.prices = {}
          if (!json.cards) json.cards = {}

          // Validate cards schema (migration check)
          const sampleCardKey = Object.keys(json.cards)[0]
          if (sampleCardKey) {
            const sampleData = json.cards[sampleCardKey].data
            if (!Array.isArray(sampleData)) {
              console.log('Detected old cache schema (single objects). Resetting cards cache.')
              json.cards = {}
            }
          }

          this.memoryCache = json as CacheSchema
        } else {
          console.warn('Detected invalid cache format. resetting cache.')
          this.memoryCache = defaultCache
        }
      } else {
        this.memoryCache = defaultCache
      }
    } catch (e) {
      console.error('Failed to load cache, starting fresh.', e)
      this.memoryCache = defaultCache
    }
    return this.memoryCache!
  }

  private async save(): Promise<void> {
    if (!this.memoryCache) return
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await Bun.write(this.filePath, JSON.stringify(this.memoryCache, null, 2))
    } catch (e) {
      console.error('Failed to save cache:', e)
    }
  }

  // Type helper to extract T from the section

  async get(key: string): Promise<DataType<K> | null> {
    const cache = await this.load()
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>> | undefined

    // Safety check if section was somehow undefined despite load defaults
    if (!sectionData) return null

    const entry = sectionData[key]

    if (!entry) return null

    const age = Date.now() - entry.timestamp

    if (this.expirationMs > 0 && age > this.expirationMs) {
      await this.delete(key)
      return null
    }

    return entry.data
  }

  async set(key: string, value: DataType<K>): Promise<void> {
    const cache = await this.load()
    // Ensure section exists
    if (!cache[this.section]) {
      // Cast is still needed because TS can't verify K corresponds to correct Record type for assignment of {}
      // but we can cast to explicit type
      cache[this.section] = {} as unknown as CacheSchema[K]
    }
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>>

    sectionData[key] = {
      timestamp: Date.now(),
      data: value,
    }
    await this.save()
  }

  async bulkSet(entries: Record<string, DataType<K>>): Promise<void> {
    const cache = await this.load()
    if (!cache[this.section]) {
      cache[this.section] = {} as unknown as CacheSchema[K]
    }
    const sectionData = cache[this.section] as Record<string, CachedItem<DataType<K>>>

    const now = Date.now()
    for (const [key, value] of Object.entries(entries)) {
      sectionData[key] = {
        timestamp: now,
        data: value as DataType<K>,
      }
    }
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
    // Clear this section
    const cache = await this.load()
    cache[this.section] = {} as unknown as CacheSchema[K]
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
}

// Instances
export const defaultCache = new FileCacheManager(CACHE_FILE, 'prices')

// 0 means no expiration (infinite)
export const cardCache = new FileCacheManager(CACHE_FILE, 'cards', 0)

// Legacy exports for backward compatibility in prices.ts
export async function getCachedPrice(key: string): Promise<PriceData | null> {
  return defaultCache.get(key)
}

export async function setCachedPrice(key: string, data: PriceData): Promise<void> {
  return defaultCache.set(key, data)
}
