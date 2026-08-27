import type { ScryfallCard, ScryfallList } from './types'
import { getCacheDir, getImageCacheDir } from '../cache'
import {
  type HttpClient,
  type CacheManager,
  type PricingBackend,
  type FileSystemClient,
  createDefaultFileSystemClient,
} from '../util/interfaces'
import { dedupePrintingsByKey, type CardPrintingsResult } from '../card/card-printing'
import type { PriceCurrency } from '../pricing/price-currency'
import { getCardPrice, getPriceField } from '../pricing/price-currency'
import { getBannedPrintings } from '../config/ritual-config'
import { displayLanguage, type CardLanguage } from '../card/card-language'
import { getLogger } from '../util/logger'
import { getErrorMessage, throwHttpError } from '../util/errors'
import path from 'node:path'
import {
  type CardNameFilter,
  isDigitalOnlySet,
  isArenaOnly,
  isRealPrinting,
  classifyExcludedPrinting,
  type PrintingExclusion,
  getFrontFaceName,
  mapScryfallCard,
  normalizeSetFilter,
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
import {
  configuredCardBulkType,
  fetchScryfallBulkManifest,
  isBulkCardEntry,
  type CardBulkType,
  type ScryfallBulkManifestEntry,
} from './bulk-manifest'
import { recordCardBulkType } from '../cache/bulk-provenance'
import type { CacheRefreshProgressHandler, PreloadCacheOptions } from './progress'
import { withCacheLock } from '../cache/lock'
import { writeFileAtomic } from '../cache/atomic-write'
import { RATE_LIMIT_MS, RequestQueue } from './request-queue'
import {
  computeRepresentativePrints,
  type MinMaxPrice,
  type RepresentativePrintsResult,
} from './prices'
import {
  SEARCH_ALL_PAGES_MAX,
  readScryfallErrorDetails,
  type SearchAllPagesResult,
  type SearchPageResult,
} from './search'

const SCRYFALL_CARDS_PER_PAGE = 175

/** How long a single Scryfall API request may take before it is aborted. */
const SCRYFALL_FETCH_TIMEOUT_MS = 15_000

export type FetchCardDataOptions = { silent?: boolean }

/** Options for {@link ScryfallClient.fetchSymbology}. */
export type FetchSymbologyOptions = {
  /** Refetch even when a cached symbology file exists. */
  force?: boolean
  /**
   * Whether Scryfall may be contacted at all. `false` returns the cached
   * symbology, or no symbols when nothing is cached — what `--refresh never`
   * ("use the existing cache as-is") promises.
   */
  network?: boolean
}

/** Options for {@link ScryfallClient.getCardPrintings}. */
export type GetCardPrintingsOptions = {
  /**
   * Whether a cache miss may fall back to a single-card Scryfall fetch.
   * Defaults to true; pass `false` for a cache-only lookup (`--refresh never`,
   * the collection sync's finish resolution) that must never hit the network.
   */
  network?: boolean
}
export type FetchNamedCardOptions = { fuzzy?: boolean; set?: string }

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

/**
 * Whether a value read back from `symbology.json` is usable as a symbol. The
 * cache file is parsed, so a malformed one must be rejected rather than handed
 * to the symbol downloader as an array of anything.
 */
function isScryfallSymbol(value: unknown): value is ScryfallSymbol {
  if (!value || typeof value !== 'object') return false
  const symbol = value as Record<string, unknown>
  return typeof symbol['symbol'] === 'string' && typeof symbol['svg_uri'] === 'string'
}

interface ScryfallCollectionResponse {
  data: ScryfallCard[]
  not_found?: Array<{ name?: string }>
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

  /** Memoized {@link cacheIsBulkBacked} answer; only ever flips false → true. */
  private bulkBacked = false
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

  async fetchSymbology(options?: FetchSymbologyOptions): Promise<ScryfallSymbol[]> {
    const offline = options?.network === false
    // `force` asks for a refetch, but offline there is nothing to refetch with —
    // so the cache is still read rather than answering "no symbols" while a
    // perfectly good symbology file sits on disk.
    const forceRefresh = options?.force === true && !offline
    const cachePath = path.join(getCacheDir(), 'symbology.json')

    if (!forceRefresh) {
      try {
        const cached: unknown = JSON.parse(await this.fileSystem.readFile(cachePath, 'utf-8'))
        if (Array.isArray(cached) && cached.every(isScryfallSymbol)) return cached
      } catch {
        // Cache miss or corrupt JSON — fall through to fetch from API
      }
    }

    if (offline) return []

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
    const allCardsArrays = await this.cardCache.values()

    let filteredArrays = allCardsArrays
    const setFilter = normalizeSetFilter(filter)
    if (setFilter) {
      filteredArrays = allCardsArrays.filter((cards) =>
        cards.some((c) => setFilter.has(c.set.toLowerCase())),
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

  async getCardPrintings(name: string, options?: GetCardPrintingsOptions): Promise<ScryfallCard[]> {
    return (await this.getCardPrintingsResult(name, options)).printings
  }

  /**
   * Like {@link getCardPrintings}, but reports where the list came from so
   * callers can tell the cache's complete printing list apart from the single
   * arbitrary printing a `/cards/named` fallback returns. Pass
   * `{ network: false }` for a cache-only lookup that never touches Scryfall.
   */
  async getCardPrintingsResult(
    name: string,
    options?: GetCardPrintingsOptions,
  ): Promise<CardPrintingsResult> {
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
      // An entry left holding nothing usable (every printing excluded — tokens,
      // art series) is not a printing list anyone can act on, so it reports as
      // `none`. It still short-circuits the fetch: the entry's existence is the
      // record that this name was already looked up.
      if (filtered.length === 0) return { printings: [], source: 'none' }
      // A cache entry is the card's *whole* printing list only when the cache
      // was filled by a bulk download. In a never-bulk-downloaded workspace
      // every entry was written by a single-card fetch, so a one-entry list
      // there means "one printing was looked up once", not "one printing exists".
      const source = (await this.cacheIsBulkBacked()) ? 'complete' : 'partial'
      return { printings: filtered, source }
    }
    if (options?.network === false) return { printings: [], source: 'none' }
    const single = await this.fetchCardData(name, { silent: true })
    return single ? { printings: [single], source: 'partial' } : { printings: [], source: 'none' }
  }

  /**
   * Whether the card cache has ever completed a bulk download. Memoized once
   * true — a bulk download is not undone by anything short of a cache clear,
   * and the remote cache backend answers this over HTTP.
   */
  private async cacheIsBulkBacked(): Promise<boolean> {
    if (this.bulkBacked) return true
    const lastRefreshedAt = await this.cardCache.getLastRefreshedAt?.()
    this.bulkBacked = typeof lastRefreshedAt === 'number'
    return this.bulkBacked
  }

  /**
   * Fetch one specific printing by set code and collector number
   * (`/cards/{set}/{number}`), caching it like any other fetched card. With a
   * non-`en` `language`, fetches that language's object of the printing via
   * `/cards/{set}/{number}/{lang}` instead — the exceptional-case path that
   * lets an en-mode (`default_cards`) cache verify and hold the one foreign
   * card a user tagged, without an `all_cards` download.
   *
   * Exists so a `--set`/`--collector-number` pin can be verified against
   * Scryfall itself when the local cache holds no printing list for the card —
   * validating the pin against a single-card fallback list would reject real
   * printings and print a fabricated "available printings" list.
   */
  async fetchPrintingByCollectorNumber(
    set: string,
    collectorNumber: string,
    language?: CardLanguage,
  ): Promise<ScryfallCard | null> {
    // `en` (explicit or absent) keeps the bare URL: it answers with the same
    // default object and stays byte-identical to the pre-language behavior.
    const lang = displayLanguage(language)
    const langSegment = lang === 'en' ? '' : `/${encodeURIComponent(lang)}`
    const url = `https://api.scryfall.com/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(collectorNumber)}${langSegment}`
    // A request failure propagates: "Scryfall says there is no such printing"
    // (404 → null) and "Scryfall could not be reached, or answered 429/5xx"
    // (throw) are different answers to the caller's question, and only the first
    // one is the user's mistake.
    const response = await this.fetchWithTimeout(url)
    await Bun.sleep(RATE_LIMIT_MS)
    if (response.status === 404) return null
    if (!response.ok) throwHttpError(response, 'Failed to fetch printing')

    const card = mapScryfallCard((await response.json()) as ScryfallCard)
    if (!isRealPrinting(card)) return null

    const tagIndex = await this.loadTagIndex()
    if (tagIndex) attachTags(card, tagIndex)

    // Merge rather than overwrite: the cache entry is the card's printing list,
    // and this is one printing of it. Deduped by Scryfall id — never by
    // set:collector-number, since every language of a printing shares those and
    // each language's object must coexist in the list.
    const existing = (await this.cardCache.get(card.name)) ?? []
    const merged = existing.some((p) => p.id === card.id) ? existing : [...existing, card]
    await this.cardCache.set(card.name, merged)
    return card
  }

  /**
   * Every printing in the local card cache, one card per `set:collectorNumber`
   * pair, honouring the same `sets` / `excludeDigitalOnly` filters as
   * {@link getAllCardNames} — except per *printing* rather than per card, since
   * a printing is exactly what the caller is picking.
   *
   * One card per printing key, collapsed by {@link dedupePrintingsByKey} — the
   * same rule the printing pickers read through, so the two never disagree
   * about which language object represents a printing.
   */
  async getAllPrintings(filter?: CardNameFilter): Promise<ScryfallCard[]> {
    const allCardsArrays = await this.cardCache.values()
    const setFilter = normalizeSetFilter(filter)

    const matching: ScryfallCard[] = []
    for (const cards of allCardsArrays) {
      for (const card of cards) {
        if (!card.color_identity) card.color_identity = []
        const set = card.set.toLowerCase()
        if (setFilter && !setFilter.has(set)) continue
        if (filter?.excludeDigitalOnly && isDigitalOnlySet(set)) continue
        matching.push(card)
      }
    }

    return dedupePrintingsByKey(matching)
  }

  async fetchCardData(name: string, options?: FetchCardDataOptions): Promise<ScryfallCard | null> {
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
          const prices = data.map((card) => getCardPrice(card, currency)).filter((p) => p > 0)

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
   * Run a Scryfall search across **every** result page, caching each real
   * printing, and report failure instead of swallowing it.
   *
   * Built on {@link fetchSearchPage} for exactly that reason: HTTP failures come
   * back as a `failed` result and transport failures (a dead network, a timeout)
   * propagate as exceptions, so a caller that promises an exit code can keep it.
   *
   * Bounded by {@link SEARCH_ALL_PAGES_MAX}: the walk's only other exits are a
   * failure and a page that reports no more, so a response that kept setting
   * `has_more` would loop forever at one request per rate-limit tick.
   */
  async searchAllPages(query: string): Promise<SearchAllPagesResult> {
    getLogger().info(`Searching for: ${query}`)
    const cards: ScryfallCard[] = []
    let matched = 0
    for (let page = 1; page <= SEARCH_ALL_PAGES_MAX; page++) {
      const result = await this.fetchSearchPage(query, page, 'json')
      if (result.kind === 'failed') return result
      const items = result.data?.data ?? []
      matched += items.length
      cards.push(...(await this.cacheRealPrintings(items)))
      if (!result.hasMore) break
      await Bun.sleep(RATE_LIMIT_MS)
    }
    return { kind: 'cards', cards, matched }
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
        // Throws rather than logging and returning: a refresh that did not
        // happen has to be learnable by the command that promises exit 1 for it.
        // The best-effort swallow stays where degradation is intended — the tag
        // bake inside a bulk preload, which uses `downloadTagIndex` directly.
        throw new Error('Tag refresh aborted: could not download the oracle/art tag bulks.')
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
   * Rebuild the card cache from the configured Scryfall card bulk file —
   * `default_cards` when `defaultLanguage` is `en`, the every-language
   * `all_cards` bulk otherwise (see {@link configuredCardBulkType}).
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
   * Download and ingest the configured card bulk's gzipped-JSONL file,
   * streaming each line through filter → map → tag attachment without ever
   * holding the whole file in memory (essential for `all_cards`, which is
   * several times `default_cards`' size). The caller must hold the cache-write
   * lock.
   */
  private async downloadBulkCards(options?: PreloadCacheOptions): Promise<void> {
    const onProgress: CacheRefreshProgressHandler = options?.onProgress ?? ((): void => {})

    const bulkType = configuredCardBulkType()
    getLogger().info('Fetching bulk data metadata from Scryfall...')
    onProgress({ stage: 'metadata', message: 'Fetching bulk data metadata from Scryfall…' })
    const metadata = await this.fetchBulkMetadata()
    const bulkEntry = metadata.find((d) => d.type === bulkType)

    if (!bulkEntry?.jsonl_download_uri) {
      throw new Error(`Could not find ${bulkType} bulk data URI`)
    }

    // Download tags up front so they can be baked onto each card as it streams in.
    onProgress({ stage: 'tags', message: 'Downloading oracle/art tags…' })
    const tagIndex = await this.downloadTagIndex()

    const bulkUrl = bulkEntry.jsonl_download_uri
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
    await recordCardBulkType(bulkType, { fileSystem: this.fileSystem })

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
   * tag bulks, then stream the local card-bulk file through the same pipeline
   * as {@link preloadCache}. Unlike `preloadCache`, failures throw — feed
   * callers decide how to handle them.
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

      const cardsFile = Bun.file(files.cards)
      await this.ingestCardStream(cardsFile.stream(), tagIndex, cardsFile.size)
      await recordCardBulkType(files.cardBulkType, { fileSystem: this.fileSystem })
      getLogger().info('Done! Card cache populated from downloaded artifacts.')
    })
  }
}

/** Local paths of the three bulk artifacts {@link ScryfallClient.preloadCacheFromFiles} ingests. */
export type BulkCacheFiles = {
  /** The card bulk's local path (`default_cards` or `all_cards` — see `cardBulkType`). */
  cards: string
  /** Which Scryfall card bulk `cards` is; recorded as cache provenance after the ingest. */
  cardBulkType: CardBulkType
  oracleTags: string
  artTags: string
}
