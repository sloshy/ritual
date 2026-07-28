/**
 * The pricing engine behind the unified `price` command: flattens every deck,
 * collection, and wanted list into priced card entries and aggregates them into
 * per-list, per-type, and grand totals.
 *
 * Pricing rules per entry:
 *
 * - An entry pinned to a specific printing (set + collector number) is priced at
 *   that exact printing, at its own finish when given, otherwise the printing's
 *   default finish (nonfoil when available).
 * - An unpinned entry is priced at a representative recent printing (the same
 *   median-of-recent-printings pick the public site uses).
 * - Every entry also carries a "lowest" unit price — what the card would cost at
 *   its cheapest printing+finish. For collection entries (a specific owned copy)
 *   and fully-specified wanted entries the lowest price is the entry price
 *   itself; for a wanted entry pinned to a printing without a finish it is that
 *   printing's cheapest finish; for deck and name-only wanted entries it is the
 *   cheapest printing overall.
 *
 * An entry whose price resolves to 0 is "unpriced"; unpriced counts are
 * quantity-weighted, matching the public site's missing-price counts.
 */

import * as fs from 'node:fs/promises'
import { findPrinting, hasSpecificPrinting } from './card-printing'
import { parseCollectionFile, resolveFinish } from './collection-file'
import { isExtraSection } from './deck-format'
import { importFromTextFile } from './importers/text-file'
import { LIST_TYPES, type ListType } from './list-type'
import {
  findCheapestPrinting,
  getCardPrice,
  getCardPriceForFinish,
  isCurrencyAvailableForCard,
  isFinishPricelessInCurrency,
  type PriceCurrency,
} from './price-currency'
import { listLocations, type ListLocation } from './resolve-list'
import { comparePrintings, computeRepresentativePrints, getCardGames } from './scryfall'
import { parseWantedListFile } from './commands/wanted-helpers'
import { matchesAllTerms } from './term-match'
import type { DeckData, Finish, ScryfallCard } from './types'

/** When a card has no EDHREC rank, it sorts after every ranked card. */
export const UNRANKED_EDHREC = 999999

