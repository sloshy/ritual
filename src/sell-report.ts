/**
 * The matching engine behind the `sell` command: joins card entries from any
 * list against Card Kingdom's cached buylist feed and reports what CK is
 * currently buying, for how much, and up to what quantity.
 *
 * Matching per entry:
 *
 * - An entry pinned to a printing (set + collector number) resolves through the
 *   card cache to that printing's Scryfall id, then to the CK product with the
 *   entry's finish — the primary join key (99.5% of CK products carry a
 *   `scryfall_id`). When the id has no product (or the cache cannot resolve the
 *   printing), the sku-derived printing index is tried (`DSK-0136` ⇔ dsk:136).
 * - An unpinned entry (deck/wanted lines without a printing) unions the CK
 *   products of every cached printing of the name — falling back to CK's own
 *   name index when the cache has none — and quotes the best-paying one, so the
 *   report answers "what would CK pay if I sent the right printing". The quoted
 *   printing's set/collector are reported back on the entry.
 * - Among multiple candidate products the best-paying *buying* product wins;
 *   `ambiguous` is set so surfaces can flag the quote as a choice.
 *
 * "Buying" means `qtyBuying > 0` and a nonzero price — CK publishes token
 * prices on products it is not actually buying. Sellable quantities draw down a
 * per-product budget of CK's `qtyBuying`, so several entries matching the same
 * product (across sections, conditions, or lists) never sum past their cap,
 * and `value` prices only the sellable copies. Quotes are CK's cash offers for
 * Near Mint copies; graded-down conditions and store-credit bonuses are not
 * modeled.
 */

import {
  buildCkCartCsv,
  roundCents,
  type CkCartItem,
  type SellCartCsv,
  type SellMatchVia,
} from './buylist'
import { aggregateQuantities, variantKey } from './card-line'
import { findPrinting, hasSpecificPrinting, type CardPrintingsLookup } from './card-printing'
import {
  chooseMatch,
  matchPrinting,
  productIsBuying,
  productUrl,
  type CardKingdomFeed,
  type CardKingdomIndex,
  type CardKingdomProduct,
} from './cardkingdom'
import { resolveFinish } from './collection-file'
import { LIST_TYPES, type ListType } from './list-type'
import {
  loadPriceListInputs,
  type LoadedPriceInputs,
  type PriceListEntry,
  type PriceListInput,
} from './price-report'
import type { ListLocation } from './resolve-list'
import type { Condition, Finish, ScryfallCard } from './types'

/**
 * A card line flattened for matching — the price report's input shape, whose
 * loader this engine shares (`condition` rides along there for exactly this).
 */
export type SellListEntry = PriceListEntry

/** One list's entries, ready for matching. */
export type SellListInput = PriceListInput

/** Lists loaded from disk plus any parser warnings. */
export type LoadedSellInputs = LoadedPriceInputs

export const SELL_ENTRY_STATUSES = ['buying', 'not-buying', 'no-match'] as const
export type SellEntryStatus = (typeof SELL_ENTRY_STATUSES)[number]

/**
 * Why an entry has no CK product: the card cache has no printings for the name
 * (`no-printings`), the pinned printing is not among the cached printings
 * (`printing-not-found`) — both after the fallbacks also missed — or the
 * printing resolved but CK's catalog has no product for it (`not-on-buylist`).
 */
export const SELL_NO_MATCH_REASONS = [
  'no-printings',
  'printing-not-found',
  'not-on-buylist',
] as const
export type SellNoMatchReason = (typeof SELL_NO_MATCH_REASONS)[number]

/** The fields every sell entry carries, whatever its match outcome. */
export type SellEntryBase = {
  listType: ListType
  listName: string
  section: string
  name: string
  quantity: number
  /** Set code shown (lowercase): the entry's own pin, else the quoted printing's. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** Whether set/collectorNumber came from the list entry itself. */
  pinned: boolean
  /** Copies CK would take from this entry: capped by the product's remaining budget; 0 unless buying. */
  sellableQuantity: number
  /** priceBuy × sellableQuantity. */
  value: number
  fileOrder: number
}

