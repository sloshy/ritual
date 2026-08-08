import {
  afterAll as bunAfterAll,
  beforeEach as bunBeforeEach,
  expect,
  test as bunTest,
} from 'bun:test'
import type { ApplyChange, MissReason } from '../src/editor/apply-batch'
import {
  type HttpClient,
  type CacheManager,
  type FileSystemClient,
  type ExclusiveWriteResult,
} from '../src/interfaces'
import { cardCache, streamFromBatchResults } from '../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../src/logger'
import { quoteKey, type BuylistQuote } from '../src/buylist'
import { setBuylistFetcher } from '../src/site/buylist-quotes'
import type { CardKingdomCacheFile, CardKingdomProduct } from '../src/cardkingdom'
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

/**
 * A cached printing of one card at `set:collectorNumber`, optionally in a
 * specific language (`lang` omitted models a `default_cards` object, which
 * counts as English). The shared fixture for suites exercising printing
 * identity/language resolution (`findPrinting`, `printingLanguages`,
 * `resolvePrintingLanguage`, the editors' printing-key maps).
 */
export function makePrintingIn(set: string, collectorNumber: string, lang?: string): ScryfallCard {
  return makeScryfallCard({
    id: `${set}-${collectorNumber}${lang ? `-${lang}` : ''}`,
    name: 'Lightning Bolt',
    set,
    set_name: set.toUpperCase(),
    collector_number: collectorNumber,
    ...(lang !== undefined ? { lang } : {}),
  })
}

