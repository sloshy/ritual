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
 * quantity-weighted, matching the public site's missing-price counts. Two
 * priceless entries are not gaps in the data: a proxy is not a real card, and a
 * card wearing custom art is not the printing a price could be quoted for.
 * Both price at 0 by rule and are left out of the unpriced counts.
 */

import { compareData } from './i18n/collate'

import * as fs from 'node:fs/promises'
import { loadCardArt, type CardArtMap } from './card-art'
import { effectiveLabels, pricelessReason, PRICELESS_REASONS, type CardLabel } from './card-labels'
import { findPrinting, hasSpecificPrinting, type CardPrintingsLookup } from './card-printing'
import { parseCollectionFile } from './collection-file'
import { parseDeckFrontMatter } from './deck-file'
import { displayFinish, printingFinishes } from './finish-condition'
import { isExtraSection } from './deck-format'
import { loadDeckFile } from './importers/text-file'
import { LIST_TYPES, type ListType } from './list-type'
import {
  findCheapestPrinting,
  getCardPrice,
  getCardPriceForFinish,
  isCurrencyAvailableForCard,
  isFinishPricelessInCurrency,
  type CheapestPrintingResult,
  type PriceCurrency,
} from './price-currency'
import { displayLanguage } from './card-language'
import type { PrintingQuoteFn } from './cardkingdom/quote'
import type { PriceSource } from './price-source'
import { listLocations, type ListLocation } from './resolve-list'
import { comparePrintings, computeRepresentativePrints, getCardGames } from './scryfall'
import { parseWantedListFile } from './commands/wanted-helpers'
import { matchesAllTerms } from './term-match'
import type { Condition, DeckData, Finish, ScryfallCard } from './types'
import type { CardLanguage } from './card-language'

/** When a card has no EDHREC rank, it sorts after every ranked card. */
export const UNRANKED_EDHREC = 999999

/**
 * A card line from any list, flattened to the fields the report engines need.
 * Pricing ignores `condition` (Scryfall quotes NM market values); it rides
 * along for the sell report, which shares this loader.
 */
export type PriceListEntry = {
  name: string
  quantity: number
  /** Pinned set code (lowercase), when the entry names a specific printing. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /**
   * The line's language token, when present (absent means `en`). Pricing
   * ignores it — a card prices from its printing regardless of language — but
   * it rides along for the sell report, which must refuse to quote non-English
   * copies against an English-only buylist.
   */
  language?: CardLanguage
  /**
   * The card's *effective* labels — its own override already resolved against
   * the list's front-matter default, so nothing downstream needs the list to
   * answer "is this a proxy?". Absent means no labels at all.
   */
  labels?: readonly CardLabel[]
  /**
   * Whether the list's `<name>.art.json` sidecar gives this card a custom
   * image. The reference itself is not needed here — pricing only cares that
   * the copy in hand is no longer the printing a quote would be for.
   */
  hasCustomArt?: boolean
  section: string
}

/** The fields that decide whether an entry is priceless by rule. */
export type PricelessEntryFields = Pick<PriceListEntry, 'labels' | 'hasCustomArt'>

/**
 * Why an entry carries no price *by rule* — a statement about the card itself
 * rather than about the price data — or `undefined` when it should be priced
 * normally. Custom art wins over the proxy label when both apply: a card
 * wearing art of its own is the more specific thing to say about it.
 *
 * Both report engines branch on this single answer, so "no price, no quote, no
 * sale" is decided in exactly one place. That place is `pricelessReason` in
 * `src/card-labels.ts`, which the site surfaces call with their own entry
 * shapes — this is the price engine's spelling of the same rule.
 */
export function pricelessEntryReason(
  entry: PricelessEntryFields,
): ByRuleUnpricedReason | undefined {
  return pricelessReason(entry.labels, entry.hasCustomArt === true)
}

