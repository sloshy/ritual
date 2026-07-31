export {
  type CardNameFilter,
  isDigitalOnlySet,
  isArenaOnly,
  isArtSeries,
  isToken,
  getCardGames,
  getFrontFaceName,
  mapScryfallCard,
  comparePrintings,
} from './card-utils'

export {
  ScryfallClient,
  classifyFetchCard,
  computeRepresentativePrints,
  ALL_PAGES,
  DEFAULT_SEARCH_MAX_PAGES,
  type SearchCardsOptions,
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
  SearchCardsOptions,
  SearchPageResult,
} from './client'
import { comparePrintings, type CardNameFilter } from './card-utils'
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

export function searchCards(query: string, options?: SearchCardsOptions): Promise<ScryfallCard[]> {
  return scryfallClient.searchCards(query, options)
}

/**
 * Project raw Scryfall search items to real printings and warm the local cache
 * with the names it does not already hold. Exposed so a handler that fetches its
 * own page (`GET /api/card-search?warm=true`) can warm the cache exactly as
 * {@link searchCards} does without inheriting its error-swallowing.
 */
export function cacheRealPrintings(items: readonly ScryfallCard[]): Promise<ScryfallCard[]> {
  return scryfallClient.cacheRealPrintings(items)
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

/** Fetch one printing by set code and collector number, caching it. */
export function fetchPrintingByCollectorNumber(
  set: string,
  collectorNumber: string,
): Promise<ScryfallCard | null> {
  return scryfallClient.fetchPrintingByCollectorNumber(set, collectorNumber)
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

export function getCardsBySet(setCode: string): Promise<Map<string, ScryfallCard>> {
  return scryfallClient.getCardsBySet(setCode)
}
