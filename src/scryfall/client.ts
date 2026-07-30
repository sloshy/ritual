import { type ScryfallCard, type ScryfallList } from '../types'
import { getCacheDir, getImageCacheDir } from '../cache'
import {
  type HttpClient,
  type CacheManager,
  type PricingBackend,
  type FileSystemClient,
  createDefaultFileSystemClient,
} from '../interfaces'
import type { PriceCurrency } from '../price-currency'
import { getPriceField } from '../price-currency'
import { getBannedPrintings } from '../ritual-config'
import { promptsUnavailable } from '../no-input'
import { getLogger } from '../logger'
import { getErrorMessage, throwHttpError } from '../errors'
import path from 'node:path'
import prompts from 'prompts'
import {
  type CardNameFilter,
  isDigitalOnlySet,
  isArenaOnly,
  isRealPrinting,
  classifyExcludedPrinting,
  type PrintingExclusion,
  getFrontFaceName,
  mapScryfallCard,
} from './card-utils'
import {
  type ScryfallTag,
  type TagIndex,
  attachTags,
  buildTagIndex,
  parseTagBulk,
  parseTagIndex,
} from './tags'
import { type GzipJsonLinesProgress, readGzipJsonLines } from './jsonl'
import { fetchScryfallBulkManifest, type ScryfallBulkManifestEntry } from './bulk-manifest'
import type { CacheRefreshProgressHandler, PreloadCacheOptions } from './progress'
import { withCacheLock } from '../cache/lock'
import { writeFileAtomic } from '../cache/atomic-write'

const RATE_LIMIT_MS = 150
const SCRYFALL_CARDS_PER_PAGE = 175

/**
 * How many result pages {@link ScryfallClient.searchCards} walks by default.
 * One page is 175 cards — enough for any interactive search, and a bounded
 * default keeps a new caller from crawling an entire result set by accident.
 */
export const DEFAULT_SEARCH_MAX_PAGES = 1

/** Walk every page — for callers that genuinely want the whole result set (`cache preload-set`). */
export const ALL_PAGES = Number.POSITIVE_INFINITY

/** Paging bound for {@link ScryfallClient.searchCards}. */
export type SearchCardsOptions = {
  /** Result pages to walk, from page 1. Defaults to {@link DEFAULT_SEARCH_MAX_PAGES}. */
  maxPages?: number
}

/** How long a single Scryfall API request may take before it is aborted. */
const SCRYFALL_FETCH_TIMEOUT_MS = 15_000

class RequestQueue {
  private readonly queue: Array<() => Promise<void>> = []
  private tickPending = false
  private lastFiredAt = 0

  constructor(private readonly intervalMs: number) {}

  enqueueBack(task: () => Promise<void>): void {
    this.queue.push(task)
    this.scheduleIfNeeded()
  }

  enqueueFront(task: () => Promise<void>): void {
    this.queue.unshift(task)
    this.scheduleIfNeeded()
  }

  private scheduleIfNeeded(): void {
    if (this.tickPending || this.queue.length === 0) return
    const elapsed = Date.now() - this.lastFiredAt
    const delay = Math.max(0, this.intervalMs - elapsed)
    this.tickPending = true
    setTimeout(() => this.tick(), delay)
  }

  private tick(): void {
    this.tickPending = false
    this.lastFiredAt = Date.now()
    const task = this.queue.shift()
    if (task) void task()
    this.scheduleIfNeeded()
  }
}

export type CurrencyPrint = {
  representative: ScryfallCard | null
  cheapest: ScryfallCard | null
}

export type RepresentativePrintsResult = Partial<Record<PriceCurrency, CurrencyPrint>>

export type MinMaxPrice = {
  min: number
  max: number
}

export type FetchCardDataOptions = { silent?: boolean }
export type FetchNamedCardOptions = { fuzzy?: boolean; set?: string }
type ScryfallErrorBody = { details: string }

/** Request-level failure from a card fetch: a network error or a non-404 HTTP response. */
export type ScryfallFetchError = { error: string }

/**
 * Result of a single-card fetch: the card, `null` when Scryfall reports that no
 * such card exists (HTTP 404), or a {@link ScryfallFetchError} when the request
 * itself failed and existence could not be determined.
 */
export type FetchCardResult = ScryfallCard | ScryfallFetchError | null

/** A {@link FetchCardResult} classified into its three outcomes for exhaustive handling. */
export type FetchCardOutcome =
  | { kind: 'card'; card: ScryfallCard }
  | { kind: 'not-found' }
  | { kind: 'failed'; message: string }

/**
 * Classify a {@link FetchCardResult} so callers share one discrimination of the
 * union instead of re-deriving the `'error' in`/null checks (and their exit-code
 * mapping) at every call site.
 */
export function classifyFetchCard(result: FetchCardResult): FetchCardOutcome {
  if (result === null) return { kind: 'not-found' }
  if ('error' in result) return { kind: 'failed', message: result.error }
  return { kind: 'card', card: result }
}

