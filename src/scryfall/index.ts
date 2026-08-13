export {
  type CardNameFilter,
  isDigitalOnlySet,
  isArenaOnly,
  isArtSeries,
  isToken,
  getCardGames,
  getFrontFaceName,
  mapScryfallCard,
  compareCollectorNumbers,
  comparePrintings,
} from './card-utils'

export {
  ScryfallClient,
  classifyFetchCard,
  computeRepresentativePrints,
  SEARCH_ALL_PAGES_MAX,
  type FetchSymbologyOptions,
  type GetCardPrintingsOptions,
  type FetchCardOutcome,
  type ScryfallSymbol,
  type CurrencyPrint,
  type RepresentativePrintsResult,
  type ScryfallFetchError,
  type FetchCardResult,
  type SearchPage,
  type SearchPageFailure,
  type SearchPageResult,
  type SearchAllPagesSuccess,
  type SearchAllPagesResult,
} from './client'

import type { ScryfallCard } from '../types'
import { cardCache } from '../cache/instances'
import { defaultHttpClient } from '../http'
import { ScryfallClient, type BulkCacheFiles } from './client'
import type { CardPrintingsResult } from '../card-printing'
import type {
  ScryfallSymbol,
  RepresentativePrintsResult,
  FetchCardDataOptions,
  FetchSymbologyOptions,
  GetCardPrintingsOptions,
  FetchNamedCardOptions,
  FetchCardResult,
  SearchPageResult,
  SearchAllPagesResult,
} from './client'
import { comparePrintings, type CardNameFilter } from './card-utils'
import type { CardLanguage } from '../card-language'
import type { PriceCurrency } from '../price-currency'
import type { TagIndex } from './tags'

export { attachTags, type TagIndex } from './tags'
export type {
  CacheRefreshEvent,
  CacheRefreshProgressHandler,
  PreloadCacheOptions,
} from './progress'
import type { PreloadCacheOptions } from './progress'

export type MinMaxPrice = { min: number; max: number }

export const scryfallClient = new ScryfallClient(defaultHttpClient, cardCache)

// Helper wrappers for backward compatibility
export function fetchSymbology(options?: FetchSymbologyOptions): Promise<ScryfallSymbol[]> {
  return scryfallClient.fetchSymbology(options)
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

/**
 * Project raw Scryfall search items to real printings and warm the local cache
 * with the names it does not already hold. Exposed so a handler that fetches its
 * own page (`GET /api/card-search?warm=true`) can warm the cache without also
 * walking every result page.
 */
export function cacheRealPrintings(items: readonly ScryfallCard[]): Promise<ScryfallCard[]> {
  return scryfallClient.cacheRealPrintings(items)
}

/**
 * Walk every page of a Scryfall search, caching results and reporting HTTP
 * failures as data, for callers that must distinguish "matched nothing" from
 * "the search failed".
 */
export function searchAllPages(query: string): Promise<SearchAllPagesResult> {
  return scryfallClient.searchAllPages(query)
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

export function preloadCacheFromFiles(files: BulkCacheFiles): Promise<void> {
  return scryfallClient.preloadCacheFromFiles(files)
}

export function preloadCache(options?: PreloadCacheOptions): Promise<void> {
  return scryfallClient.preloadCache(options)
}

export function refreshTags(prefetched?: TagIndex | null): Promise<void> {
  return scryfallClient.refreshTags(prefetched)
}

export function downloadTagIndex(): Promise<TagIndex | null> {
  return scryfallClient.downloadTagIndex()
}

export async function getCardPrintings(
  name: string,
  options?: GetCardPrintingsOptions,
): Promise<ScryfallCard[]> {
  const cards = await scryfallClient.getCardPrintings(name, options)
  return cards.sort(comparePrintings)
}

/**
 * {@link getCardPrintings} with {@link PrintingsSource} provenance, so a caller
 * can tell the cache's complete printing list apart from the single arbitrary
 * printing a cache-miss `/cards/named` fallback returns.
 */
export async function getCardPrintingsResult(
  name: string,
  options?: GetCardPrintingsOptions,
): Promise<CardPrintingsResult> {
  const result = await scryfallClient.getCardPrintingsResult(name, options)
  return { ...result, printings: result.printings.sort(comparePrintings) }
}

/**
 * A cache-only printings lookup: a name the cache does not hold resolves to no
 * printings instead of a live Scryfall fetch. The shape commands pass wherever
 * a run promised not to touch the network (`--refresh never`, sync resolution).
 */
export function getCachedCardPrintings(name: string): Promise<ScryfallCard[]> {
  return getCardPrintings(name, { network: false })
}

/**
 * Fetch one printing by set code and collector number, caching it. A non-`en`
 * `language` fetches that language's object (`/cards/{set}/{cn}/{lang}`).
 */
export function fetchPrintingByCollectorNumber(
  set: string,
  collectorNumber: string,
  language?: CardLanguage,
): Promise<ScryfallCard | null> {
  return scryfallClient.fetchPrintingByCollectorNumber(set, collectorNumber, language)
}

export function fetchNamedCard(
  name: string,
  options?: FetchNamedCardOptions,
): Promise<FetchCardResult> {
  return scryfallClient.fetchNamedCard(name, options)
}

export function fetchRandomCard(filter?: string): Promise<FetchCardResult> {
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

/**
 * Every printing the local cache holds, one card per `set:collectorNumber`
 * pair. Backs the session editor's collector-number mode, whose search spans
 * the whole cache rather than a preloaded set.
 */
export function getAllPrintings(filter?: CardNameFilter): Promise<ScryfallCard[]> {
  return scryfallClient.getAllPrintings(filter)
}
