import { type ScryfallCard, type ScryfallList } from './types'
import { cardCache, CACHE_DIR, IMAGE_CACHE_DIR } from './cache'
import {
  type HttpClient,
  type CacheManager,
  type PricingBackend,
  type FileSystemClient,
} from './interfaces'
import { getLogger } from './logger'
import path from 'path'
import * as fs from 'node:fs/promises'
import prompts from 'prompts'

const RATE_LIMIT_MS = 100

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type CardNameFilter = {
  sets?: string[]
  excludeDigitalOnly?: boolean
}

export function isDigitalOnlySet(setCode: string): boolean {
  const lower = setCode.toLowerCase()
  return (lower.length === 4 && lower.startsWith('a')) || lower === 'om1'
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
  constructor(
    private http: HttpClient,
    private cardCache: CacheManager<ScryfallCard[]>,
    private fileSystem: FileSystemClient = defaultFileSystemClient,
  ) {}

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
    if (!response.ok) throw new Error(`Failed to fetch symbology: ${response.status}`)

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
    await sleep(50)

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
    if (cached) return cached
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
      // Return the first one as default
      return cached[0] || null
    }

    if (!options?.silent) {
      getLogger().info(`Fetching: ${name}`)
    }
    try {
      // Use exact name match to avoid ambiguity
      const queryName = name.includes(' // ') ? name.split(' // ')[0] : name
      if (!queryName) return null
      const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(queryName)}`
      const response = await this.http.fetch(url)

      if (response.ok) {
        const json = (await response.json()) as ScryfallCard
        const card: ScryfallCard = {
          id: json.id,
          name: json.name,
          cmc: json.cmc || 0,
          edhrec_rank: json.edhrec_rank || 999999,
          mana_cost: json.mana_cost,
          type_line: json.type_line,
          oracle_text: json.oracle_text,
          image_uris: json.image_uris,
          card_faces: json.card_faces,
          prices: json.prices,
          finishes: json.finishes,
          set: json.set,
          set_name: json.set_name,
          collector_number: json.collector_number,
          rarity: json.rarity,
        }

        await this.cardCache.set(name, [card]) // wrap in array
        await sleep(RATE_LIMIT_MS)
        return card
      } else {
        getLogger().warn(
          `Failed to fetch card '${name}': ${response.status} ${response.statusText}`,
        )
      }
    } catch (e) {
      getLogger().error(`Error fetching card '${name}':`, e)
    }

    await sleep(RATE_LIMIT_MS)
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
        await sleep(RATE_LIMIT_MS)
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

    await sleep(RATE_LIMIT_MS)
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
        await sleep(RATE_LIMIT_MS)
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

    await sleep(RATE_LIMIT_MS)
    return null
  }

  async fetchLatestPrices(names: string[]): Promise<Map<string, number>> {
    const results = new Map<string, number>()
    const batchSize = 75

    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize)
      const identifiers = batch.map((name) => ({
        // Ff name contains '//' only search the front face name
        name: name.includes(' // ') ? name.split(' // ')[0]!.trim() : name.trim(),
      }))

      const response = await this.http.fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers }),
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch batch prices: ${response.status} ${response.statusText}`)
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
        const usd = card?.prices?.usd
        if (!requestedName || !usd) continue

        const latestPrice = Number.parseFloat(usd)
        if (Number.isFinite(latestPrice)) {
          results.set(requestedName, latestPrice)
        }
      }

      await sleep(50)
    }

    return results
  }

  async fetchMinMaxPrice(name: string): Promise<{ min: number; max: number }> {
    const encodedName = encodeURIComponent(`!"${name}"`)
    const url = `https://api.scryfall.com/cards/search?q=${encodedName}+unique%3Aprints&order=usd&dir=asc`

    try {
      const response = await this.http.fetch(url)
      if (response.ok) {
        const json = (await response.json()) as ScryfallList<ScryfallCard>
        const data = json.data
        if (data && data.length > 0) {
          const prices = data
            .map((card) => card.prices?.usd)
            .filter((price) => price !== null && price !== undefined)
            .map((price: string) => parseFloat(price))

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
            const card: ScryfallCard = {
              id: item.id,
              name: item.name,
              cmc: item.cmc || 0,
              edhrec_rank: item.edhrec_rank || 999999,
              mana_cost: item.mana_cost,
              type_line: item.type_line,
              oracle_text: item.oracle_text,
              image_uris: item.image_uris,
              card_faces: item.card_faces,
              prices: item.prices,
              finishes: item.finishes,
              set: item.set,
              set_name: item.set_name,
              collector_number: item.collector_number,
              rarity: item.rarity,
            }

            const existing = await this.cardCache.get(card.name)
            if (!existing) {
              await this.cardCache.set(card.name, [card])
            }

            allCards.push(card)
          }

          if (json.has_more && json.next_page) {
            nextUrl = json.next_page
            await sleep(RATE_LIMIT_MS)
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
  ): Promise<{ data: ScryfallList<ScryfallCard> | null; raw: string; hasMore: boolean }> {
    const formatParam = format === 'csv' ? '&format=csv' : '' // json is default
    const pageParam = `&page=${page}`
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec${formatParam}${pageParam}`

    const response = await this.http.fetch(url)

    if (!response.ok) {
      if (response.status === 404) {
        return { data: null, raw: '', hasMore: false }
      }
      throw new Error(`Scryfall API returned ${response.status}: ${response.statusText}`)
    }

    if (format === 'csv') {
      const text = await response.text()
      const lineCount = text.trim().split('\n').length
      const hasMore = lineCount >= 176

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
        throw new Error(`Failed to fetch bulk metadata: ${metaResponse.status}`)
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
      if (!response.ok) throw new Error(`Failed to fetch bulk data: ${response.status}`)

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

      getLogger().info(`Processing ${json.length} cards...`)

      const entries: Record<string, ScryfallCard[]> = {}
      for (const item of json) {
        const card: ScryfallCard = {
          id: item.id,
          name: item.name,
          cmc: item.cmc || 0,
          edhrec_rank: item.edhrec_rank || 999999,
          mana_cost: item.mana_cost,
          type_line: item.type_line,
          oracle_text: item.oracle_text,
          image_uris: item.image_uris,
          card_faces: item.card_faces,
          prices: item.prices,
          finishes: item.finishes,
          set: item.set,
          set_name: item.set_name,
          collector_number: item.collector_number,
          rarity: item.rarity,
        }
        const newEntries = [...(entries[card.name] ?? []), card]
        entries[card.name] = newEntries
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

// Default instance with system defaults
const defaultHttpClient: HttpClient = {
  fetch: (url, init) => global.fetch(url, init),
}

const defaultFileSystemClient: FileSystemClient = {
  readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
  writeFile: async (filePath, data) => {
    await fs.writeFile(filePath, data)
  },
  access: (filePath) => fs.access(filePath),
  copyFile: (source, destination) => fs.copyFile(source, destination),
  mkdir: (dirPath, options) => fs.mkdir(dirPath, options).then(() => {}),
}

export const scryfallClient = new ScryfallClient(
  defaultHttpClient,
  cardCache,
  defaultFileSystemClient,
)

// Helper wrappers for backward compatibility
export function fetchSymbology(forceRefresh = false) {
  return scryfallClient.fetchSymbology(forceRefresh)
}

export function downloadSymbol(symbol: ScryfallSymbol, destDir: string) {
  return scryfallClient.downloadSymbol(symbol, destDir)
}

export function fetchCardData(name: string, options?: { silent?: boolean }) {
  return scryfallClient.fetchCardData(name, options)
}

export function searchCards(query: string) {
  return scryfallClient.searchCards(query)
}

export function fetchSearchPage(query: string, page: number, format: 'json' | 'csv') {
  return scryfallClient.fetchSearchPage(query, page, format)
}

export function getAllCardNames(filter?: CardNameFilter) {
  return scryfallClient.getAllCardNames(filter)
}

export function downloadImage(url: string, destPath: string) {
  return scryfallClient.downloadImage(url, destPath)
}

export function preloadCache() {
  return scryfallClient.preloadCache()
}

export function getCardPrintings(name: string) {
  return scryfallClient.getCardPrintings(name)
}

export function fetchNamedCard(name: string, options?: { fuzzy?: boolean; set?: string }) {
  return scryfallClient.fetchNamedCard(name, options)
}

export function fetchRandomCard(filter?: string) {
  return scryfallClient.fetchRandomCard(filter)
}

export function fetchLatestPrices(names: string[]) {
  return scryfallClient.fetchLatestPrices(names)
}

export function fetchMinMaxPrice(name: string) {
  return scryfallClient.fetchMinMaxPrice(name)
}

export function getCardsBySet(setCode: string) {
  return scryfallClient.getCardsBySet(setCode)
}