/** The CK product behind a matched entry — present together or not at all. */
export type SellEntryMatch = {
  matchVia: SellMatchVia
  /** Multiple CK products matched; the quote is from the best-paying one. */
  ambiguous?: boolean
  ckProductId: number
  ckSku: string
  /** CK's own card title, which can differ from Scryfall's (accents, tokens). */
  ckName: string
  ckEdition: string
  ckVariation?: string
  ckUrl?: string
  /** The matched product's finish — differs from `finish` on unpinned entries. */
  ckFinish: Finish
  /** CK's buylist cash quote (USD, NM) per copy. */
  priceBuy: number
  /** CK's retail price (USD), for reference. */
  priceRetail: number
  /** Copies CK is currently buying of this product (their cap, not ours). */
  qtyBuying: number
}

/** An entry CK's catalog matched: an active offer, or a paused one. */
export type MatchedSellEntry = SellEntryBase & {
  status: 'buying' | 'not-buying'
} & SellEntryMatch

/** An entry no CK product could be found for. */
export type UnmatchedSellEntry = SellEntryBase & {
  status: 'no-match'
  noMatchReason: SellNoMatchReason
}

/** One card entry matched against the buylist, discriminated by `status`. */
export type SellReportEntry = MatchedSellEntry | UnmatchedSellEntry

/** An entry CK is actively buying. */
export type BuyingSellEntry = MatchedSellEntry & { status: 'buying' }

/** Narrow to the entries CK is actively buying (for `.filter` callbacks). */
export function isBuyingEntry(entry: SellReportEntry): entry is BuyingSellEntry {
  return entry.status === 'buying'
}

/** Aggregate totals over a set of sell entries (all quantity-weighted). */
export type SellTotals = {
  /** Sum of entry quantities. */
  cardCount: number
  /** Sum of sellable quantities across buying entries. */
  sellableCount: number
  /** Sum of entry `value`s. */
  totalValue: number
  /** Copies whose product CK is not currently buying. */
  notBuyingCount: number
  /** Copies with no CK product match at all. */
  noMatchCount: number
}

export type SellListSummary = SellTotals & {
  type: ListType
  name: string
}

export type SellReportTotals = SellTotals & { listCount: number }

export type SellReport = {
  /** CK's feed generation stamp, verbatim. */
  feedCreatedAt: string
  /** When Ritual downloaded the feed (epoch ms). */
  feedRetrievedAt: number
  lists: SellListSummary[]
  entries: SellReportEntry[]
  totals: SellReportTotals
}

export type BuildSellReportOptions = {
  lookup: CardPrintingsLookup
  index: CardKingdomIndex
  feed: CardKingdomFeed
  feedRetrievedAt: number
}

/**
 * The JSON contract of the sell report, shared by the CLI's `--output json`
 * mode and the admin sell API. When filters are active, `entries`, `lists`,
 * and `totals` reflect the filtered view.
 */
export type SellReportPayload = {
  feedCreatedAt: string
  feedRetrievedAt: number
  filters: SellEntryFilters
  lists: SellListSummary[]
  entries: SellReportEntry[]
  totals: SellReportTotals
  /** List parse warnings (prefixed with the list name) — lines matching could not read. */
  warnings: string[]
}

/**
 * Load every list of the given type (or the given locations) into sell inputs
 * through the shared list loader (deck extras excluded, sideboards included,
 * set codes lowercased — the price report's rules). Collection files hold one
 * line per physical copy, so identical variants are aggregated per list.
 */
export async function loadSellListInputs(
  type?: ListType,
  locations?: ListLocation[],
): Promise<LoadedSellInputs> {
  const { inputs, warnings } = await loadPriceListInputs(type, locations)
  return {
    inputs: inputs.map(
      (input): SellListInput => ({ ...input, entries: aggregateSellEntries(input.entries) }),
    ),
    warnings,
  }
}