/** A card line from any list, flattened to the fields pricing needs. */
export type PriceListEntry = {
  name: string
  quantity: number
  /** Pinned set code (lowercase), when the entry names a specific printing. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  section: string
}

/** One list's entries, ready for pricing. */
export type PriceListInput = {
  type: ListType
  name: string
  entries: PriceListEntry[]
}

/** Lists loaded from disk plus any parser warnings, keyed by list name. */
export type LoadedPriceInputs = {
  inputs: PriceListInput[]
  warnings: string[]
}

export type UnpricedReason =
  | 'no-printings'
  | 'printing-not-found'
  | 'currency-unavailable'
  | 'finish-unpriced-in-currency'
  | 'no-price-data'

/** A single priced card line in the report. */
export type PricedEntry = {
  listType: ListType
  listName: string
  section: string
  name: string
  quantity: number
  /** Set code of the printing shown/priced (lowercase); the entry's own pin, else the resolved printing. */
  set?: string
  collectorNumber?: string
  /** Finish the unit price was read at (exact-printing entries only). */
  finish?: Finish
  /** Whether set/collectorNumber came from the list entry itself. */
  pinned: boolean
  /** Unit price in the report currency; 0 when unpriced. */
  price: number
  /** Cheapest acceptable unit price (see module docs); 0 when unavailable. */
  lowest: number
  /** Printing+finish behind `lowest`, when it differs from the priced printing. */
  lowestSet?: string
  lowestCollectorNumber?: string
  /** Raw Scryfall finish string — unlike `finish`, never validated against `Finish`. */
  lowestFinish?: string
  unpricedReason?: UnpricedReason
  cmc: number
  edhrecRank: number
  typeLine: string
  fileOrder: number
}

/** Aggregate totals over a set of priced entries. */
export type PriceTotals = {
  /** Sum of quantities. */
  cardCount: number
  /** Sum of unit price × quantity. */
  total: number
  /** Sum of lowest unit price × quantity. */
  lowestTotal: number
  /** Quantity-weighted count of unpriced entries. */
  unpricedCount: number
}

export type ListPriceSummary = PriceTotals & {
  type: ListType
  name: string
}

export type ListTypeTotals = PriceTotals & {
  type: ListType
  listCount: number
}

export type PriceReportTotals = PriceTotals & {
  listCount: number
}

export type PriceReport = {
  currency: PriceCurrency
  lists: ListPriceSummary[]
  entries: PricedEntry[]
  /** Totals per list type, in canonical type order; types with no lists are omitted. */
  typeTotals: ListTypeTotals[]
  totals: PriceReportTotals
}

/** Resolves a card name to all of its printings (cache-backed in production). */
export type PrintingsLookup = (name: string) => Promise<ScryfallCard[]>

export type BuildPriceReportOptions = {
  currency: PriceCurrency
  lookup: PrintingsLookup
  /** `set:collectorNumber` keys excluded from representative-printing selection. */
  bannedPrintings?: ReadonlySet<string>
}

/** A built report plus the printings fetched to build it (for detail views). */
export type BuiltPriceReport = {
  report: PriceReport
  printingsByName: Map<string, ScryfallCard[]>
}

/**
 * The JSON contract of the all-lists summary view, shared by the CLI's
 * `--output json` mode and the admin price API.
 */
export type PriceSummaryPayload = {
  currency: PriceCurrency
  lastRefreshedAt: number | null
  lists: ListPriceSummary[]
  typeTotals: ListTypeTotals[]
  totals: PriceReportTotals
}

/**
 * The JSON contract of the single-list view, shared by the CLI's
 * `--output json` mode and the admin price API.
 */
export type PriceListDetailPayload = {
  currency: PriceCurrency
  list: ListPriceSummary | undefined
  cards: PricedEntry[]
}

/** The JSON contract of the CLI's card-search view (`--output json`). */
export type PriceCardSearchPayload = {
  currency: PriceCurrency
  filters: PriceEntryFilters
  cards: PricedEntry[]
  totals: PriceTotals
}

/**
 * Load every list of the given type (or all types) into pricing inputs. Deck
 * sections classified as extras (maybeboard/token) are excluded, matching the
 * public site's deck totals; sideboards are included.
 */
/**
 * Flatten a deck's sections into pricing entries, excluding extras
 * (maybeboard/token sections) to match the public site's deck totals;
 * sideboards are included.
 */
export function deckPriceEntries(deck: Pick<DeckData, 'sections'>): PriceListEntry[] {
  const entries: PriceListEntry[] = []
  for (const section of deck.sections) {
    if (isExtraSection(section.name)) continue
    for (const card of section.cards) {
      entries.push({
        name: card.name,
        quantity: card.quantity,
        set: card.set?.toLowerCase(),
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        section: section.name,
      })
    }
  }
  return entries
}

export async function loadPriceListInputs(
  type?: ListType,
  locations?: ListLocation[],
): Promise<LoadedPriceInputs> {
  const resolvedLocations = locations ?? (await listLocations(type))
  const inputs: PriceListInput[] = []
  const warnings: string[] = []

  for (const location of resolvedLocations) {
    if (location.type === 'deck') {
      const deck = await importFromTextFile(location.filePath)
      inputs.push({ type: 'deck', name: location.name, entries: deckPriceEntries(deck) })
      continue
    }

    const content = await fs.readFile(location.filePath, 'utf-8')
    const parsed =
      location.type === 'collection' ? parseCollectionFile(content) : parseWantedListFile(content)
    warnings.push(...parsed.warnings.map((w) => `${location.name}: ${w}`))
    inputs.push({
      type: location.type,
      name: location.name,
      entries: parsed.entries.map(
        (entry): PriceListEntry => ({
          name: entry.name,
          quantity: entry.quantity,
          set: entry.set?.toLowerCase(),
          collectorNumber: entry.collectorNumber,
          finish: entry.finish,
          section: entry.section,
        }),
      ),
    })
  }

  return { inputs, warnings }
}

type NamePricing = {
  printings: ScryfallCard[]
  games: string[]
  representative: ScryfallCard | null
  cheapest: ReturnType<typeof findCheapestPrinting>
}

async function resolveNamePricing(
  name: string,
  options: BuildPriceReportOptions,
  cache: Map<string, NamePricing>,
): Promise<NamePricing> {
  const cached = cache.get(name)
  if (cached) return cached

  const printings = await options.lookup(name)
  const newestFirst = [...printings].sort(comparePrintings)
  const repPrints = computeRepresentativePrints(
    newestFirst,
    printings,
    [options.currency],
    options.bannedPrintings,
  )
  const pricing: NamePricing = {
    printings,
    games: getCardGames(printings),
    representative: repPrints[options.currency]?.representative ?? null,
    cheapest: findCheapestPrinting(printings, options.currency),
  }
  cache.set(name, pricing)
  return pricing
}

function priceEntry(
  input: PriceListInput,
  entry: PriceListEntry,
  fileOrder: number,
  pricing: NamePricing,
  currency: PriceCurrency,
): PricedEntry {
  const pinned = hasSpecificPrinting(entry)
  const exactPrinting = pinned
    ? findPrinting(pricing.printings, entry.set, entry.collectorNumber)
    : undefined
  const metaCard =
    exactPrinting ?? pricing.representative ?? pricing.cheapest?.card ?? pricing.printings[0]

  const base: PricedEntry = {
    listType: input.type,
    listName: input.name,
    section: entry.section,
    name: entry.name,
    quantity: entry.quantity,
    set: entry.set ?? metaCard?.set.toLowerCase(),
    collectorNumber: entry.collectorNumber ?? metaCard?.collector_number,
    pinned,
    price: 0,
    lowest: 0,
    cmc: metaCard?.cmc ?? 0,
    edhrecRank: metaCard?.edhrec_rank ?? UNRANKED_EDHREC,
    typeLine: metaCard?.type_line ?? '',
    fileOrder,
  }

  if (pricing.printings.length === 0) {
    return { ...base, unpricedReason: 'no-printings' }
  }
  if (!isCurrencyAvailableForCard(pricing.games, currency)) {
    return { ...base, unpricedReason: 'currency-unavailable' }
  }
  if (pinned && !exactPrinting) {
    return { ...base, unpricedReason: 'printing-not-found' }
  }

  let price = 0
  let finish: Finish | undefined
  if (exactPrinting) {
    finish = resolveFinish(entry, exactPrinting)
    price = getCardPriceForFinish(exactPrinting, finish, currency)
  } else if (pricing.representative) {
    price = getCardPrice(pricing.representative, currency)
  }

  // The cheapest acceptable copy depends on how specific the entry is: a
  // collection entry or fully-specified wanted entry means "this exact copy",
  // a wanted printing pin means "this printing, any finish", and everything
  // else (deck entries, name-only wanted entries) means "any printing".
  let lowest: number
  let cheapestPick = pricing.cheapest
  if (input.type === 'collection' || (input.type === 'wanted' && pinned && entry.finish)) {
    lowest = price
    cheapestPick = null
  } else if (input.type === 'wanted' && pinned && exactPrinting) {
    lowest = findCheapestPrinting([exactPrinting], currency)?.price ?? 0
    cheapestPick = null
  } else {
    lowest = cheapestPick?.price ?? 0
  }
  if (lowest === 0 && price > 0) {
    lowest = price
    cheapestPick = null
  }

  return {
    ...base,
    finish,
    price,
    lowest,
    lowestSet: cheapestPick?.card.set.toLowerCase(),
    lowestCollectorNumber: cheapestPick?.card.collector_number,
    lowestFinish: cheapestPick?.finish,
    unpricedReason:
      price > 0
        ? undefined
        : finish && isFinishPricelessInCurrency(finish, currency)
          ? 'finish-unpriced-in-currency'
          : 'no-price-data',
  }
}

/** Sum totals over any set of priced entries. */
export function sumPricedEntries(entries: PricedEntry[]): PriceTotals {
  const totals: PriceTotals = { cardCount: 0, total: 0, lowestTotal: 0, unpricedCount: 0 }
  for (const entry of entries) {
    totals.cardCount += entry.quantity
    totals.total += entry.price * entry.quantity
    totals.lowestTotal += entry.lowest * entry.quantity
    if (entry.price <= 0) totals.unpricedCount += entry.quantity
  }
  return totals
}

/**
 * Price every entry of every input list and aggregate the results. Each unique
 * card name is looked up once; lookups are cache-backed in production, so a
 * report over all lists stays cheap after the first build.
 */
export async function buildPriceReport(
  inputs: PriceListInput[],
  options: BuildPriceReportOptions,
): Promise<BuiltPriceReport> {
  const pricingByName = new Map<string, NamePricing>()
  const entries: PricedEntry[] = []
  const lists: ListPriceSummary[] = []

  for (const input of inputs) {
    const listEntries: PricedEntry[] = []
    for (const [fileOrder, entry] of input.entries.entries()) {
      const pricing = await resolveNamePricing(entry.name, options, pricingByName)
      listEntries.push(priceEntry(input, entry, fileOrder, pricing, options.currency))
    }
    entries.push(...listEntries)
    lists.push({ type: input.type, name: input.name, ...sumPricedEntries(listEntries) })
  }

  const typeTotals: ListTypeTotals[] = []
  for (const type of LIST_TYPES) {
    const ofType = lists.filter((list) => list.type === type)
    if (ofType.length === 0) continue
    typeTotals.push({
      type,
      listCount: ofType.length,
      ...sumPricedEntries(entries.filter((entry) => entry.listType === type)),
    })
  }

  const report: PriceReport = {
    currency: options.currency,
    lists,
    entries,
    typeTotals,
    totals: { listCount: lists.length, ...sumPricedEntries(entries) },
  }
  return {
    report,
    printingsByName: new Map(
      [...pricingByName].map(([name, pricing]) => [name, pricing.printings]),
    ),
  }
}

/** Filters applied to priced entries when searching across lists. */
export type PriceEntryFilters = {
  /** Space-separated terms that must all appear in the card name. */
  name?: string
  /** Exact set code match (case-insensitive). */
  set?: string
  /** Exact collector number match (case-insensitive). */
  collector?: string
  type?: ListType
}

/** Whether any filter field is set (a blank filter matches everything). */
export function hasActiveFilters(filters: PriceEntryFilters): boolean {
  return Boolean(filters.name || filters.set || filters.collector || filters.type)
}

export function filterPricedEntries(
  entries: PricedEntry[],
  filters: PriceEntryFilters,
): PricedEntry[] {
  const set = filters.set?.toLowerCase()
  const collector = filters.collector?.toLowerCase()
  return entries.filter((entry) => {
    if (filters.type && entry.listType !== filters.type) return false
    if (filters.name && !matchesAllTerms(entry.name, filters.name)) return false
    if (set && entry.set?.toLowerCase() !== set) return false
    if (collector && entry.collectorNumber?.toLowerCase() !== collector) return false
    return true
  })
}

export const PRICE_SORT_FIELDS = [
  'name',
  'price',
  'lowest',
  'set',
  'cmc',
  'edhrec',
  'quantity',
] as const

export type PriceSortField = (typeof PRICE_SORT_FIELDS)[number]

export function isPriceSortField(value: string): value is PriceSortField {
  return (PRICE_SORT_FIELDS as readonly string[]).includes(value)
}

export function comparePricedEntries(
  a: PricedEntry,
  b: PricedEntry,
  field: PriceSortField,
  descending = false,
): number {
  let result: number
  switch (field) {
    case 'name':
      result = a.name.localeCompare(b.name)
      break
    case 'set':
      result = (a.set ?? '').localeCompare(b.set ?? '') || a.name.localeCompare(b.name)
      break
    case 'price':
      result = a.price - b.price || a.name.localeCompare(b.name)
      break
    case 'lowest':
      result = a.lowest - b.lowest || a.name.localeCompare(b.name)
      break
    case 'cmc':
      result = a.cmc - b.cmc || a.name.localeCompare(b.name)
      break
    case 'edhrec':
      result = a.edhrecRank - b.edhrecRank || a.name.localeCompare(b.name)
      break
    case 'quantity':
      result = a.quantity - b.quantity || a.name.localeCompare(b.name)
      break
  }
  return descending ? -result : result
}