/** A CardData tile with neutral defaults for site sorting/filtering tests. */
export function makeCardData(overrides: Partial<CardData> = {}): CardData {
  return {
    name: 'Test Card',
    quantity: 1,
    cmc: 3,
    edhrec: 1000,
    price: 1.5,
    buylistPrice: 0,
    buylistSpread: 0,
    onBuylist: false,
    type: 'Creature — Human',
    section: 'Main',
    fileOrder: 0,
    setCode: 'tst',
    colorIdentity: [],
    hasPrinting: true,
    oracleTags: [],
    artTags: [],
    labels: [],
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

// ── Scryfall bulk-data fixtures ─────────────────────────────────────────────
//
// The three suites that drive a cache refresh (the engine's own progress unit
// test, the admin route's integration test, and the MCP HTTP progress test) all
// need the same four URLs and the same bulk-index body. They had three copies,
// which had already drifted in which card fields they set. The URL constants and
// the payload builders live here so a unit test can import them; the two
// `globalThis.fetch` installers that serve them live in
// `test/integration/helpers/scryfall-bulk.ts`.

/** Scryfall's bulk-data index endpoint — the first request any refresh makes. */
export const BULK_META_URL = 'https://api.scryfall.com/bulk-data'
/** Stand-in download URLs the index points the refresh at. */
export const DEFAULT_CARDS_URI = 'https://data.example/default-cards.jsonl.gz'
export const ORACLE_TAGS_URI = 'https://data.example/oracle-tags.jsonl.gz'
export const ART_TAGS_URI = 'https://data.example/art-tags.jsonl.gz'

/** One entry of the bulk-data index. */
export type BulkMetaEntry = { type: string; jsonl_download_uri: string }

/** The bulk-data index body: the three files a refresh downloads. */
export type BulkMetaBody = { data: BulkMetaEntry[] }

export function bulkMetaBody(): BulkMetaBody {
  return {
    data: [
      { type: 'default_cards', jsonl_download_uri: DEFAULT_CARDS_URI },
      { type: 'oracle_tags', jsonl_download_uri: ORACLE_TAGS_URI },
      { type: 'art_tags', jsonl_download_uri: ART_TAGS_URI },
    ],
  }
}

/**
 * One card line of a `default_cards` bulk file, with every field the ingest
 * reads already set. Sol Ring by default; override what the test is about.
 */
export function bulkCard(overrides: Partial<ScryfallCard> = {}): Partial<ScryfallCard> {
  return {
    id: 'sol-1',
    oracle_id: 'o-sol',
    illustration_id: 'i-sol',
    name: 'Sol Ring',
    type_line: 'Artifact',
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '472',
    rarity: 'uncommon',
    finishes: ['nonfoil'],
    games: ['paper'],
    prices: { usd: '1.50', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    ...overrides,
  }
}

/** The two-card bulk file the refresh suites share. */
export function bulkCards(): Partial<ScryfallCard>[] {
  return [
    bulkCard(),
    bulkCard({
      id: 'bolt-1',
      oracle_id: 'o-bolt',
      illustration_id: 'i-bolt',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      set: '2x2',
      set_name: 'Double Masters 2022',
      collector_number: '117',
      prices: {
        usd: '2.00',
        usd_foil: null,
        usd_etched: null,
        eur: null,
        eur_foil: null,
        tix: null,
      },
    }),
  ]
}

/**
 * The shape both progress vocabularies share: Ritual's `RouteProgress` and the
 * MCP SDK's `Progress`. Typed structurally so one assertion serves both.
 */
export type ProgressLike = { progress: number; total?: number }

/**
 * Assert a run's progress reports are usable as a progress bar: at least one
 * report, strictly increasing (the spec's requirement, and what the MCP sink's
 * guard enforces), and — when `expectedTotal` is given — all on one scale.
 *
 * A hand-rolled `for` loop comparing `reports[i]` to `reports[i - 1]` was written
 * out at three call sites; a run that emitted a single report passed all three
 * vacuously, which is why the non-empty check is part of this.
 */
export function expectMonotonicProgress(
  reports: readonly ProgressLike[],
  expectedTotal?: number,
): void {
  expect(reports.length).toBeGreaterThan(0)
  for (let i = 1; i < reports.length; i++) {
    expect(reports[i]!.progress).toBeGreaterThan(reports[i - 1]!.progress)
  }
  if (expectedTotal !== undefined) {
    expect(reports.every((r) => r.total === expectedTotal)).toBeTrue()
  }
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
  private lastRefreshedAt: number | null = null

  constructor(expirationMs: number = 86400000) {
    // Default 24hrs
    this.expirationMs = expirationMs
  }

  /**
   * Stamp the cache as bulk-downloaded, the way a completed preload does. It is
   * what tells a cached printing list "this is every printing of the card"
   * apart from "one card was fetched into an otherwise cold cache".
   */
  async markRefreshed(at: number = Date.now()): Promise<void> {
    this.lastRefreshedAt = at
  }

  async getLastRefreshedAt(): Promise<number | null> {
    return this.lastRefreshedAt
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

/** Which streams {@link stubTty} pretends are (or are not) terminals. */
export type TtyStubs = { stdin?: boolean; stdout?: boolean }

/**
 * Simulate terminals for the current test file: `bun test` never runs on one,
 * so the `!isTTY` half of every prompt gate would trip on its own and the
 * `--no-input` half could be deleted without a failure.
 *
 * The stubs are re-applied before each test — a case that flips a stream to
 * prove the other half of a gate needs no `finally` — and the real values are
 * restored when the file finishes, so nothing leaks into the next one.
 */
export function stubTty(streams: TtyStubs): void {
  const original = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }
  bunBeforeEach(() => {
    if (streams.stdin !== undefined) process.stdin.isTTY = streams.stdin
    if (streams.stdout !== undefined) process.stdout.isTTY = streams.stdout
  })
  bunAfterAll(() => {
    process.stdin.isTTY = original.stdin
    process.stdout.isTTY = original.stdout
  })
}

/** Minimal in-memory localStorage stand-in for the test environment. */
class MemoryStorage {
  private map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null
  }
}

/**
 * Install a fresh in-memory `localStorage` for the current test file — applied
 * before each test (a case that swaps in a broken or absent storage, e.g. via
 * {@link denyLocalStorage}, needs no `finally`) and restored when the file
 * finishes (modeled on {@link stubTty}). `bun test` has no DOM, so browser
 * modules that persist flags would otherwise find no storage at all.
 */
export function stubLocalStorage(): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  bunBeforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    })
  })
  bunAfterAll(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })
}

/**
 * Replace `localStorage` with one whose every access throws, to prove a
 * storage failure degrades gracefully. Scoped to the current test:
 * {@link stubLocalStorage}'s per-test hook reinstalls the working stub.
 */
export function denyLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    get() {
      throw new Error('denied')
    },
    configurable: true,
  })
}

/** A parsed Card Kingdom feed product with neutral defaults, for sell fixtures. */
export function makeCardKingdomProduct(
  overrides: Partial<CardKingdomProduct> = {},
): CardKingdomProduct {
  return {
    id: 1,
    sku: 'TST-0001',
    scryfallId: 'sf-1',
    url: 'mtg/test-set/test-card',
    name: 'Test Card',
    variation: '',
    edition: 'Test Set',
    finish: 'nonfoil',
    priceRetail: 1,
    priceBuy: 0.5,
    qtyBuying: 10,
    ...overrides,
  }
}