/**
 * Collapse identical variants (name + printing + finish + condition, within a
 * section) into one entry with a summed quantity, in first-seen order —
 * collection files spell four copies as four `quantity: 1` lines.
 */
export function aggregateSellEntries(entries: SellListEntry[]): SellListEntry[] {
  return aggregateQuantities(
    entries,
    (entry) =>
      `${entry.section}|${variantKey(entry.name, entry.set, entry.collectorNumber, entry.finish, entry.condition)}`,
    (entry) => entry.quantity,
  ).map(({ entry, quantity }) => ({ ...entry, quantity }))
}

/** The outcome of the candidate search for one entry, before status is judged. */
type EntryMatch =
  | {
      kind: 'matched'
      product: CardKingdomProduct
      matchVia: SellMatchVia
      ambiguous: boolean
      /** The finish candidates were filtered to (display finish for the entry). */
      finish?: Finish
    }
  | { kind: 'unmatched'; noMatchReason: SellNoMatchReason; finish?: Finish }

function matched(
  candidates: CardKingdomProduct[],
  matchVia: SellMatchVia,
  finish: Finish | undefined,
): EntryMatch | null {
  const hit = chooseMatch(candidates)
  if (!hit) return null
  return { kind: 'matched', product: hit.product, matchVia, ambiguous: hit.ambiguous, finish }
}

/** A sell entry narrowed by {@link hasSpecificPrinting} to a pinned printing. */
type PinnedSellEntry = SellListEntry & { set: string; collectorNumber: string }

function matchPinnedEntry(
  entry: PinnedSellEntry,
  printings: ScryfallCard[],
  index: CardKingdomIndex,
): EntryMatch {
  const exact = findPrinting(printings, entry.set, entry.collectorNumber)
  const finish = exact ? resolveFinish(entry, exact) : (entry.finish ?? 'nonfoil')

  // The same matcher the site's sell mode calls, so a card quoted in the UI and
  // the same card in `ritual sell` can never disagree.
  const hit = matchPrinting(index, {
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish,
    scryfallId: exact?.id,
  })
  if (hit) {
    return {
      kind: 'matched',
      product: hit.match.product,
      matchVia: hit.matchVia,
      ambiguous: hit.match.ambiguous,
      finish,
    }
  }

  const noMatchReason: SellNoMatchReason = exact
    ? 'not-on-buylist'
    : printings.length === 0
      ? 'no-printings'
      : 'printing-not-found'
  return { kind: 'unmatched', noMatchReason, finish }
}

function matchUnpinnedEntry(
  entry: SellListEntry,
  printings: ScryfallCard[],
  index: CardKingdomIndex,
): EntryMatch {
  const byIds: CardKingdomProduct[] = []
  for (const printing of printings) {
    for (const product of index.byScryfallId.get(printing.id) ?? []) {
      if (entry.finish === undefined || product.finish === entry.finish) byIds.push(product)
    }
  }
  const byIdHit = matched(byIds, 'scryfall-id', entry.finish)
  if (byIdHit) return byIdHit

  const byName = (index.byName.get(entry.name.toLowerCase()) ?? []).filter(
    (product) => entry.finish === undefined || product.finish === entry.finish,
  )
  const byNameHit = matched(byName, 'name', entry.finish)
  if (byNameHit) return byNameHit

  return {
    kind: 'unmatched',
    noMatchReason: printings.length === 0 ? 'no-printings' : 'not-on-buylist',
    finish: entry.finish,
  }
}

/**
 * Remaining buy capacity per CK product id across the whole report, so entries
 * sharing a product draw down one budget instead of each getting the full cap.
 */
type ProductBudgets = Map<number, number>