/** Extract the human-readable `details` from a Scryfall error body, falling back to the HTTP status. */
async function readScryfallErrorDetails(response: Response): Promise<string> {
  const errorBody = await response.json().catch(() => null)
  return errorBody && typeof errorBody === 'object' && 'details' in errorBody
    ? (errorBody as ScryfallErrorBody).details
    : `${response.status} ${response.statusText}`
}
/**
 * One fetched search page. `data` is null for a CSV fetch (the page lives in
 * `raw`) and for a Scryfall 404, which means "no matches" — an empty page, not
 * a failure.
 */
export type SearchPage = {
  kind: 'page'
  data: ScryfallList<ScryfallCard> | null
  raw: string
  hasMore: boolean
}

/**
 * Scryfall refused the request. A malformed query is a 4xx here, so callers can
 * blame the query rather than reporting a server error; `message` carries
 * Scryfall's own `details` text when it sent one.
 */
export type SearchPageFailure = {
  kind: 'failed'
  status: number
  message: string
}

/** The outcome of {@link ScryfallClient.fetchSearchPage}. */
export type SearchPageResult = SearchPage | SearchPageFailure

/**
 * Compute representative and cheapest prints from cached card data.
 * @param recentPrintings - Printings sorted by release date descending, used to pick the representative.
 * @param allPrintings - All printings for the card, used to find the cheapest.
 * @param bannedPrintings - `set:collectorNumber` keys (set code lowercased) that must
 *   never be chosen as the representative; the selection slides to the next eligible
 *   printing. Banned printings still count toward `cheapest`.
 */
export function computeRepresentativePrints(
  recentPrintings: ScryfallCard[],
  allPrintings: ScryfallCard[],
  currencies: PriceCurrency[],
  bannedPrintings: ReadonlySet<string> = new Set(),
): RepresentativePrintsResult {
  type Candidate = { card: ScryfallCard; price: number }
  const result: RepresentativePrintsResult = {}

  for (const currency of currencies) {
    const priceField = getPriceField(currency)

    const candidates: Candidate[] = []
    for (const card of recentPrintings) {
      if (candidates.length >= 5) break
      if (bannedPrintings.has(`${card.set.toLowerCase()}:${card.collector_number}`)) continue
      const raw = card.prices?.[priceField]
      if (!raw) continue
      const price = parseFloat(raw)
      if (Number.isFinite(price) && price > 0) candidates.push({ card, price })
    }

    let representative: ScryfallCard | null = null
    if (candidates.length > 0) {
      const sorted = [...candidates].sort((a, b) => a.price - b.price)
      const mid = Math.floor(sorted.length / 2)
      const median =
        sorted.length % 2 === 1
          ? sorted[mid]!.price
          : (sorted[mid - 1]!.price + sorted[mid]!.price) / 2
      const chosen = candidates.find((c) => c.price <= median * 1.5)
      representative = chosen?.card ?? null
    }

    let cheapest: ScryfallCard | null = null
    let minPrice = Infinity
    for (const card of allPrintings) {
      const raw = card.prices?.[priceField]
      if (!raw) continue
      const price = parseFloat(raw)
      if (Number.isFinite(price) && price > 0 && price < minPrice) {
        minPrice = price
        cheapest = card
      }
    }

    result[currency] = { representative, cheapest }
  }

  return result
}

export interface ScryfallSymbol {
  symbol: string
  svg_uri: string
  english: string
  transposable: boolean
  represents_mana: boolean
  appears_in_mana_costs: boolean
  cmc?: number
  funny: boolean
  colors: string[]
}

interface ScryfallCollectionResponse {
  data: ScryfallCard[]
  not_found?: Array<{ name?: string }>
}

/**
 * Check the minimum shape of a `default_cards` bulk line that
 * {@link mapScryfallCard} dereferences unconditionally.
 */
function isBulkCardEntry(value: unknown): value is ScryfallCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Record<string, unknown>
  return (
    typeof card['name'] === 'string' &&
    typeof card['set'] === 'string' &&
    typeof card['prices'] === 'object' &&
    card['prices'] !== null
  )
}

export class ScryfallClient implements PricingBackend {
  private fileSystem: FileSystemClient
  private readonly requestQueue: RequestQueue

  constructor(
    private http: HttpClient,
    private cardCache: CacheManager<ScryfallCard[]>,
    fileSystem?: FileSystemClient,
    requestQueueIntervalMs?: number,
  ) {
    this.fileSystem = fileSystem ?? createDefaultFileSystemClient()
    this.requestQueue = new RequestQueue(requestQueueIntervalMs ?? RATE_LIMIT_MS * 2)
  }

  private hasPrompted = false
  /** undefined = not yet loaded; null = loaded but no cache file; TagIndex = loaded. */
  private tagIndex: TagIndex | null | undefined

