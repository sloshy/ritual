import { expect, test as bunTest } from 'bun:test'
import type { ApplyChange, MissReason } from '../src/editor/apply-batch'
import {
  type HttpClient,
  type CacheManager,
  type FileSystemClient,
  type ExclusiveWriteResult,
} from '../src/interfaces'
import { cardCache, streamFromBatchResults } from '../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../src/logger'
import type { ScryfallCard } from '../src/types'
import type { CardData } from '../src/site/card-sorting'

/**
 * Seed the card cache with one neutral printing per name.
 *
 * Through `bulkSet`, which is also what stamps the cache's bulk-refresh time —
 * so a seeded cache reads as freshly preloaded and nothing downstream decides it
 * needs a Scryfall download. For tests whose question is "does this name resolve",
 * not "what is behind it"; a test that cares about the printing builds its own.
 */
export async function seedCardNames(...names: string[]): Promise<void> {
  await cardCache.bulkSet(
    Object.fromEntries(names.map((name) => [name, [makeScryfallCard({ name })]])),
  )
}

/** Overrides for {@link makeScryfallCard}. `prices` may be partial; it is merged over all-null defaults. */
export type ScryfallCardOverrides = Partial<Omit<ScryfallCard, 'prices'>> & {
  prices?: Partial<ScryfallCard['prices']>
}

/** A minimal valid ScryfallCard with neutral defaults. Override any field; partial `prices` are merged. */
export function makeScryfallCard(overrides: ScryfallCardOverrides = {}): ScryfallCard {
  const { prices, ...rest } = overrides
  return {
    id: 'test-id',
    name: 'Test Card',
    cmc: 0,
    type_line: 'Artifact',
    finishes: ['nonfoil'],
    games: ['paper'],
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    color_identity: [],
    ...rest,
    prices: {
      usd: null,
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
      ...prices,
    },
  }
}

/** A CardData tile with neutral defaults for site sorting/filtering tests. */
export function makeCardData(overrides: Partial<CardData> = {}): CardData {
  return {
    name: 'Test Card',
    quantity: 1,
    cmc: 3,
    edhrec: 1000,
    price: 1.5,
    type: 'Creature — Human',
    section: 'Main',
    fileOrder: 0,
    setCode: 'tst',
    colorIdentity: [],
    hasPrinting: true,
    oracleTags: [],
    artTags: [],
    card: null,
    ...overrides,
  }
}

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

/** Computes the mocked Response for one request to a specific mocked URL. */
type HttpResponder = (init?: RequestInit) => Response | Promise<Response>
/** Fallback responder for requests to URLs without a dedicated mock. */
type HttpDefaultResponder = (url: string, init?: RequestInit) => Response | Promise<Response>

export class MockHttpClient implements HttpClient {
  private handlers: Map<string, HttpResponder> = new Map()
  private defaultHandler: HttpDefaultResponder | null = null

  mock(url: string, response: Response | HttpResponder): void {
    if (typeof response === 'function') {
      this.handlers.set(url, response)
    } else {
      this.handlers.set(url, () => response.clone())
    }
  }

  mockDefault(handler: HttpDefaultResponder): void {
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

/** One row of a miss matrix: the reason `onMiss` must report, or null when the change must apply. */
export type MissMatrixCase<TChange> = [
  description: string,
  change: TChange,
  expectMiss: MissReason | null,
]

/**
 * Register one test per miss-matrix row against a change-apply engine. On an
 * expected miss it also proves the data is untouched — compared against a
 * fresh clone taken *before* the call (comparing against the returned
 * reference would be tautological) — and that the input was not mutated.
 */
export function runMissMatrix<TData, TChange>(
  apply: ApplyChange<TData, TChange>,
  makeState: () => TData,
  cases: readonly MissMatrixCase<TChange>[],
): void {
  for (const [description, change, expectMiss] of cases) {
    bunTest(description, () => {
      const state = makeState()
      const before = structuredClone(state)
      const seen: { reason: MissReason | null } = { reason: null }
      const result = apply(state, change, {
        onMiss: (reason) => {
          seen.reason = reason
        },
      })
      expect(seen.reason).toBe(expectMiss)
      if (expectMiss !== null) {
        expect(result).toStrictEqual(before)
        expect(state).toStrictEqual(before)
      }
    })
  }
}