function matchEntry(
  input: SellListInput,
  entry: SellListEntry,
  fileOrder: number,
  printings: ScryfallCard[],
  options: BuildSellReportOptions,
  budgets: ProductBudgets,
): SellReportEntry {
  const pinned = hasSpecificPrinting(entry)
  const match = pinned
    ? matchPinnedEntry(entry, printings, options.index)
    : matchUnpinnedEntry(entry, printings, options.index)

  // The printing shown: the entry's own pin, else — when the quote came through
  // a Scryfall id — the quoted printing, so unpinned matches still say which
  // copy the price is for (and participate in set filters).
  let set = entry.set
  let collectorNumber = entry.collectorNumber
  if (!pinned && match.kind === 'matched' && match.product.scryfallId !== '') {
    const quoted = printings.find((printing) => printing.id === match.product.scryfallId)
    if (quoted) {
      set = quoted.set.toLowerCase()
      collectorNumber = quoted.collector_number
    }
  }

  const base: SellEntryBase = {
    listType: input.type,
    listName: input.name,
    section: entry.section,
    name: entry.name,
    quantity: entry.quantity,
    set,
    collectorNumber,
    finish: match.finish ?? entry.finish,
    condition: entry.condition,
    pinned,
    sellableQuantity: 0,
    value: 0,
    fileOrder,
  }

  if (match.kind === 'unmatched') {
    return { ...base, status: 'no-match', noMatchReason: match.noMatchReason }
  }

  const { product } = match
  const buying = productIsBuying(product)
  let sellableQuantity = 0
  if (buying) {
    const remaining = budgets.get(product.id) ?? product.qtyBuying
    sellableQuantity = Math.min(entry.quantity, remaining)
    budgets.set(product.id, remaining - sellableQuantity)
  }
  return {
    ...base,
    status: buying ? 'buying' : 'not-buying',
    matchVia: match.matchVia,
    ambiguous: match.ambiguous ? true : undefined,
    ckProductId: product.id,
    ckSku: product.sku,
    ckName: product.name,
    ckEdition: product.edition,
    ckVariation: product.variation === '' ? undefined : product.variation,
    ckUrl: productUrl(options.feed, product),
    ckFinish: product.finish,
    priceBuy: product.priceBuy,
    priceRetail: product.priceRetail,
    qtyBuying: product.qtyBuying,
    sellableQuantity,
    value: roundCents(product.priceBuy * sellableQuantity),
  }
}

/** Sum totals over any set of sell entries. */
export function sumSellEntries(entries: SellReportEntry[]): SellTotals {
  const totals: SellTotals = {
    cardCount: 0,
    sellableCount: 0,
    totalValue: 0,
    notBuyingCount: 0,
    noMatchCount: 0,
  }
  for (const entry of entries) {
    totals.cardCount += entry.quantity
    totals.sellableCount += entry.sellableQuantity
    totals.totalValue = roundCents(totals.totalValue + entry.value)
    if (entry.status === 'not-buying') totals.notBuyingCount += entry.quantity
    if (entry.status === 'no-match') totals.noMatchCount += entry.quantity
  }
  return totals
}

/** Recompute per-list summaries and grand totals from an entry set. */
export function summarizeSellEntries(
  entries: SellReportEntry[],
): Pick<SellReport, 'lists' | 'totals'> {
  type ListGroup = { type: ListType; name: string; entries: SellReportEntry[] }
  const groups = new Map<string, ListGroup>()
  for (const entry of entries) {
    const key = `${entry.listType} ${entry.listName}`
    const group = groups.get(key)
    if (group) group.entries.push(entry)
    else groups.set(key, { type: entry.listType, name: entry.listName, entries: [entry] })
  }

  // Canonical type order, first-seen order within a type.
  const lists: SellListSummary[] = []
  for (const type of LIST_TYPES) {
    for (const group of groups.values()) {
      if (group.type !== type) continue
      lists.push({ type: group.type, name: group.name, ...sumSellEntries(group.entries) })
    }
  }
  return {
    lists,
    totals: { listCount: lists.length, ...sumSellEntries(entries) },
  }
}