/** Whether an entry is priceless by rule (see {@link pricelessEntryReason}). */
export function isPricelessEntry(entry: PricelessEntryFields): boolean {
  return pricelessEntryReason(entry) !== undefined
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

/**
 * The reasons that report the *card* rather than a gap in the price data: a
 * proxy is not a real card, and a card given custom art is not the printing a
 * quote would be for. These are the reasons that do not count as unpriced, and
 * the ones the surfaces render as a marker (`PROXY` / `CUSTOM`) in place of a
 * price.
 *
 * The rule's own list, not a copy of it: a reason added to
 * {@link PRICELESS_REASONS} is one `pricelessEntryReason` can return, so
 * re-listing them here could only ever go out of date (a `satisfies` check
 * catches a *wrong* member, never a missing one).
 */
export const BY_RULE_UNPRICED_REASONS = PRICELESS_REASONS

export type ByRuleUnpricedReason = (typeof BY_RULE_UNPRICED_REASONS)[number]

/**
 * Why an entry carries no price. Every reason but the by-rule ones reports a
 * gap between the entry and the price data.
 */
export const UNPRICED_REASONS = [
  'no-printings',
  'printing-not-found',
  'currency-unavailable',
  'finish-unpriced-in-currency',
  'no-price-data',
  ...BY_RULE_UNPRICED_REASONS,
] as const

export type UnpricedReason = (typeof UNPRICED_REASONS)[number]

/** Whether a reason is one of the by-rule ones (narrowing, for display tables). */
export function isByRuleUnpricedReason(
  reason: UnpricedReason | undefined,
): reason is ByRuleUnpricedReason {
  return reason !== undefined && (BY_RULE_UNPRICED_REASONS as readonly string[]).includes(reason)
}

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
  lowestFinish?: Finish
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

/**
 * The non-Scryfall stores a report can be priced from. One const so the report
 * type, its three payload shapes, and the MCP output schema all widen together
 * when a second store arrives; an absent `source` means Scryfall (the currency
 * alone says which store that is). A `cardkingdom` report is always in `usd`.
 */
export const REPORT_PRICE_SOURCES = ['cardkingdom'] as const satisfies readonly PriceSource[]

export type ReportPriceSource = (typeof REPORT_PRICE_SOURCES)[number]

export type PriceReport = {
  currency: PriceCurrency
  /** Present when prices came from Card Kingdom's NM retail feed instead of Scryfall. */
  source?: ReportPriceSource
  lists: ListPriceSummary[]
  entries: PricedEntry[]
  /** Totals per list type, in canonical type order; types with no lists are omitted. */
  typeTotals: ListTypeTotals[]
  totals: PriceReportTotals
}

export type BuildPriceReportOptions = {
  currency: PriceCurrency
  lookup: CardPrintingsLookup
  /** `set:collectorNumber` keys excluded from representative-printing selection. */
  bannedPrintings?: ReadonlySet<string>
  /**
   * Price from Card Kingdom's NM retail feed instead of Scryfall. USD only —
   * the caller enforces `currency: 'usd'` before building. A printing CK has
   * no product for (or a non-English entry, which their English-only feed can
   * never quote) is honestly unpriced; there is no Scryfall fallback.
   */
  cardKingdom?: CardKingdomPricing
}

/**
 * The Card Kingdom retail lookup the report prices against: the same
 * cache-backed single-printing seam the site bake uses
 * (`DetailBuylistContext.quote`), so the CLI and the sites can never quote the
 * same printing differently.
 */
export type CardKingdomPricing = {
  quote: PrintingQuoteFn
}

/** CK NM retail for one printing+finish; 0 when CK has no product (or no price) for it. */
function cardKingdomRetail(
  ck: CardKingdomPricing,
  card: ScryfallCard,
  finish: Finish,
  language: CardLanguage | undefined,
): number {
  const quote = ck.quote({
    set: card.set,
    collectorNumber: card.collector_number,
    finish,
    scryfallId: card.id,
    ...(displayLanguage(language) !== 'en' ? { language } : {}),
  })
  return quote && quote.priceRetail > 0 ? quote.priceRetail : 0
}

/**
 * The cheapest CK-retail printing+finish across a card's printings — the CK
 * counterpart of `findCheapestPrinting`, quoting each offered finish through
 * the shared matcher.
 */
function findCheapestCardKingdomPrinting(
  ck: CardKingdomPricing,
  printings: ScryfallCard[],
): CheapestPrintingResult | null {
  let best: CheapestPrintingResult | null = null
  for (const card of printings) {
    for (const finish of printingFinishes(card)) {
      const price = cardKingdomRetail(ck, card, finish, undefined)
      if (price > 0 && (best === null || price < best.price)) {
        best = { price, card, finish }
      }
    }
  }
  return best
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
  /** Present when prices are Card Kingdom NM retail rather than Scryfall. */
  source?: ReportPriceSource
  lastRefreshedAt: number | null
  lists: ListPriceSummary[]
  typeTotals: ListTypeTotals[]
  totals: PriceReportTotals
  /** List parse warnings (prefixed with the list name) — lines pricing could not read. */
  warnings: string[]
}

/**
 * The JSON contract of the single-list view, shared by the CLI's
 * `--output json` mode and the admin price API.
 */
export type PriceListDetailPayload = {
  currency: PriceCurrency
  /** Present when prices are Card Kingdom NM retail rather than Scryfall. */
  source?: ReportPriceSource
  list: ListPriceSummary | undefined
  cards: PricedEntry[]
  /** List parse warnings (prefixed with the list name) — lines pricing could not read. */
  warnings: string[]
}

/** The JSON contract of the CLI's card-search view (`--output json`). */
export type PriceCardSearchPayload = {
  currency: PriceCurrency
  /** Present when prices are Card Kingdom NM retail rather than Scryfall. */
  source?: ReportPriceSource
  filters: PriceEntryFilters
  cards: PricedEntry[]
  totals: PriceTotals
  /** List parse warnings (prefixed with the list name) — lines pricing could not read. */
  warnings: string[]
}

/**
 * Load every list of the given type (or all types) into pricing inputs. Deck
 * sections classified as extras (maybeboard/token) are excluded, matching the
 * public site's deck totals; sideboards are included.
 */
/**
 * Flatten a deck's sections into pricing entries, excluding extras
 * (maybeboard/token sections) to match the public site's deck totals;
 * sideboards are included. `listLabels` is the deck's front-matter default,
 * which each line's own labels override; `art` is the deck's custom-art
 * sidecar, whose keys are the lines' `&N` ids.
 */
export function deckPriceEntries(
  deck: Pick<DeckData, 'sections'>,
  listLabels?: readonly CardLabel[],
  art?: CardArtMap,
): PriceListEntry[] {
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
        condition: card.condition,
        language: card.language,
        labels: labelsOrUndefined(card.labels, listLabels),
        hasCustomArt: customArtFlag(art, card.cardId),
        section: section.name,
      })
    }
  }
  return entries
}

