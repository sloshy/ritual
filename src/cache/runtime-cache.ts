import { type CacheManager, type CacheStreamEntryMeta } from '../interfaces'
import { getCacheServerBaseUrl } from './config'
import { type CacheSection, type DataType, DEFAULT_EXPIRATION_MS, FileCacheManager } from './file-cache'
import { HttpCacheManager } from './http-cache'

export class RuntimeCacheManager<K extends CacheSection> implements CacheManager<DataType<K>> {
  private localCache: FileCacheManager<K>
  private httpCachesByBaseUrl: Map<string, HttpCacheManager<K>> = new Map()

  constructor(
    filePath: string | (() => string),
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
    return (await this.getActiveCache().getTimestamp?.(key)) ?? null
  }

  async getLastRefreshedAt(): Promise<number | null> {
    return (await this.getActiveCache().getLastRefreshedAt?.()) ?? null
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

  async resolveCardName(lowercaseName: string): Promise<string | null> {
    return this.localCache.resolveCardName(lowercaseName)
  }

  async addToBlocklist(name: string): Promise<void> {
    return this.localCache.addToBlocklist(name)
  }

  async isBlocked(name: string): Promise<boolean> {
    return this.localCache.isBlocked(name)
  }

  async purgeExpiredBlocklist(): Promise<void> {
    return this.localCache.purgeExpiredBlocklist()
  }
}