/**
 * Match every entry of every input list against the buylist. Each unique card
 * name is looked up once; lookups are cache-backed in production.
 */
export async function buildSellReport(
  inputs: SellListInput[],
  options: BuildSellReportOptions,
): Promise<SellReport> {
  const printingsByName = new Map<string, ScryfallCard[]>()
  const budgets: ProductBudgets = new Map()
  const entries: SellReportEntry[] = []

  for (const input of inputs) {
    for (const [fileOrder, entry] of input.entries.entries()) {
      let printings = printingsByName.get(entry.name)
      if (!printings) {
        printings = await options.lookup(entry.name)
        printingsByName.set(entry.name, printings)
      }
      entries.push(matchEntry(input, entry, fileOrder, printings, options, budgets))
    }
  }

  return {
    feedCreatedAt: options.feed.createdAt,
    feedRetrievedAt: options.feedRetrievedAt,
    entries,
    ...summarizeSellEntries(entries),
  }
}

/** Filters applied to sell entries before display or export. */
export type SellEntryFilters = {
  /**
   * Keep entries from these set codes (lowercase, like every internal set
   * code): the entry's pin, or the quoted printing's set for unpinned matches.
   */
  sets?: string[]
  /**
   * Keep matched entries whose per-copy quote is at least this much. Any
   * `minPrice` — including 0 — drops unmatched entries, which have no quote.
   */
  minPrice?: number
}

/** Parse a minimum-price value; returns the error message for a bad one. */
export function parseMinPrice(raw: string): number | string {
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return `Invalid minimum price '${raw}' (expected a non-negative number)`
  }
  return parsed
}

/** Whether any filter field is set (a blank filter keeps everything). */
export function hasActiveSellFilters(filters: SellEntryFilters): boolean {
  return Boolean((filters.sets && filters.sets.length > 0) || filters.minPrice !== undefined)
}

export function filterSellEntries(
  entries: SellReportEntry[],
  filters: SellEntryFilters,
): SellReportEntry[] {
  const sets = filters.sets
  return entries.filter((entry) => {
    if (sets && sets.length > 0 && !(entry.set && sets.includes(entry.set))) {
      return false
    }
    if (filters.minPrice !== undefined) {
      if (entry.status === 'no-match') return false
      if (entry.priceBuy < filters.minPrice) return false
    }
    return true
  })
}

/** The entry/summary slice of a report after filtering. */
export type SellReportView = Pick<SellReport, 'lists' | 'entries' | 'totals'>

/**
 * Apply filters to a built report, recomputing the per-list summaries and
 * totals over the surviving entries. A blank filter returns the report's own
 * view unchanged. Shared by the CLI and the admin sell endpoint.
 */
export function applySellFilters(report: SellReport, filters: SellEntryFilters): SellReportView {
  if (!hasActiveSellFilters(filters)) {
    return { lists: report.lists, entries: report.entries, totals: report.totals }
  }
  const entries = filterSellEntries(report.entries, filters)
  return { entries, ...summarizeSellEntries(entries) }
}

/**
 * Render entries CK is buying as their sell-cart CSV import format, using CK's
 * own listing title (name plus variant note) and edition spelling from the
 * matched product so the importer recognizes every row and lands variant
 * printings on the right product, and the sellable (budget-capped) quantities. The
 * rendering itself lives in `src/buylist/cart-csv.ts`, shared with the site's
 * "Copy CK cart CSV" so both produce byte-identical files.
 */
export function buildSellCartCsv(entries: SellReportEntry[]): SellCartCsv {
  const items = entries.filter(isBuyingEntry).map(
    (entry): CkCartItem => ({
      name: entry.ckName,
      edition: entry.ckEdition,
      variation: entry.ckVariation,
      finish: entry.ckFinish,
      quantity: entry.sellableQuantity,
    }),
  )
  return buildCkCartCsv(items)
}
