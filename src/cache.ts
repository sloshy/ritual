import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { type PriceData, type ScryfallCard } from './types'

import { type CacheManager, type CacheStreamEntryMeta } from './interfaces'
import { getCacheServerBaseUrl } from './cache-config'

export const CACHE_DIR = path.join(process.cwd(), 'cache')
export const IMAGE_CACHE_DIR = path.join(CACHE_DIR, 'images')
export const CACHE_FILE = path.join(CACHE_DIR, 'cache.json')
const DEFAULT_EXPIRATION_MS = 86400000 // 24 hours

interface CachedItem<T> {
  timestamp: number
  data: T
}

export type CacheSection = 'prices' | 'cards'

interface CacheSchema {
  prices: Record<string, CachedItem<PriceData>>
  cards?: Record<string, CachedItem<ScryfallCard[]>>
  metadata?: Partial<Record<CacheSection, { lastRefreshedAt?: number }>>
}

// Helper generic class
type DataType<K extends CacheSection> = CacheSchema[K] extends
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
    // Clear this section
    const cache = await this.load()
    cache[this.section] = {} as unknown as CacheSchema[K]
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
}

interface CacheServerGetResponse<T> {
  value: T | null
}

interface CacheServerTimestampResponse {
  timestamp: number | null
}

interface CacheServerKeysResponse {
  keys: string[]
}

interface CacheServerValuesResponse<T> {
  values: T[]
}

interface CacheServerIsEmptyResponse {
  isEmpty: boolean
}

interface CacheServerSetRequest<T> {
  value: T
}

interface CacheServerBulkSetRequest<T> {
  entries: Record<string, T>
}

interface CacheServerStreamRequest {
  keys: string[]
}

interface CacheServerStreamEntry<T> {
  key: string
  value: T
  updated: boolean
}

export class HttpCacheManager<K extends CacheSection> implements CacheManager<DataType<K>> {
  constructor(
    private baseUrl: string,
    private section: K,
  ) {}

  private buildPath(pathSuffix: string): string {
    return `${this.baseUrl}/cache/${this.section}${pathSuffix}`
  }

