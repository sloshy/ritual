import { type ScryfallCard, type ScryfallList } from '../types'
import { CACHE_DIR, IMAGE_CACHE_DIR } from '../cache'
import {
  type HttpClient,
  type CacheManager,
  type PricingBackend,
  type FileSystemClient,
  createDefaultFileSystemClient,
} from '../interfaces'
import type { PriceCurrency } from '../price-currency'
import { getPriceField } from '../price-currency'
import { getLogger } from '../logger'
import { throwHttpError } from '../errors'
import path from 'node:path'
import prompts from 'prompts'
import {
  type CardNameFilter,
  isDigitalOnlySet,
  isArenaOnly,
  isToken,
  getFrontFaceName,
  mapScryfallCard,
} from './card-utils'

const RATE_LIMIT_MS = 100
const SCRYFALL_CARDS_PER_PAGE = 175

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

export type SearchPageResult = {
  data: ScryfallList<ScryfallCard> | null
  raw: string
  hasMore: boolean
}

/**
 * Compute representative and cheapest prints from cached card data.
 * @param recentPrintings - Printings sorted by release date descending, used to pick the representative.
 * @param allPrintings - All printings for the card, used to find the cheapest.
 */
export function computeRepresentativePrints(
  recentPrintings: ScryfallCard[],
  allPrintings: ScryfallCard[],
  currencies: PriceCurrency[],
): RepresentativePrintsResult {
  type Candidate = { card: ScryfallCard; price: number }
  const result: RepresentativePrintsResult = {}

  for (const currency of currencies) {
    const priceField = getPriceField(currency)

    const candidates: Candidate[] = []
    for (const card of recentPrintings) {
      if (candidates.length >= 5) break
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

  private async checkAndPromptPreload() {
    if (this.hasPrompted) return
    this.hasPrompted = true

    if (this.cardCache.isEmpty && (await this.cardCache.isEmpty())) {
      const response = await prompts({
        type: 'confirm',
        name: 'value',
        message:
          'MTG CLI runs faster and hits rate limits less often if data is cached up front. Would you like to pre-cache Scryfall data for all English MTG cards?',
        initial: true,
      })

      if (response.value) {
        await this.preloadCache()
      }
    }
  }

  async fetchSymbology(forceRefresh = false): Promise<ScryfallSymbol[]> {
    const cachePath = path.join(CACHE_DIR, 'symbology.json')

    if (!forceRefresh) {
      try {
        const cached = await this.fileSystem.readFile(cachePath, 'utf-8')
        const data = JSON.parse(cached)
        if (data && Array.isArray(data)) return data
      } catch (e) {
        // ignore
      }
    }

    getLogger().info('Fetching symbology from Scryfall...')
    const response = await this.http.fetch('https://api.scryfall.com/symbology')
    if (!response.ok) throwHttpError(response, 'Failed to fetch symbology')

    const json = (await response.json()) as ScryfallList<ScryfallSymbol>
    const data = json.data

    await this.fileSystem.mkdir(CACHE_DIR, { recursive: true })
    await this.fileSystem.writeFile(cachePath, JSON.stringify(data, null, 2))
    return data
  }

  async downloadSymbol(symbol: ScryfallSymbol, destDir: string): Promise<string> {
    // Convert symbol to safe filename (e.g. {W} -> W.svg)
    const safeName = symbol.symbol.replace(/[{}]/g, '').replace(/\//g, '')
    const filename = `${safeName}.svg`
    const cachePath = path.join(IMAGE_CACHE_DIR, `symbol_${filename}`)
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

    const response = await this.http.fetch(symbol.svg_uri)
    if (!response.ok) throw new Error(`Failed to download symbol ${symbol.symbol}`)

    const buffer = await response.arrayBuffer()
    await this.fileSystem.mkdir(IMAGE_CACHE_DIR, { recursive: true })
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
      const filtered = cached.filter((c) => !isToken(c))
      if (filtered.length !== cached.length) {
        // Evict tokens found in existing cache entry
        this.cardCache.set(name, filtered).catch(() => {})
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

  async fetchCardData(name: string, options?: { silent?: boolean }): Promise<ScryfallCard | null> {
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
      const response = await this.http.fetch(url)

      if (response.ok) {
        const json = (await response.json()) as ScryfallCard
        const card = mapScryfallCard(json)

        if (isArenaOnly(card)) {
          getLogger().warn(`Card '${name}' is arena-only, skipping.`)
          await Bun.sleep(RATE_LIMIT_MS)
          return null
        }

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

  async fetchNamedCard(
    name: string,
    options?: { fuzzy?: boolean; set?: string },
  ): Promise<ScryfallCard | null> {
    const mode = options?.fuzzy ? 'fuzzy' : 'exact'
    const params = new URLSearchParams({ [mode]: name })
    if (options?.set) {
      params.set('set', options.set)
    }

    const url = `https://api.scryfall.com/cards/named?${params.toString()}`

    try {
      const response = await this.http.fetch(url)

      if (response.ok) {
        const json = (await response.json()) as ScryfallCard
        await Bun.sleep(RATE_LIMIT_MS)
        return json
      } else {
        const errorBody = await response.json().catch(() => null)
        const details =
          errorBody && typeof errorBody === 'object' && 'details' in errorBody
            ? (errorBody as { details: string }).details
            : `${response.status} ${response.statusText}`
        getLogger().error(`Card not found: ${details}`)
      }
    } catch (e) {
      getLogger().error(`Error fetching card '${name}':`, e)
    }

    await Bun.sleep(RATE_LIMIT_MS)
    return null
  }

  async fetchRandomCard(filter?: string): Promise<ScryfallCard | null> {
    const params = new URLSearchParams()
    if (filter) {
      params.set('q', filter)
    }

    const qs = params.toString()
    const url = `https://api.scryfall.com/cards/random${qs ? `?${qs}` : ''}`

    try {
      const response = await this.http.fetch(url)

      if (response.ok) {
        const json = (await response.json()) as ScryfallCard
        await Bun.sleep(RATE_LIMIT_MS)
        return json
      } else {
        const errorBody = await response.json().catch(() => null)
        const details =
          errorBody && typeof errorBody === 'object' && 'details' in errorBody
            ? (errorBody as { details: string }).details
            : `${response.status} ${response.statusText}`
        getLogger().error(`No cards found: ${details}`)
      }
    } catch (e) {
      getLogger().error('Error fetching random card:', e)
    }

    await Bun.sleep(RATE_LIMIT_MS)
    return null
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

      const response = await this.http.fetch('https://api.scryfall.com/cards/collection', {
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
        const nonTokens = allCards.filter((c) => !isArenaOnly(c) && !isToken(c))
        const mapped = nonTokens.map((c) => mapScryfallCard(c))
        if (mapped.length > 0) {
          this.cardCache.set(name, mapped).catch((e) => {
            getLogger().warn(`Failed to cache printings for '${name}':`, e)
          })
        }
        const nonTokenFirstPage = firstPageCards.filter((c) => !isToken(c))
        resolve(computeRepresentativePrints(nonTokenFirstPage, nonTokens, currencies))
      }

      const processPage =
        (url: string): (() => Promise<void>) =>
        async () => {
          try {
            const response = await this.http.fetch(url)
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
      const response = await this.http.fetch(url)
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

  async searchCards(query: string): Promise<ScryfallCard[]> {
    await this.checkAndPromptPreload()
    getLogger().info(`Searching for: ${query}`)
    try {
      // Use order=edhrec to prioritize popular cards
      let nextUrl: string | undefined =
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`
      const allCards: ScryfallCard[] = []

      while (nextUrl) {
        const response: Response = await this.http.fetch(nextUrl)

        if (response.ok) {
          const json = (await response.json()) as ScryfallList<ScryfallCard>
          const data = json.data || []

          for (const item of data) {
            if (isArenaOnly(item)) continue

            const card = mapScryfallCard(item)

            const existing = await this.cardCache.get(card.name)
            if (!existing) {
              await this.cardCache.set(card.name, [card])
            }

            allCards.push(card)
          }

          if (json.has_more && json.next_page) {
            nextUrl = json.next_page
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

    const response = await this.http.fetch(url)

    if (!response.ok) {
      if (response.status === 404) {
        return { data: null, raw: '', hasMore: false }
      }
      throwHttpError(response, 'Scryfall API error')
    }

    if (format === 'csv') {
      const text = await response.text()
      const lineCount = text.trim().split('\n').length
      const hasMore = lineCount >= SCRYFALL_CARDS_PER_PAGE + 1

      return { data: null, raw: text, hasMore }
    } else {
      const json = (await response.json()) as ScryfallList<ScryfallCard>
      const hasMore = json.has_more || false
      return { data: json, raw: JSON.stringify(json, null, 2), hasMore }
    }
  }

  async downloadImage(url: string, destPath: string): Promise<boolean> {
    try {
      // Determine cache path from destPath which includes ID
      const filename = path.basename(destPath)
      const cachedPath = path.join(IMAGE_CACHE_DIR, filename)

      try {
        await this.fileSystem.access(cachedPath)
        await this.fileSystem.mkdir(path.dirname(destPath), { recursive: true })
        await this.fileSystem.copyFile(cachedPath, destPath)
        return true
      } catch {
        // File does not exist in cache yet.
      }

      // Download if not in cache
      await this.fileSystem.mkdir(IMAGE_CACHE_DIR, { recursive: true })

      const response = await this.http.fetch(url)
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

  async preloadCache(): Promise<void> {
    getLogger().info('Fetching bulk data metadata from Scryfall...')

    try {
      const metaResponse = await this.http.fetch('https://api.scryfall.com/bulk-data')
      if (!metaResponse.ok) {
        throwHttpError(metaResponse, 'Failed to fetch bulk metadata')
      }
      const metaJson = (await metaResponse.json()) as ScryfallList<{
        type: string
        download_uri: string
        size: number
      }>
      const defaultData = metaJson.data?.find((d) => d.type === 'default_cards')

      if (!defaultData?.download_uri) {
        throw new Error('Could not find default_cards bulk data URI')
      }

      const BULK_URL = defaultData.download_uri as string
      const totalBytes = defaultData.size
      getLogger().info(`Bulk URL: ${BULK_URL}`)
      getLogger().info(`Download size: ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`)

      const response = await this.http.fetch(BULK_URL)
      if (!response.ok) throwHttpError(response, 'Failed to fetch bulk data')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('Failed to get response reader')

      let receivedLength = 0
      const chunks: Uint8Array[] = []
      let lastUpdate = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        chunks.push(value)
        receivedLength += value.length

        // Progress update max every 100ms to avoid spamming stdout
        const now = Date.now()
        if (now - lastUpdate > 100 || receivedLength === totalBytes) {
          lastUpdate = now
          const percentage = Math.round((receivedLength / totalBytes) * 100)
          const receivedMiB = (receivedLength / 1024 / 1024).toFixed(2)
          const totalMiB = (totalBytes / 1024 / 1024).toFixed(2)
          getLogger().progress(`\rDownloading: ${percentage}% (${receivedMiB}/${totalMiB} MiB)`)
        }
      }
      getLogger().progress('\n')

      getLogger().info('Parsing JSON...')
      const chunksAll = new Uint8Array(receivedLength)
      let position = 0
      for (const chunk of chunks) {
        chunksAll.set(chunk, position)
        position += chunk.length
      }

      const text = new TextDecoder().decode(chunksAll)
      const json = JSON.parse(text)

      if (!Array.isArray(json)) {
        throw new Error('Invalid JSON format: expected array')
      }

      getLogger().info(`Processing ${json.length} cards...`)

      const entries: Record<string, ScryfallCard[]> = {}
      let filteredCount = 0
      for (const item of json) {
        // Filter out arena-only and token printings
        if (isArenaOnly(item) || isToken(item)) {
          filteredCount++
          continue
        }

        const card = mapScryfallCard(item)
        const newEntries = [...(entries[card.name] ?? []), card]
        entries[card.name] = newEntries
      }

      if (filteredCount > 0) {
        getLogger().info(`Filtered out ${filteredCount} arena-only or token printings.`)
      }

      getLogger().info('Saving to cache...')
      if (this.cardCache.bulkSet) {
        await this.cardCache.bulkSet(entries)
      } else {
        for (const [name, cards] of Object.entries(entries)) {
          await this.cardCache.set(name, cards)
        }
      }

      getLogger().info('Done! Card cache populated.')
    } catch (e) {
      getLogger().error('\nFailed to preload all cards:', e)
    }
  }
}
