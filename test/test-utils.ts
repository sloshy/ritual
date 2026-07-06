import {
  type HttpClient,
  type CacheManager,
  type FileSystemClient,
  type ExclusiveWriteResult,
} from '../src/interfaces'
import { streamFromBatchResults } from '../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../src/logger'

/** In-memory FileSystemClient for tests that must not touch the real filesystem. */
export class MemoryFileSystemClient implements FileSystemClient {
  readonly files = new Map<string, string>()

  async readFile(filePath: string): Promise<string> {
    const data = this.files.get(filePath)
    if (data === undefined) throw new Error(`ENOENT: ${filePath}`)
    return data
  }

  async writeFile(filePath: string, data: string | Uint8Array): Promise<void> {
    this.files.set(filePath, typeof data === 'string' ? data : new TextDecoder().decode(data))
  }

  async writeFileExclusive(
    filePath: string,
    data: string | Uint8Array,
  ): Promise<ExclusiveWriteResult> {
    if (this.files.has(filePath)) return 'exists'
    await this.writeFile(filePath, data)
    return 'created'
  }

  async rename(source: string, destination: string): Promise<void> {
    const data = this.files.get(source)
    if (data === undefined) throw new Error(`ENOENT: ${source}`)
    this.files.delete(source)
    this.files.set(destination, data)
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(filePath)
  }

  async access(filePath: string): Promise<void> {
    if (!this.files.has(filePath)) throw new Error(`ENOENT: ${filePath}`)
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const data = this.files.get(source)
    if (data === undefined) throw new Error(`ENOENT: ${source}`)
    this.files.set(destination, data)
  }

  async mkdir(): Promise<void> {}
}

/** Gzip-compress `values` into JSONL bytes, as Scryfall's `.jsonl.gz` bulk files are served. */
export function gzipJsonLines(values: unknown[]): Uint8Array {
  const text = values.map((value) => JSON.stringify(value)).join('\n') + '\n'
  return Bun.gzipSync(new TextEncoder().encode(text))
}

/** A Response streaming `values` as a gzipped JSONL body. */
export function gzipJsonLinesResponse(values: unknown[]): Response {
  const bytes = gzipJsonLines(values)
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
    { headers: { 'content-length': bytes.byteLength.toString() } },
  )
}

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

/** HttpClient that throws on any fetch call, for tests that must not make external requests. */
export class DenyHttpClient implements HttpClient {
  async fetch(url: string | URL): Promise<Response> {
    throw new Error(`DenyHttpClient: HTTP request to ${url} is not allowed in tests.`)
  }
}

export { MemoryLogger, setLogger, resetLogger }