/**
 * Whether a card line has custom art, as the optional flag the entry carries —
 * `undefined` rather than `false` when it does not, so an entry says nothing
 * about art it does not have (the same shape `labelsOrUndefined` produces).
 * A line with no `&N` id cannot be in the sidecar at all.
 */
function customArtFlag(art: CardArtMap | undefined, cardId: number | undefined): true | undefined {
  if (art === undefined || cardId === undefined) return undefined
  return art.has(cardId) ? true : undefined
}

/**
 * The effective labels of a card line, or `undefined` when it has none —
 * pricing entries carry a label field only when there is something to say.
 */
function labelsOrUndefined(
  override: readonly CardLabel[] | undefined,
  listDefault: readonly CardLabel[] | undefined,
): CardLabel[] | undefined {
  const labels = effectiveLabels(override, listDefault)
  return labels.length > 0 ? labels : undefined
}

export async function loadPriceListInputs(
  type?: ListType,
  locations?: ListLocation[],
): Promise<LoadedPriceInputs> {
  const resolvedLocations = locations ?? (await listLocations(type))
  const inputs: PriceListInput[] = []
  const warnings: string[] = []

  for (const location of resolvedLocations) {
    // Custom art is per-list metadata in a sidecar, and it prices a card at 0
    // the way the proxy label does, so every list is read alongside its lines.
    // An unreadable sidecar is a warning, not a failure: the lines still price.
    const loadedArt = await loadCardArt(location.filePath)
    if (!loadedArt.ok) warnings.push(`${location.name}: ${loadedArt.message}`)
    const art: CardArtMap = loadedArt.ok ? loadedArt.art : new Map()

    if (location.type === 'deck') {
      const { deck, warnings: deckWarnings } = await loadDeckFile(location.filePath)
      warnings.push(...deckWarnings.map((w) => `${location.name}: ${w}`))
      // The deck body carries no front matter, so the list's default labels are
      // read separately — the same second parse the deck load route does.
      const frontMatter = await parseDeckFrontMatter(location.filePath)
      inputs.push({
        type: 'deck',
        name: location.name,
        entries: deckPriceEntries(deck, frontMatter.labels, art),
      })
      continue
    }

    const content = await fs.readFile(location.filePath, 'utf-8')
    if (location.type === 'collection') {
      const parsed = parseCollectionFile(content)
      warnings.push(...parsed.warnings.map((w) => `${location.name}: ${w}`))
      inputs.push({
        type: location.type,
        name: location.name,
        entries: parsed.entries.map(
          (entry): PriceListEntry => ({
            name: entry.name,
            quantity: entry.quantity,
            set: entry.set.toLowerCase(),
            collectorNumber: entry.collectorNumber,
            finish: entry.finish,
            condition: entry.condition,
            language: entry.language,
            labels: labelsOrUndefined(entry.labels, parsed.labels),
            hasCustomArt: customArtFlag(art, entry.cardId),
            section: entry.section,
          }),
        ),
      })
      continue
    }
    const parsed = parseWantedListFile(content)
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
          language: entry.language,
          hasCustomArt: customArtFlag(art, entry.cardId),
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
    // Under CK pricing the cheapest acceptable copy is the cheapest printing
    // CK actually sells, quoted through the same matcher as everything else.
    cheapest: options.cardKingdom
      ? findCheapestCardKingdomPrinting(options.cardKingdom, printings)
      : findCheapestPrinting(printings, options.currency),
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
  ck?: CardKingdomPricing,
): PricedEntry {
  const pinned = hasSpecificPrinting(entry)
  // Deliberately language-neutral: no language is passed, so `findPrinting`
  // resolves the printing's default (English) object. Prices are quoted for
  // the *printing* regardless of the copy's language — foreign objects carry
  // no Scryfall prices of their own, and a `[ja]` line must price identically
  // to its bare English twin.
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

  // Judged before any price lookup: a proxy and a card wearing custom art are
  // priced at 0 by rule, not for want of data, so no printing of either may
  // quote a price and no cache gap of the name may be reported against it.
  const byRuleReason = pricelessEntryReason(entry)
  if (byRuleReason) {
    return { ...base, unpricedReason: byRuleReason }
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
    finish = displayFinish(exactPrinting, entry.finish)
    price = ck
      ? cardKingdomRetail(ck, exactPrinting, finish, entry.language)
      : getCardPriceForFinish(exactPrinting, finish, currency)
  } else if (pricing.representative) {
    price = ck
      ? cardKingdomRetail(
          ck,
          pricing.representative,
          displayFinish(pricing.representative, undefined),
          entry.language,
        )
      : getCardPrice(pricing.representative, currency)
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
    // "This printing, any finish" — priced from the same store as everything
    // else, or `lowest` would mix a Scryfall figure into a Card Kingdom total.
    lowest = ck
      ? (findCheapestCardKingdomPrinting(ck, [exactPrinting])?.price ?? 0)
      : (findCheapestPrinting([exactPrinting], currency)?.price ?? 0)
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
        : !ck && finish && isFinishPricelessInCurrency(finish, currency)
          ? 'finish-unpriced-in-currency'
          : 'no-price-data',
  }
}

/**
 * Sum totals over any set of priced entries. Proxies and custom-art cards
 * count as cards but never as unpriced ones: "3 unpriced" must mean three cards
 * whose price could not be found, not three the user built out of paper or gave
 * art of their own on purpose.
 */
export function sumPricedEntries(entries: PricedEntry[]): PriceTotals {
  const totals: PriceTotals = { cardCount: 0, total: 0, lowestTotal: 0, unpricedCount: 0 }
  for (const entry of entries) {
    totals.cardCount += entry.quantity
    totals.total += entry.price * entry.quantity
    totals.lowestTotal += entry.lowest * entry.quantity
    if (entry.price <= 0 && !isByRuleUnpricedReason(entry.unpricedReason)) {
      totals.unpricedCount += entry.quantity
    }
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
      listEntries.push(
        priceEntry(input, entry, fileOrder, pricing, options.currency, options.cardKingdom),
      )
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
    ...(options.cardKingdom ? { source: 'cardkingdom' as const } : {}),
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
      result = compareData(a.name, b.name)
      break
    case 'set':
      result = compareData(a.set ?? '', b.set ?? '') || compareData(a.name, b.name)
      break
    case 'price':
      result = a.price - b.price || compareData(a.name, b.name)
      break
    case 'lowest':
      result = a.lowest - b.lowest || compareData(a.name, b.name)
      break
    case 'cmc':
      result = a.cmc - b.cmc || compareData(a.name, b.name)
      break
    case 'edhrec':
      result = a.edhrecRank - b.edhrecRank || compareData(a.name, b.name)
      break
    case 'quantity':
      result = a.quantity - b.quantity || compareData(a.name, b.name)
      break
  }
  return descending ? -result : result
}
