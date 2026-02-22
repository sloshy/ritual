import { type HttpClient, type CacheManager } from '../src/interfaces'
import { streamFromBatchResults } from '../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../src/logger'

export class MockHttpClient implements HttpClient {
  private handlers: Map<string, (init?: RequestInit) => Response | Promise<Response>> = new Map()
  private defaultHandler:
    | ((url: string, init?: RequestInit) => Response | Promise<Response>)
    | null = null

  mock(url: string, response: Response | ((init?: RequestInit) => Response | Promise<Response>)) {
    if (typeof response === 'function') {
      this.handlers.set(url, response)
    } else {
      this.handlers.set(url, () => response.clone())
    }
  }

  mockDefault(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    this.defaultHandler = handler
  }

  async fetch(url: string | URL, init?: RequestInit): Promise<Response> {
    const urlStr = url.toString()
    const handler = this.handlers.get(urlStr)

    if (handler) {
      return handler(init)
    }

    if (this.defaultHandler) {
      return this.defaultHandler(urlStr, init)
    }

    throw new Error(`No mock handler for ${urlStr}`)
  }
}

interface CachedItem<T> {
  timestamp: number
  data: T
}

export class InMemoryCacheManager<T> implements CacheManager<T> {
  private cache = new Map<string, CachedItem<T>>()
  private expirationMs: number

  constructor(expirationMs: number = 86400000) {
    // Default 24hrs
    this.expirationMs = expirationMs
  }

  async get(key: string): Promise<T | null> {
    const item = this.cache.get(key)
    if (!item) return null

    if (this.expirationMs > 0) {
      const age = Date.now() - item.timestamp
      if (age > this.expirationMs) {
        this.cache.delete(key)
        return null
      }
    }
    return item.data
  }

  async set(key: string, value: T): Promise<void> {
    this.cache.set(key, { timestamp: Date.now(), data: value })
  }

  async streamGetMany(
    keys: string[],
    onEntry: (key: string, value: T, meta: { updated: boolean }) => void,
  ): Promise<Record<string, T>> {
    const results: Record<string, T> = {}
    for (const key of keys) {
      const value = await this.get(key)
      if (value === null) continue
      results[key] = value
    }
    return streamFromBatchResults(keys, results, onEntry)
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }

  async keys(): Promise<string[]> {
    return Array.from(this.cache.keys())
  }

  async values(): Promise<T[]> {
    return Array.from(this.cache.values()).map((item) => item.data)
  }
}

export { MemoryLogger, setLogger, resetLogger }