  private async requestJson<T>(pathSuffix: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.buildPath(pathSuffix), init)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Cache server request failed (${response.status}) ${init?.method ?? 'GET'} ${this.buildPath(pathSuffix)}${body ? `: ${body}` : ''}`,
      )
    }
    if (response.status === 204) {
      return undefined as T
    }
    return (await response.json()) as T
  }

  async get(key: string): Promise<DataType<K> | null> {
    const response = await this.requestJson<CacheServerGetResponse<DataType<K>>>(
      `/${encodeURIComponent(key)}`,
    )
    return response.value
  }

  async getTimestamp(key: string): Promise<number | null> {
    const response = await this.requestJson<CacheServerTimestampResponse>(
      `/${encodeURIComponent(key)}/timestamp`,
    )
    return response.timestamp
  }

  async getLastRefreshedAt(): Promise<number | null> {
    const response = await this.requestJson<CacheServerTimestampResponse>('/metadata')
    return response.timestamp
  }

  async streamGetMany(
    keys: string[],
    onEntry: (key: string, value: DataType<K>, meta: CacheStreamEntryMeta) => void,
  ): Promise<Record<string, DataType<K>>> {
    if (this.section !== 'prices') {
      throw new Error('streamGetMany is only supported for prices cache.')
    }

    if (keys.length === 0) return {}

    const response = await fetch(this.buildPath('/stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys } satisfies CacheServerStreamRequest),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Cache server request failed (${response.status}) POST ${this.buildPath('/stream')}${body ? `: ${body}` : ''}`,
      )
    }

    if (!response.body) {
      throw new Error('Cache server stream response body is missing.')
    }

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    const results: Record<string, DataType<K>> = {}
    let buffer = ''

    const handleEvent = (raw: string) => {
      let eventType = 'message'
      const dataLines: string[] = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) {
          eventType = line.slice('event:'.length).trim()
          continue
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart())
        }
      }

      if (dataLines.length === 0) return
      const data = dataLines.join('\n')

      if (eventType === 'done') return
      if (eventType === 'error') {
        throw new Error(`Cache server stream error: ${data}`)
      }
      if (eventType !== 'price') return

      const payload = JSON.parse(data) as CacheServerStreamEntry<DataType<K> | null>
      if (payload.value === null) return
      results[payload.key] = payload.value
      onEntry(payload.key, payload.value, { updated: payload.updated === true })
    }

    const processBuffer = (flush: boolean) => {
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary === -1) break
        const eventChunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (eventChunk.trim().length > 0) {
          handleEvent(eventChunk)
        }
      }
      if (flush && buffer.trim().length > 0) {
        handleEvent(buffer)
        buffer = ''
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      processBuffer(false)
    }
    buffer += decoder.decode()
    processBuffer(true)

    return results
  }

  async set(key: string, value: DataType<K>): Promise<void> {
    await this.requestJson<void>(`/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value } satisfies CacheServerSetRequest<DataType<K>>),
    })
  }

  async bulkSet(entries: Record<string, DataType<K>>): Promise<void> {
    await this.requestJson<void>('/bulk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries } satisfies CacheServerBulkSetRequest<DataType<K>>),
    })
  }

  async isEmpty(): Promise<boolean> {
    const response = await this.requestJson<CacheServerIsEmptyResponse>('/is-empty')
    return response.isEmpty
  }

  async delete(key: string): Promise<void> {
    await this.requestJson<void>(`/${encodeURIComponent(key)}`, { method: 'DELETE' })
  }

  async clear(): Promise<void> {
    await this.requestJson<void>('', { method: 'DELETE' })
  }

  async keys(): Promise<string[]> {
    const response = await this.requestJson<CacheServerKeysResponse>('/keys')
    return response.keys
  }

  async values(): Promise<DataType<K>[]> {
    const response = await this.requestJson<CacheServerValuesResponse<DataType<K>>>('/values')
    return response.values
  }
}

class RuntimeCacheManager<K extends CacheSection> implements CacheManager<DataType<K>> {
  private localCache: FileCacheManager<K>
  private httpCachesByBaseUrl: Map<string, HttpCacheManager<K>> = new Map()

  constructor(
    filePath: string,
    private section: K,
    expirationMs: number = DEFAULT_EXPIRATION_MS,
  ) {
    this.localCache = new FileCacheManager(filePath, section, expirationMs)
  }

  private getActiveCache(): CacheManager<DataType<K>> {
    const baseUrl = getCacheServerBaseUrl()
    if (!baseUrl) return this.localCache

    let cache = this.httpCachesByBaseUrl.get(baseUrl)
    if (!cache) {
      cache = new HttpCacheManager(baseUrl, this.section)
      this.httpCachesByBaseUrl.set(baseUrl, cache)
    }
    return cache
  }

  async get(key: string): Promise<DataType<K> | null> {
    return this.getActiveCache().get(key)
  }

  async getTimestamp(key: string): Promise<number | null> {
    const cache = this.getActiveCache()
    if (cache.getTimestamp) {
      return cache.getTimestamp(key)
    }
    return null
  }

  async getLastRefreshedAt(): Promise<number | null> {
    const cache = this.getActiveCache()
    if (cache.getLastRefreshedAt) {
      return cache.getLastRefreshedAt()
    }
    return null
  }

  async streamGetMany(
    keys: string[],
    onEntry: (key: string, value: DataType<K>, meta: CacheStreamEntryMeta) => void,
  ): Promise<Record<string, DataType<K>>> {
    return this.getActiveCache().streamGetMany(keys, onEntry)
  }

  async set(key: string, value: DataType<K>): Promise<void> {
    return this.getActiveCache().set(key, value)
  }

  async bulkSet(entries: Record<string, DataType<K>>): Promise<void> {
    const cache = this.getActiveCache()
    if (cache.bulkSet) {
      return cache.bulkSet(entries)
    }
    for (const [key, value] of Object.entries(entries)) {
      await cache.set(key, value)
    }
  }

  async isEmpty(): Promise<boolean> {
    const cache = this.getActiveCache()
    if (cache.isEmpty) {
      return cache.isEmpty()
    }
    const keys = await cache.keys()
    return keys.length === 0
  }

  async delete(key: string): Promise<void> {
    return this.getActiveCache().delete(key)
  }

  async clear(): Promise<void> {
    return this.getActiveCache().clear()
  }

  async keys(): Promise<string[]> {
    return this.getActiveCache().keys()
  }

  async values(): Promise<DataType<K>[]> {
    return this.getActiveCache().values()
  }
}

// Instances
export const defaultCache = new RuntimeCacheManager(CACHE_FILE, 'prices')

// 0 means no expiration (infinite)
export const cardCache = new RuntimeCacheManager(CACHE_FILE, 'cards', 0)

// Legacy exports for backward compatibility in prices.ts
export async function getCachedPrice(key: string): Promise<PriceData | null> {
  return defaultCache.get(key)
}

export async function setCachedPrice(key: string, data: PriceData): Promise<void> {
  return defaultCache.set(key, data)
}
