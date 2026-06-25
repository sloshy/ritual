export {
  type CardNameFilter,
  isDigitalOnlySet,
  isArenaOnly,
  isToken,
  getCardGames,
  getFrontFaceName,
  mapScryfallCard,
  comparePrintings,
} from './card-utils'

export {
  ScryfallClient,
  computeRepresentativePrints,
  type ScryfallSymbol,
  type CurrencyPrint,
  type RepresentativePrintsResult,
} from './client'

import type { ScryfallCard, ScryfallList } from '../types'
import { cardCache } from '../cache'
import { defaultHttpClient } from '../http'
import { ScryfallClient } from './client'
import type {
  ScryfallSymbol,
  RepresentativePrintsResult,
  FetchCardDataOptions,
  FetchNamedCardOptions,
} from './client'
import { comparePrintings, type CardNameFilter } from './card-utils'
import type { PriceCurrency } from '../price-currency'
import type { TagIndex } from './tags'

export { attachTags, type TagIndex } from './tags'

export type SearchPageResult = {
  data: ScryfallList<ScryfallCard> | null
  raw: string
  hasMore: boolean
}

export type MinMaxPrice = { min: number; max: number }

export const scryfallClient = new ScryfallClient(defaultHttpClient, cardCache)

// Helper wrappers for backward compatibility
export function fetchSymbology(forceRefresh = false): Promise<ScryfallSymbol[]> {
  return scryfallClient.fetchSymbology(forceRefresh)
}

export function downloadSymbol(symbol: ScryfallSymbol, destDir: string): Promise<string> {
  return scryfallClient.downloadSymbol(symbol, destDir)
}

export function fetchCardData(
  name: string,
  options?: FetchCardDataOptions,
): Promise<ScryfallCard | null> {
  return scryfallClient.fetchCardData(name, options)
}

export function searchCards(query: string): Promise<ScryfallCard[]> {
  return scryfallClient.searchCards(query)
}

export function fetchSearchPage(
  query: string,
  page: number,
  format: 'json' | 'csv',
): Promise<SearchPageResult> {
  return scryfallClient.fetchSearchPage(query, page, format)
}

export function getAllCardNames(filter?: CardNameFilter): Promise<string[]> {
  return scryfallClient.getAllCardNames(filter)
}

export function downloadImage(url: string, destPath: string): Promise<boolean> {
  return scryfallClient.downloadImage(url, destPath)
}

export function preloadCache(): Promise<void> {
  return scryfallClient.preloadCache()
}

export function refreshTags(prefetched?: TagIndex | null): Promise<void> {
  return scryfallClient.refreshTags(prefetched)
}

export function downloadTagIndex(): Promise<TagIndex | null> {
  return scryfallClient.downloadTagIndex()
}

export async function getCardPrintings(name: string): Promise<ScryfallCard[]> {
  const cards = await scryfallClient.getCardPrintings(name)
  return cards.sort(comparePrintings)
}

export function fetchNamedCard(
  name: string,
  options?: FetchNamedCardOptions,
): Promise<ScryfallCard | null> {
  return scryfallClient.fetchNamedCard(name, options)
}

export function fetchRandomCard(filter?: string): Promise<ScryfallCard | null> {
  return scryfallClient.fetchRandomCard(filter)
}

export function fetchLatestPrices(names: string[]): Promise<Map<string, number>> {
  return scryfallClient.fetchLatestPrices(names)
}

export function fetchMinMaxPrice(name: string): Promise<MinMaxPrice> {
  return scryfallClient.fetchMinMaxPrice(name)
}

export function fetchRepresentativePrints(
  name: string,
  currencies: PriceCurrency[],
): Promise<RepresentativePrintsResult> {
  return scryfallClient.fetchRepresentativePrints(name, currencies)
}

export function getCardsBySet(setCode: string): Promise<Map<string, ScryfallCard>> {
  return scryfallClient.getCardsBySet(setCode)
}