/**
 * One buyer quote as a detail bakes it and the store seeds it, with neutral
 * defaults.
 *
 * `BuylistQuote` is the wire type the bake and the client store both key their
 * behavior on, so it gets one fixture. (test/e2e/helpers/mock-public-site.ts
 * writes its own literals — a Playwright helper cannot import this module,
 * which pulls in `bun:test` — and must be updated alongside this shape.)
 */
export function makeBuylistQuote(overrides: Partial<BuylistQuote> = {}): BuylistQuote {
  return {
    priceBuy: 4,
    qtyBuying: 2,
    buying: true,
    finish: 'nonfoil',
    matchVia: 'scryfall-id',
    productId: 1,
    name: 'Test Card',
    edition: 'Test Set',
    ...overrides,
  }
}

/** The generation stamp {@link stubBuylistFetcher}'s answers carry. */
export const STUB_BUYLIST_FEED_CREATED_AT = '2026-08-04 06:06:09'

/** Handles on the transport {@link stubBuylistFetcher} installed. */
export type StubBuylistFetcher = {
  /** How many times the transport was called. */
  calls: () => number
  /** Fail every later call, as an unreachable server would. */
  breakIt: () => void
}

/**
 * Install a quote transport into the client store that answers every requested
 * printing with `priceBuy`.
 *
 * Keys its answers through `quoteKey` rather than restating the format: that
 * key's own doc calls it "the one key where a near-miss yields a wrong *price*
 * rather than a blank cell", and a suite asserting that a settled key is never
 * re-asked has to key its answers the way the store looks them up.
 *
 * The install is module-global, so a suite that calls this must
 * `resetBuylistFetcher()` in its `afterEach` — `bun test` shares the module
 * registry across files, and a stub left behind silently answers a later file's
 * requests.
 */
export function stubBuylistFetcher(priceBuy: number): StubBuylistFetcher {
  let calls = 0
  let broken = false
  setBuylistFetcher(async (buyer, printings) => {
    calls++
    if (broken) throw new Error('Buylist quotes failed: HTTP 503')
    const quotes: Record<string, BuylistQuote> = {}
    for (const printing of printings) {
      quotes[quoteKey(printing.set, printing.collectorNumber, printing.finish)] = makeBuylistQuote({
        name: 'Sol Ring',
        edition: 'Commander 2021',
        priceBuy,
      })
    }
    return {
      success: true,
      buyer,
      quotes,
      feedCreatedAt: STUB_BUYLIST_FEED_CREATED_AT,
      feedRetrievedAt: Date.now(),
      stale: false,
      productCount: Object.keys(quotes).length,
    }
  })
  return {
    calls: () => calls,
    breakIt: () => {
      broken = true
    },
  }
}

/**
 * A raw pricelist payload as Card Kingdom serves it — string-encoded bools and
 * prices — built from the parsed products the fixtures already speak in. For
 * suites that stub the download rather than the cache file.
 *
 * `is_foil` is derived from the product's finish, so an `etched` fixture also
 * needs an "Etched" `variation` for the parser to read it back as etched.
 *
 * `createdAt` is the buyer's own generation stamp: a suite that has to tell a
 * downloaded feed from the cached one passes a different one than
 * {@link makeCardKingdomCacheFile}'s.
 */
export function cardKingdomFeedBody(
  products: CardKingdomProduct[] = [makeCardKingdomProduct()],
  createdAt = '2026-08-04 06:06:09',
): Record<string, unknown> {
  return {
    meta: { created_at: createdAt, base_url: 'https://www.cardkingdom.com/' },
    data: products.map((product) => ({
      id: product.id,
      sku: product.sku,
      scryfall_id: product.scryfallId,
      url: product.url,
      name: product.name,
      variation: product.variation,
      edition: product.edition,
      is_foil: product.finish === 'nonfoil' ? 'false' : 'true',
      price_retail: product.priceRetail.toFixed(2),
      qty_retail: 3,
      price_buy: product.priceBuy.toFixed(2),
      qty_buying: product.qtyBuying,
    })),
  }
}

/** A persisted Card Kingdom cache file wrapping `products`, stamped `retrievedAt`. */
export function makeCardKingdomCacheFile(
  products: CardKingdomProduct[],
  retrievedAt = Date.now(),
): CardKingdomCacheFile {
  return {
    retrievedAt,
    feed: {
      createdAt: '2026-08-04 06:06:09',
      baseUrl: 'https://www.cardkingdom.com/',
      products,
    },
  }
}