  /**
   * `http.fetch` with a {@link SCRYFALL_FETCH_TIMEOUT_MS} abort timeout, for
   * the short per-request API calls (card lookups, search pages, price
   * batches). Deliberately not used for bulk-file downloads, whose transfer
   * time legitimately exceeds any per-request budget. A timeout is rethrown
   * with a clear message so it surfaces through the existing request-failure
   * shapes.
   */
  private async fetchWithTimeout(url: string | URL, init?: RequestInit): Promise<Response> {
    try {
      return await this.http.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(SCRYFALL_FETCH_TIMEOUT_MS),
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        throw new Error(
          `Scryfall request timed out after ${SCRYFALL_FETCH_TIMEOUT_MS / 1000} seconds: ${url}`,
          { cause: e },
        )
      }
      throw e
    }
  }

  private async checkAndPromptPreload() {
    if (this.hasPrompted) return
    this.hasPrompted = true

    // With prompts unavailable, proceed without preloading — downstream
    // cache-miss paths fetch (or fail) per card instead.
    if (promptsUnavailable()) return

    if (this.cardCache.isEmpty && (await this.cardCache.isEmpty())) {
      const response = await prompts({
        type: 'confirm',
        name: 'value',
        message:
          'MTG CLI runs faster and hits rate limits less often if data is cached up front. Would you like to pre-cache Scryfall data for all English MTG cards?',
        initial: true,
      })

      if (response.value) {
        // `preloadCache` propagates now; this prompt is an optional speed-up, so a
        // cold network must not abort whatever command triggered it.
        try {
          await this.preloadCache()
        } catch (e) {
          getLogger().error('\nFailed to preload all cards:', e)
        }
      }
    }
  }

  async fetchSymbology(forceRefresh = false): Promise<ScryfallSymbol[]> {
    const cachePath = path.join(getCacheDir(), 'symbology.json')

    if (!forceRefresh) {
      try {
        const cached = await this.fileSystem.readFile(cachePath, 'utf-8')
        const data = JSON.parse(cached)
        if (data && Array.isArray(data)) return data
      } catch {
        // Cache miss or corrupt JSON — fall through to fetch from API
      }
    }

    getLogger().info('Fetching symbology from Scryfall...')
    const response = await this.fetchWithTimeout('https://api.scryfall.com/symbology')
    if (!response.ok) throwHttpError(response, 'Failed to fetch symbology')

    const json = (await response.json()) as ScryfallList<ScryfallSymbol>
    const data = json.data

    await this.fileSystem.mkdir(getCacheDir(), { recursive: true })
    await this.fileSystem.writeFile(cachePath, JSON.stringify(data, null, 2))
    return data
  }

  async downloadSymbol(symbol: ScryfallSymbol, destDir: string): Promise<string> {
    // Convert symbol to safe filename (e.g. {W} -> W.svg)
    const safeName = symbol.symbol.replace(/[{}]/g, '').replace(/\//g, '')
    const filename = `${safeName}.svg`
    const cachePath = path.join(getImageCacheDir(), `symbol_${filename}`)
    const destPath = path.join(destDir, filename)

    // Check image cache
    try {
      await this.fileSystem.access(cachePath)
      // If exists in cache, copy to dest
      await this.fileSystem.copyFile(cachePath, destPath)
      return filename
    } catch {
      // Not in cache, download
    }

    // Apply rate limiting to avoid server load, even for static resources
    await Bun.sleep(RATE_LIMIT_MS)

    const response = await this.fetchWithTimeout(symbol.svg_uri)
    if (!response.ok) throw new Error(`Failed to download symbol ${symbol.symbol}`)

    const buffer = await response.arrayBuffer()
    await this.fileSystem.mkdir(getImageCacheDir(), { recursive: true })
    await this.fileSystem.writeFile(cachePath, Buffer.from(buffer))
    await this.fileSystem.copyFile(cachePath, destPath)

    return filename
  }

  async getAllCardNames(filter?: CardNameFilter): Promise<string[]> {
    await this.checkAndPromptPreload()
    const allCardsArrays = await this.cardCache.values()

    let filteredArrays = allCardsArrays
    if (filter?.sets && filter.sets.length > 0) {
      const setSet = new Set(filter.sets.map((s) => s.toLowerCase()))
      filteredArrays = allCardsArrays.filter((cards) =>
        cards.some((c) => setSet.has(c.set.toLowerCase())),
      )
    }

    if (filter?.excludeDigitalOnly) {
      filteredArrays = filteredArrays.filter((cards) => cards.some((c) => !isDigitalOnlySet(c.set)))
    }

    // Flatten to get representative cards for sorting
    const representativeCards = filteredArrays
      .map((cards) => {
        return cards[0]
      })
      .filter((c) => c !== undefined)

    // Sort by edhrec_rank (ascending, so lower number/higher rank comes first)
    // defined ranks come before undefined ranks
    representativeCards.sort((a, b) => {
      const rankA = a.edhrec_rank ?? Number.MAX_SAFE_INTEGER
      const rankB = b.edhrec_rank ?? Number.MAX_SAFE_INTEGER
      return rankA - rankB
    })

    return representativeCards.map((c) => c.name)
  }

  async getCardPrintings(name: string): Promise<ScryfallCard[]> {
    const cached = await this.cardCache.get(name)
    if (cached) {
      for (const c of cached) {
        if (!c.color_identity) c.color_identity = []
      }
      const filtered = cached.filter(isRealPrinting)
      if (filtered.length !== cached.length) {
        // Evict excluded printings (tokens, art series, …) left by an older cache
        this.cardCache.set(name, filtered).catch((e) => {
          getLogger().warn(`Failed to evict excluded printings for '${name}':`, e)
        })
      }
      return filtered
    }
    const single = await this.fetchCardData(name, { silent: true })
    return single ? [single] : []
  }

  /**
   * Get all cards from a specific set, keyed by collector number.
   * Returns a Map for fast O(1) lookups by collector number.
   */
  async getCardsBySet(setCode: string): Promise<Map<string, ScryfallCard>> {
    await this.checkAndPromptPreload()
    const normalizedSet = setCode.toLowerCase()
    const allCardsArrays = await this.cardCache.values()

    const result = new Map<string, ScryfallCard>()

    for (const cards of allCardsArrays) {
      for (const card of cards) {
        if (!card.color_identity) card.color_identity = []
        if (card.set.toLowerCase() === normalizedSet) {
          result.set(card.collector_number, card)
        }
      }
    }

    return result
  }

  async fetchCardData(name: string, options?: FetchCardDataOptions): Promise<ScryfallCard | null> {
    if (!options?.silent) {
      await this.checkAndPromptPreload()
    }

    const cached = await this.cardCache.get(name)
    // Cached is now ScryfallCard[]
    if (cached && cached.length > 0) {
      // Return the first one as default, ensuring color_identity is present (may be missing in older cache)
      const card = cached[0]!
      if (!card.color_identity) card.color_identity = []
      return card
    }

    if (!options?.silent) {
      getLogger().info(`Fetching: ${name}`)
    }
    try {
      // Use exact name match to avoid ambiguity
      const queryName = getFrontFaceName(name)
      if (!queryName) return null
      const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(queryName)}`
      const response = await this.fetchWithTimeout(url)

      if (response.ok) {
        const json = (await response.json()) as ScryfallCard
        const card = mapScryfallCard(json)

        if (isArenaOnly(card)) {
          getLogger().warn(`Card '${name}' is arena-only, skipping.`)
          await Bun.sleep(RATE_LIMIT_MS)
          return null
        }

        const tagIndex = await this.loadTagIndex()
        if (tagIndex) attachTags(card, tagIndex)

        await this.cardCache.set(name, [card]) // wrap in array
        await Bun.sleep(RATE_LIMIT_MS)
        return card
      } else {
        if (response.status === 404) {
          await this.cardCache.addToBlocklist?.(name)
        }
        getLogger().warn(
          `Failed to fetch card '${name}': ${response.status} ${response.statusText}`,
        )
      }
    } catch (e) {
      getLogger().error(`Error fetching card '${name}':`, e)
    }

    await Bun.sleep(RATE_LIMIT_MS)
    return null
  }

  async fetchNamedCard(name: string, options?: FetchNamedCardOptions): Promise<FetchCardResult> {
    const mode = options?.fuzzy ? 'fuzzy' : 'exact'
    const params = new URLSearchParams({ [mode]: name })
    if (options?.set) {
      params.set('set', options.set)
    }

    const url = `https://api.scryfall.com/cards/named?${params.toString()}`
    return this.fetchSingleCard(url)
  }

  async fetchRandomCard(filter?: string): Promise<FetchCardResult> {
    const params = new URLSearchParams()
    if (filter) {
      params.set('q', filter)
    }

    const qs = params.toString()
    const url = `https://api.scryfall.com/cards/random${qs ? `?${qs}` : ''}`
    return this.fetchSingleCard(url)
  }

  /**
   * Fetch one card from a Scryfall endpoint that returns a single card object.
   * A 404 is `null` (the card genuinely does not exist / nothing matched);
   * any other failure is surfaced as a {@link ScryfallFetchError} so callers
   * can distinguish "not found" from "request failed".
   */
  private async fetchSingleCard(url: string): Promise<FetchCardResult> {
    let result: FetchCardResult
    try {
      const response = await this.fetchWithTimeout(url)
      if (response.ok) {
        result = (await response.json()) as ScryfallCard
      } else if (response.status === 404) {
        result = null
      } else {
        result = { error: await readScryfallErrorDetails(response) }
      }
    } catch (e) {
      result = { error: getErrorMessage(e) }
    }

    await Bun.sleep(RATE_LIMIT_MS)
    return result
  }

  async fetchLatestPrices(
    names: string[],
    currency: PriceCurrency = 'usd',
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>()
    const batchSize = 75
    const priceField = getPriceField(currency)

    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize)
      const identifiers = batch.map((name) => ({
        name: getFrontFaceName(name),
      }))

      const response = await this.fetchWithTimeout('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers }),
      })

      if (!response.ok) {
        throwHttpError(response, 'Failed to fetch batch prices')
      }

      const json = (await response.json()) as ScryfallCollectionResponse
      const missingNames = (json.not_found ?? [])
        .map((item) => item.name?.trim())
        .filter((name): name is string => Boolean(name))
      if (missingNames.length > 0) {
        throw new Error(`Scryfall could not find prices for: ${missingNames.join(', ')}`)
      }

      for (let index = 0; index < batch.length; index++) {
        const requestedName = batch[index]
        const card = json.data[index]
        const raw = card?.prices?.[priceField]
        if (!requestedName || !raw) continue

        const latestPrice = Number.parseFloat(raw)
        if (Number.isFinite(latestPrice) && latestPrice > 0) {
          results.set(requestedName, latestPrice)
        }
      }

      await Bun.sleep(RATE_LIMIT_MS)
    }

    return results
  }

  /** Per-currency representative and cheapest prints, fetching all pages via the request queue. */
  async fetchRepresentativePrints(
    name: string,
    currencies: PriceCurrency[],
  ): Promise<RepresentativePrintsResult> {
    const encodedName = encodeURIComponent(`!"${name}"`)
    const firstPageUrl = `https://api.scryfall.com/cards/search?q=${encodedName}+unique%3Aprints&order=released`

    return new Promise<RepresentativePrintsResult>((resolve) => {
      const firstPageCards: ScryfallCard[] = []
      let firstPageDone = false
      const allCards: ScryfallCard[] = []

      const finish = () => {
        const realPrintings = allCards.filter(isRealPrinting)
        const mapped = realPrintings.map((c) => mapScryfallCard(c))
        if (mapped.length > 0) {
          this.cardCache.set(name, mapped).catch((e) => {
            getLogger().warn(`Failed to cache printings for '${name}':`, e)
          })
        }
        const realFirstPage = firstPageCards.filter(isRealPrinting)
        resolve(
          computeRepresentativePrints(
            realFirstPage,
            realPrintings,
            currencies,
            getBannedPrintings(),
          ),
        )
      }

      const processPage =
        (url: string): (() => Promise<void>) =>
        async () => {
          try {
            const response = await this.fetchWithTimeout(url)
            if (!response.ok) {
              if (response.status === 404 && !firstPageDone) {
                await this.cardCache.addToBlocklist?.(name)
              }
              finish()
              return
            }
            const json = (await response.json()) as ScryfallList<ScryfallCard>
            const data = json.data ?? []
            if (!firstPageDone) {
              firstPageCards.push(...data)
              firstPageDone = true
            }
            allCards.push(...data)
            if (json.has_more && json.next_page) {
              this.requestQueue.enqueueFront(processPage(json.next_page))
            } else {
              finish()
            }
          } catch {
            finish()
          }
        }

      this.requestQueue.enqueueBack(processPage(firstPageUrl))
    })
  }

  async fetchMinMaxPrice(name: string, currency: PriceCurrency = 'usd'): Promise<MinMaxPrice> {
    const priceField = getPriceField(currency)
    const orderField = priceField
    const encodedName = encodeURIComponent(`!"${name}"`)
    const url = `https://api.scryfall.com/cards/search?q=${encodedName}+unique%3Aprints&order=${orderField}&dir=asc`

    try {
      const response = await this.fetchWithTimeout(url)
      if (response.ok) {
        const json = (await response.json()) as ScryfallList<ScryfallCard>
        const data = json.data
        if (data && data.length > 0) {
          const prices = data
            .map((card) => card.prices?.[priceField])
            .filter((price): price is string => price !== null && price !== undefined)
            .map((price) => parseFloat(price))
            .filter((p) => Number.isFinite(p) && p > 0)

          if (prices.length > 0) {
            return {
              min: prices[0] ?? 0,
              max: prices[prices.length - 1] ?? 0,
            }
          }
        }
      }
    } catch {
      // fall back to zeroes
    }

    return { min: 0, max: 0 }
  }

  /**
   * Project raw Scryfall search items to real printings and warm the local cache
   * with the names it does not already hold.
   *
   * Both halves matter and travel together: the cache stores `ScryfallCard`, not
   * raw Scryfall JSON, so warming without `mapScryfallCard` would poison it, and
   * `isRealPrinting` keeps tokens, art series, and other non-printings out.
   * An existing name is never overwritten — a warm-up may not replace a full
   * printing list built by a preload with the one printing a search happened to
   * return.
   */
  async cacheRealPrintings(items: readonly ScryfallCard[]): Promise<ScryfallCard[]> {
    const cards: ScryfallCard[] = []
    for (const item of items) {
      if (!isRealPrinting(item)) continue

      const card = mapScryfallCard(item)

      const existing = await this.cardCache.get(card.name)
      if (!existing) {
        await this.cardCache.set(card.name, [card])
      }

      cards.push(card)
    }
    return cards
  }

  /**
   * Run a Scryfall search and cache every real printing it returns.
   *
   * Walks at most {@link SearchCardsOptions.maxPages} result pages — one by
   * default, so an interactive search costs a single request. Callers that want
   * the whole result set (`cache preload-set`) pass {@link ALL_PAGES}.
   */
  async searchCards(query: string, options: SearchCardsOptions = {}): Promise<ScryfallCard[]> {
    // Clamped, so a sub-1 or fractional bound behaves as "one page" rather than
    // as "no pages" — the first page is always fetched, and only the continue
    // condition consults the bound. `ALL_PAGES` (Infinity) survives the trunc.
    const maxPages = Math.max(1, Math.trunc(options.maxPages ?? DEFAULT_SEARCH_MAX_PAGES))
    await this.checkAndPromptPreload()
    getLogger().info(`Searching for: ${query}`)
    try {
      // Use order=edhrec to prioritize popular cards
      let nextUrl: string | undefined =
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`
      const allCards: ScryfallCard[] = []
      let pagesFetched = 0

      while (nextUrl) {
        pagesFetched++
        const response: Response = await this.fetchWithTimeout(nextUrl)

        if (response.ok) {
          const json = (await response.json()) as ScryfallList<ScryfallCard>
          const data = json.data || []

          allCards.push(...(await this.cacheRealPrintings(data)))

          if (json.has_more && json.next_page && pagesFetched < maxPages) {
            nextUrl = json.next_page
            // Only the continue path sleeps, so a one-page search costs no delay.
            await Bun.sleep(RATE_LIMIT_MS)
          } else {
            nextUrl = undefined
          }
        } else {
          if (response.status === 404) {
            // If it's the first page and 404, return empty.
            if (allCards.length === 0) return []
            break
          }
          getLogger().warn(
            `Failed to search cards '${query}': ${response.status} ${response.statusText}`,
          )
          break
        }
      }
      return allCards
    } catch (e) {
      getLogger().error(`Error searching cards '${query}':`, e)
      return []
    }
  }

  async fetchSearchPage(
    query: string,
    page: number,
    format: 'json' | 'csv',
  ): Promise<SearchPageResult> {
    const formatParam = format === 'csv' ? '&format=csv' : '' // json is default
    const pageParam = `&page=${page}`
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec${formatParam}${pageParam}`

    const response = await this.fetchWithTimeout(url)

    if (!response.ok) {
      // A 404 is Scryfall's "nothing matched" — the empty page it has always been.
      if (response.status === 404) {
        return { kind: 'page', data: null, raw: '', hasMore: false }
      }
      return {
        kind: 'failed',
        status: response.status,
        message: await readScryfallErrorDetails(response),
      }
    }

    if (format === 'csv') {
      const text = await response.text()
      const lineCount = text.trim().split('\n').length
      const hasMore = lineCount >= SCRYFALL_CARDS_PER_PAGE + 1

      return { kind: 'page', data: null, raw: text, hasMore }
    } else {
      const json = (await response.json()) as ScryfallList<ScryfallCard>
      const hasMore = json.has_more || false
      return { kind: 'page', data: json, raw: JSON.stringify(json, null, 2), hasMore }
    }
  }

  async downloadImage(url: string, destPath: string): Promise<boolean> {
    try {
      // Determine cache path from destPath which includes ID
      const filename = path.basename(destPath)
      const cachedPath = path.join(getImageCacheDir(), filename)

      try {
        await this.fileSystem.access(cachedPath)
        await this.fileSystem.mkdir(path.dirname(destPath), { recursive: true })
        await this.fileSystem.copyFile(cachedPath, destPath)
        return true
      } catch {
        // File does not exist in cache yet.
      }

      // Download if not in cache
      await this.fileSystem.mkdir(getImageCacheDir(), { recursive: true })

      const response = await this.fetchWithTimeout(url)
      if (!response.ok) return false

      const blob = await response.blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())

      await this.fileSystem.writeFile(cachedPath, bytes)

      await this.fileSystem.mkdir(path.dirname(destPath), { recursive: true })
      await this.fileSystem.writeFile(destPath, bytes)

      return true
    } catch (e) {
      getLogger().error(`Failed to download image from ${url}:`, e)
      return false
    }
  }

  private tagCachePath(): string {
    return path.join(getCacheDir(), 'tags.json')
  }

  private async fetchTagBulk(url: string): Promise<ScryfallTag[]> {
    const response = await this.http.fetch(url)
    if (!response.ok) throwHttpError(response, `Failed to fetch tag bulk ${url}`)
    if (!response.body) throw new Error(`Tag bulk response for ${url} has no body`)
    return this.parseTagBulkStream(response.body)
  }

  /** Parse a gzipped-JSONL tag bulk (from HTTP or a local artifact) into tags. */
  private async parseTagBulkStream(body: ReadableStream<Uint8Array>): Promise<ScryfallTag[]> {
    const items: unknown[] = []
    for await (const value of readGzipJsonLines(body)) {
      items.push(value)
    }
    const parsed = parseTagBulk(items)
    if (typeof parsed === 'string') throw new Error(parsed)
    return parsed
  }

  /** Build the {@link TagIndex} from parsed tag bulks and persist it to tags.json. */
  private async persistTagIndex(
    oracleTags: ScryfallTag[],
    artTags: ScryfallTag[],
  ): Promise<TagIndex> {
    const index = buildTagIndex(oracleTags, artTags, Date.now())
    await this.fileSystem.mkdir(getCacheDir(), { recursive: true })
    await writeFileAtomic(this.fileSystem, this.tagCachePath(), JSON.stringify(index))
    this.tagIndex = index
    getLogger().info(
      `Indexed tags for ${Object.keys(index.oracle).length} oracle ids and ${Object.keys(index.illustration).length} illustrations.`,
    )
    return index
  }

  /** Fetch the Scryfall bulk-data manifest listing each available bulk file. */
  private fetchBulkMetadata(): Promise<ScryfallBulkManifestEntry[]> {
    return fetchScryfallBulkManifest(this.http)
  }

  /** Persist a batch of name → printings entries, using bulkSet when available. */
  private async flushCardEntries(entries: Record<string, ScryfallCard[]>): Promise<void> {
    if (this.cardCache.bulkSet) {
      await this.cardCache.bulkSet(entries)
    } else {
      for (const [name, cards] of Object.entries(entries)) {
        await this.cardCache.set(name, cards)
      }
    }
  }

  /**
   * Download the oracle + art tag bulk files, build a derived {@link TagIndex},
   * and persist it to `cache/tags.json`. Returns `null` (and logs a warning) on
   * failure so callers can proceed without tags.
   */
  async downloadTagIndex(): Promise<TagIndex | null> {
    try {
      getLogger().info('Fetching tag bulk metadata from Scryfall...')
      const metadata = await this.fetchBulkMetadata()

      const oracleMeta = metadata.find((d) => d.type === 'oracle_tags')
      const artMeta = metadata.find((d) => d.type === 'art_tags')
      if (!oracleMeta?.jsonl_download_uri || !artMeta?.jsonl_download_uri) {
        throw new Error('Could not find oracle_tags / art_tags bulk data URIs')
      }

      getLogger().info('Downloading oracle and art tags...')
      const oracleTags = await this.fetchTagBulk(oracleMeta.jsonl_download_uri)
      const artTags = await this.fetchTagBulk(artMeta.jsonl_download_uri)
      return await this.persistTagIndex(oracleTags, artTags)
    } catch (e) {
      getLogger().warn(`Failed to download tags: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /**
   * Load the persisted {@link TagIndex} from `cache/tags.json`, memoized for the
   * lifetime of the client. Returns `null` when no tag cache exists yet.
   */
  private async loadTagIndex(): Promise<TagIndex | null> {
    if (this.tagIndex !== undefined) return this.tagIndex
    try {
      const raw = await this.fileSystem.readFile(this.tagCachePath(), 'utf-8')
      const parsed = parseTagIndex(JSON.parse(raw))
      this.tagIndex = typeof parsed === 'string' ? null : parsed
    } catch {
      this.tagIndex = null
    }
    return this.tagIndex
  }

  /**
   * Re-attach tags to every already-cached card without re-downloading the (much
   * larger) `default_cards` bulk. Downloads a fresh tag index unless `prefetched`
   * is supplied (e.g. by a caller that already downloaded it for its own use).
   */
  async refreshTags(prefetched?: TagIndex | null): Promise<void> {
    await withCacheLock(this.fileSystem, 'tag refresh', async () => {
      const index = prefetched ?? (await this.downloadTagIndex())
      if (!index) {
        getLogger().error('Tag refresh aborted: could not download tags.')
        return
      }

      const names = await this.cardCache.keys()
      getLogger().info(`Re-attaching tags to ${names.length} cached cards...`)
      const entries: Record<string, ScryfallCard[]> = {}
      for (const name of names) {
        const printings = await this.cardCache.get(name)
        if (!printings) continue
        for (const card of printings) attachTags(card, index)
        entries[name] = printings
      }

      await this.flushCardEntries(entries)
      getLogger().info('Done! Tags refreshed.')
    })
  }

  /**
   * Rebuild the card cache from Scryfall's `default_cards` bulk file.
   *
   * Failures **propagate**: a caller that wants a best-effort warm catches them
   * itself, and one that reports the outcome (the admin route and the MCP
   * `refresh_cache` tool) can only do so because they arrive here.
   */
  async preloadCache(options?: PreloadCacheOptions): Promise<void> {
    await withCacheLock(this.fileSystem, 'bulk card cache download', () =>
      this.downloadBulkCards(options),
    )
  }

  /**
   * Download and ingest the `default_cards` gzipped-JSONL bulk file, streaming
   * each line through filter → map → tag attachment without ever holding the
   * whole file in memory. The caller must hold the cache-write lock.
   */
  private async downloadBulkCards(options?: PreloadCacheOptions): Promise<void> {
    const onProgress: CacheRefreshProgressHandler = options?.onProgress ?? ((): void => {})

    getLogger().info('Fetching bulk data metadata from Scryfall...')
    onProgress({ stage: 'metadata', message: 'Fetching bulk data metadata from Scryfall…' })
    const metadata = await this.fetchBulkMetadata()
    const defaultData = metadata.find((d) => d.type === 'default_cards')

    if (!defaultData?.jsonl_download_uri) {
      throw new Error('Could not find default_cards bulk data URI')
    }

    // Download tags up front so they can be baked onto each card as it streams in.
    onProgress({ stage: 'tags', message: 'Downloading oracle/art tags…' })
    const tagIndex = await this.downloadTagIndex()

    const bulkUrl = defaultData.jsonl_download_uri
    getLogger().info(`Bulk URL: ${bulkUrl}`)

    const response = await this.http.fetch(bulkUrl)
    if (!response.ok) throwHttpError(response, 'Failed to fetch bulk data')
    if (!response.body) throw new Error('Bulk data response has no body')

    // The manifest's `size` describes the uncompressed data, so the compressed
    // download total comes from the response itself (absent on chunked bodies).
    const totalBytes = Number(response.headers.get('content-length') ?? 0)
    const totalMiB = (totalBytes / 1024 / 1024).toFixed(2)
    if (totalBytes > 0) {
      getLogger().info(`Download size: ${totalMiB} MiB (compressed)`)
      onProgress({
        stage: 'download',
        message: `Download size: ${totalMiB} MiB (compressed)`,
      })
    }

    await this.ingestCardStream(response.body, tagIndex, totalBytes, options)

    getLogger().info('Done! Card cache populated.')
    onProgress({ stage: 'done', message: 'Done! Card cache populated.' })
  }

  /**
   * Stream a `default_cards` gzipped-JSONL body through filter → map → tag
   * attachment into the card cache, without ever holding the whole file in
   * memory. `totalBytes` (compressed) drives the progress percentage when known.
   */
  private async ingestCardStream(
    body: ReadableStream<Uint8Array>,
    tagIndex: TagIndex | null,
    totalBytes: number,
    options?: PreloadCacheOptions,
  ): Promise<void> {
    const report: CacheRefreshProgressHandler = options?.onProgress ?? ((): void => {})
    const totalMiB = (totalBytes / 1024 / 1024).toFixed(2)
    // Progress update max every 100ms to avoid spamming stdout
    let lastUpdate = 0
    const onProgress = ({ compressedBytes }: GzipJsonLinesProgress): void => {
      const now = Date.now()
      if (now - lastUpdate <= 100 && compressedBytes !== totalBytes) return
      lastUpdate = now
      const receivedMiB = (compressedBytes / 1024 / 1024).toFixed(2)
      if (totalBytes > 0) {
        const percentage = Math.round((compressedBytes / totalBytes) * 100)
        getLogger().progress(`\rProcessing: ${percentage}% (${receivedMiB}/${totalMiB} MiB)`)
        report({
          stage: 'download',
          percentage,
          message: `Processing: ${percentage}% (${receivedMiB}/${totalMiB} MiB)`,
        })
      } else {
        getLogger().progress(`\rProcessing: ${receivedMiB} MiB`)
        report({ stage: 'download', message: `Processing: ${receivedMiB} MiB` })
      }
    }

    const entries: Record<string, ScryfallCard[]> = {}
    let cardCount = 0
    const excluded: Record<PrintingExclusion, number> = {
      'arena-only': 0,
      token: 0,
      'art-series': 0,
    }
    let malformedCount = 0
    for await (const item of readGzipJsonLines(body, onProgress)) {
      // Guard the minimum shape mapScryfallCard dereferences, so one malformed
      // line skips that entry instead of aborting the whole multi-GB ingestion.
      if (!isBulkCardEntry(item)) {
        malformedCount++
        continue
      }
      const exclusion = classifyExcludedPrinting(item)
      if (exclusion) {
        excluded[exclusion]++
        continue
      }

      const card = mapScryfallCard(item)
      if (tagIndex) attachTags(card, tagIndex)
      ;(entries[card.name] ??= []).push(card)
      cardCount++
    }
    getLogger().progress('\n')

    if (malformedCount > 0) {
      getLogger().warn(`Skipped ${malformedCount} malformed bulk card entries.`)
    }
    const excludedEntries = Object.entries(excluded).filter(([, count]) => count > 0)
    if (excludedEntries.length > 0) {
      const total = excludedEntries.reduce((sum, [, count]) => sum + count, 0)
      const breakdown = excludedEntries.map(([reason, count]) => `${count} ${reason}`).join(', ')
      getLogger().info(`Filtered out ${total} printings (${breakdown}).`)
    }
    getLogger().info(`Processed ${cardCount} cards.`)

    getLogger().info('Saving to cache...')
    report({ stage: 'save', message: 'Saving to cache…' })
    await this.flushCardEntries(entries)
  }

  /**
   * Ingest previously downloaded bulk artifacts (e.g. fetched from a cache
   * feed) into the card cache: build + persist the tag index from the local
   * tag bulks, then stream the local `default_cards` file through the same
   * pipeline as {@link preloadCache}. Unlike `preloadCache`, failures throw —
   * feed callers decide how to handle them.
   */
  async preloadCacheFromFiles(files: BulkCacheFiles): Promise<void> {
    await withCacheLock(this.fileSystem, 'bulk card cache ingest', async () => {
      let tagIndex: TagIndex | null = null
      try {
        getLogger().info('Building tag index from downloaded tag bulks...')
        const oracleTags = await this.parseTagBulkStream(Bun.file(files.oracleTags).stream())
        const artTags = await this.parseTagBulkStream(Bun.file(files.artTags).stream())
        tagIndex = await this.persistTagIndex(oracleTags, artTags)
      } catch (e) {
        // Tags are an enhancement — ingest cards without them rather than fail.
        getLogger().warn(`Failed to build tags from downloaded bulks: ${getErrorMessage(e)}`)
      }

      const cardsFile = Bun.file(files.defaultCards)
      await this.ingestCardStream(cardsFile.stream(), tagIndex, cardsFile.size)
      getLogger().info('Done! Card cache populated from downloaded artifacts.')
    })
  }
}

/** Local paths of the three bulk artifacts {@link ScryfallClient.preloadCacheFromFiles} ingests. */
export type BulkCacheFiles = {
  defaultCards: string
  oracleTags: string
  artTags: string
}
