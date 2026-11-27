/**
 * The cross-list summary: one row per selected list (its counts, default
 * labels, description, cover override, deck format and — when a price store is
 * given — its value), plus totals across the whole selection.
 *
 * Each list file is read exactly once, priced or not: the counts, the metadata
 * and the priced entries all come from the one content read, so a value can
 * never describe a different file than the counts beside it. Counting never
 * needs the card cache; value is priced by the same rule single-list pricing
 * uses (`parseListContent` → `priceListInput` → `buildPriceReportFromInputs`), so a row's value is
 * exactly what `price <list>` reports for it (see {@link ListsSummaryRow.value}
 * for how a deck-section selection narrows it).
 *
 * Rows are identified by `{ listType, slug }` throughout, never by display name:
 * two lists of different types may share a slug, and a title is not unique.
 */

import fs from 'node:fs/promises'
import { cardCache } from '../cache'
import type { RefreshMode } from '../cache/refresh'
import type { CardLabel } from '../card/card-labels'
import { matchesNameTerms, normalizeCardName, splitNameTerms } from '../card/term-match'
import { compareData, compareDisplay } from '../i18n/collate'
import { foldedCardNameSet } from '../list/card-names'
import { loadListArtOrWarn } from '../list/card-art'
import type { DeckFormatKey, DeckSection } from '../list/deck'
import { readFlatListMetadata, type FlatListFrontMatter } from '../list/flat-list-front-matter'
import {
  isExpectedListReadFailure,
  parseListContent,
  type ParsedListContent,
} from '../list/list-content'
import { countDeck, countEntries, type ListCounts } from '../list/list-counts'
import {
  listIdentityKey,
  listIdentityOf,
  listWarning,
  uniqueListIdentities,
  type ListIdentity,
  type ListWarning,
  type NamedListIdentity,
} from '../list/list-info'
import type { ListImageRef } from '../list/list-image'
import { LIST_TYPES, type ListType } from '../list/list-type'
import { listLocations, type ListLocation } from '../list/resolve-list'
import { rewriteBlockingMessages } from '../list/unreadable-content'
import type { PriceCurrency } from '../pricing/price-currency'
import {
  createNamePricingMemo,
  priceListInput,
  sumPricedEntries,
  type PricedEntry,
  type PriceTotals,
  type ReportPricing,
} from '../pricing/price-report'
import { buildPriceReportFromInputs } from '../pricing/price-runtime'
import { sourceCurrency, type PriceSource } from '../pricing/price-source'
import { errorMessage, isSyncMessage, syncMessage, type SyncMessage } from '../sync/message'

/** The orders rows can be returned in, in the order a refusal lists them. */
export const LISTS_SUMMARY_SORTS = ['name', 'quantity', 'value'] as const

/** What rows are ordered by. */
export type ListsSummarySort = (typeof LISTS_SUMMARY_SORTS)[number]

/**
 * The store a summary is priced at, and the card-cache refresh mode pricing
 * runs under — one value, so a server caller states `refresh: 'never'` (a
 * cache-only lookup) whenever it asks for prices, and cannot forget it.
 */
export interface ListsSummaryPricing {
  /** The caller resolves it: a Card Kingdom pricing already carries its feed. */
  pricing: ReportPricing
  refresh: RefreshMode
}

/**
 * A store was asked for but its prices cannot be had (Card Kingdom with no
 * feed): the reason, which the summary reports as its first warning beside
 * the counts — or, for a `value` sort it cannot honor, refuses with.
 */
export interface ListsSummaryUnpriceable {
  unavailable: SyncMessage
}

/**
 * The `priced` option for a store's resolved pricing — or, when the store
 * cannot price (the surface's own reason, such as Card Kingdom with no feed),
 * the {@link ListsSummaryUnpriceable} that says why. The one place a surface's
 * "here is the store" becomes the engine's option.
 */
export function summaryPricing(
  pricing: ReportPricing | SyncMessage,
  refresh: RefreshMode,
): ListsSummaryPricing | ListsSummaryUnpriceable {
  return isSyncMessage(pricing) ? { unavailable: pricing } : { pricing, refresh }
}

/**
 * Why a summary was refused: a bad option (`options`), or the reason a
 * `value` sort cannot be priced (`prices` — a store that cannot price, see
 * {@link ListsSummaryUnpriceable}, or an empty card cache), which a surface
 * answers as a missing prerequisite (a 503, a runtime error) rather than a
 * bad request.
 */
export interface ListsSummaryRefusal {
  refused: 'options' | 'prices'
  reason: SyncMessage
}

/** `never` for a type declaring `refused`, which {@link isListsSummaryRefusal} would misread. */
type NoRefusedKey<T> = 'refused' extends keyof T ? never : object

/**
 * Whether a summary result is its refusal. The other member must declare no
 * `refused` (checked, as a compile error), so the discriminant can never
 * misread a success.
 */
export function isListsSummaryRefusal<T extends NoRefusedKey<T>>(
  result: T | ListsSummaryRefusal,
): result is ListsSummaryRefusal {
  return 'refused' in result
}

/** A bad option's refusal. */
function optionsRefusal(reason: SyncMessage): ListsSummaryRefusal {
  return { refused: 'options', reason }
}

/**
 * Which lists a summary covers, and how its rows come back. Every selection
 * filter is optional and they intersect: a list is summarized only when it
 * passes all of them. {@link parseListsSummaryOptions} validates and normalizes
 * them; {@link summarizeLists} runs it first, so a bad option is always refused.
 */
export interface ListsSummaryOptions {
  /** Only lists of this type. */
  listType?: ListType
  /**
   * Whitespace-separated terms that must all appear, in any order, in the
   * list's display name — matched as `get_list`'s `nameContains` matches card
   * names (case, diacritics and punctuation folded). Blank selects everything.
   */
  nameContains?: string
  /**
   * Only these lists; must name at least one. A ref of a type the other
   * filters leave out is skipped; a ref naming no list on disk is a warning.
   */
  lists?: readonly ListIdentity[]
  /** Only lists whose front-matter default labels include this one. */
  label?: CardLabel
  /** Whether lists with no entries (in their counted sections) are kept. Default `true`. */
  includeEmpty?: boolean
  /** Only decks of this format; collections and wanted lists never match. */
  format?: DeckFormatKey
  /**
   * **Decks only:** the sections (boards) that count toward a deck's row and the
   * totals, by exact, case-sensitive name — the markdown `## Section` heading,
   * matched the way `get_list`'s `section` matches it (`['Commander', 'Main']`
   * leaves out the Sideboard and Maybeboard). Absent means every section;
   * entries are trimmed, blanks dropped, and none at all is refused.
   * Collections and wanted lists are unaffected: their sections are binder
   * pages, not boards.
   */
  sections?: readonly string[]
  /**
   * Price each list at this store. Absent means no `value` anywhere; a store
   * whose prices cannot be had ({@link ListsSummaryUnpriceable}) leaves no
   * `value` either, and says why.
   */
  priced?: ListsSummaryPricing | ListsSummaryUnpriceable
  /**
   * Row order. `name` (the default) is ascending by display name; `quantity`
   * (copies) and `value` (priced total) are descending by default. `value`
   * needs `priced`.
   */
  sort?: ListsSummarySort
  /**
   * The direction, when not the sort's default: `true` descending, `false`
   * ascending. Ties always fall back to display name ascending.
   */
  descending?: boolean
  /** At most this many rows (a positive integer). Totals still describe the whole selection. */
  limit?: number
}

/** One selected list. */
export interface ListsSummaryRow {
  listType: ListType
  slug: string
  /** The list's display name: its `# Title`, else its slug. */
  name: string
  /**
   * Lines and copies, per section; a section with no lines is not listed
   * (as in `get_list`). For a deck given a `sections` selection, only the
   * counted sections appear and the totals are theirs.
   */
  counts: ListCounts
  /** The list's front-matter default card labels, when it declares any. */
  labels?: CardLabel[]
  description?: string
  /** The list's cover image override, when it declares a usable one. */
  image?: ListImageRef
  /** The deck's format, when it declares one. Decks only. */
  format?: DeckFormatKey
  /**
   * The list's priced totals, when the summary was priced and the list could
   * be. These are the price engine's totals — which, for a deck, already leave
   * out the extras boards (maybeboard, tokens) the way the sites' deck totals
   * do, so a deck's `value.cardCount` can be below its `counts.cardCount`. A
   * `sections` selection narrows the value to the counted sections as well.
   */
  value?: PriceTotals
}

/** Counts (and value, when priced) over a set of lists. */
export interface ListsSummaryTotals {
  listCount: number
  /** Lines across the lists' counted sections. */
  entryCount: number
  /** Copies across the lists' counted sections. */
  cardCount: number
  /**
   * Distinct card names across the lists' counted sections, with case and
   * whitespace folded. The count goes by how each line spells its name: two
   * spellings of one card that differ otherwise count twice.
   */
  distinctCardCount: number
  /** Priced totals over every priced entry, when the summary was priced. */
  value?: PriceTotals
}

/** {@link ListsSummaryTotals} for one list type. */
export interface ListsSummaryTypeTotals extends ListsSummaryTotals {
  listType: ListType
}

/**
 * A warning about the summary: a list that could not be (fully) read or
 * priced, a ref naming no list, or prices that could not be had. A list-level
 * warning names its list in `list`, so a total is never silently short and a
 * client can tell which row to distrust.
 */
export type ListsSummaryWarning = SyncMessage & Partial<Pick<ListWarning, 'list'>>

/** The cross-list summary. */
export interface ListsSummary {
  /** The selected lists, sorted and limited. */
  lists: ListsSummaryRow[]
  /** Totals over the whole selection — every selected list, not only the `limit`ed rows. */
  totals: ListsSummaryTotals
  /**
   * Totals per list type, in canonical type order, present only when the
   * selection holds more than one type (with one, it would repeat `totals`).
   * Like `totals`, these cover the whole selection.
   */
  typeTotals?: ListsSummaryTypeTotals[]
  /** The store the values come from, when the summary was priced. */
  source?: PriceSource
  /** The store's currency, when the summary was priced. */
  currency?: PriceCurrency
  warnings: ListsSummaryWarning[]
}

/**
 * The summary as the surfaces report it — the admin route, `summarize_lists`
 * and `lists --summary --output json` — plus, when it was priced, when its
 * prices were last refreshed (epoch ms, `null` when unknown; `pricesRefreshedAt`):
 * the Card Kingdom feed's download for `cardkingdom`, the card cache's last
 * bulk refresh for every other store.
 */
export type ListsSummaryPayload = ListsSummary & { lastRefreshedAt?: number | null }

/**
 * Summary options after {@link parseListsSummaryOptions}: validated, with every
 * default resolved, so the engine's steps read one settled value each.
 */
export interface ParsedListsSummaryOptions {
  listType?: ListType
  /** `nameContains` split into terms; empty selects every name. */
  nameTerms: string[]
  lists?: readonly ListIdentity[]
  label?: CardLabel
  includeEmpty: boolean
  format?: DeckFormatKey
  /** The counted deck sections, trimmed and non-empty; absent counts every section. */
  sections?: ReadonlySet<string>
  priced?: ListsSummaryPricing
  /** Why the store asked for cannot price: the summary's first warning. */
  unavailable?: SyncMessage
  sort: ListsSummarySort
  /** The resolved direction: the sort's default unless `descending` was given. */
  descending: boolean
  limit?: number
}

/** A `sections` option trimmed, blanks dropped. */
function countedSections(sections: readonly string[]): string[] {
  return sections.map((name) => name.trim()).filter((name) => name !== '')
}

/**
 * The option checks alone, before any store is resolved — so a surface that
 * has to load prices (a download, a feed) can refuse a bad option first.
 * `willPrice` says whether a store was asked for, which is all a `value`
 * sort's check needs to know. `undefined` when the options are acceptable.
 */
export function checkListsSummaryOptions(
  options: Omit<ListsSummaryOptions, 'priced'>,
  willPrice: boolean,
): ListsSummaryRefusal | undefined {
  const { limit, lists, sections } = options
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    return optionsRefusal(syncMessage('domain.list.summary.limitInvalid', { limit: String(limit) }))
  }
  if (lists !== undefined && lists.length === 0) {
    return optionsRefusal(syncMessage('domain.list.summary.listsEmpty'))
  }
  if (options.sort === 'value' && !willPrice) {
    return optionsRefusal(syncMessage('domain.list.summary.sortNeedsPricing'))
  }
  if (sections !== undefined && countedSections(sections).length === 0) {
    return optionsRefusal(syncMessage('domain.list.summary.sectionsEmpty'))
  }
  return undefined
}

/**
 * Validate and normalize summary options — the one check the admin route, the
 * CLI and {@link summarizeLists} itself share. Refused, as a message: a `limit`
 * that is not a positive integer, a `sections` with no non-blank name, an
 * empty `lists`, and a `value` sort without `priced` — or, as a `prices`
 * refusal, with a store that cannot price (its own reason).
 */
export function parseListsSummaryOptions(
  options: ListsSummaryOptions,
): ParsedListsSummaryOptions | ListsSummaryRefusal {
  const { limit, lists, priced } = options
  const refused = checkListsSummaryOptions(options, priced !== undefined)
  if (refused) return refused
  const sort = options.sort ?? 'name'
  if (sort === 'value' && priced !== undefined && 'unavailable' in priced) {
    return { refused: 'prices', reason: priced.unavailable }
  }
  const parsed: ParsedListsSummaryOptions = {
    nameTerms: splitNameTerms(options.nameContains ?? ''),
    includeEmpty: options.includeEmpty ?? true,
    sort,
    descending: options.descending ?? sort !== 'name',
  }
  if (options.sections !== undefined) parsed.sections = new Set(countedSections(options.sections))
  if (options.listType !== undefined) parsed.listType = options.listType
  if (lists !== undefined) parsed.lists = lists
  if (options.label !== undefined) parsed.label = options.label
  if (options.format !== undefined) parsed.format = options.format
  if (priced !== undefined) {
    if ('unavailable' in priced) parsed.unavailable = priced.unavailable
    else parsed.priced = priced
  }
  if (limit !== undefined) parsed.limit = limit
  return parsed
}

/**
 * Summarize the selected lists. Bad options are refused as a message rather
 * than thrown (see {@link parseListsSummaryOptions}). Prices that cannot be
 * had are not a refusal: a store that cannot price, an empty card cache, or a
 * list that fails to price leaves the counts in place with a warning — the
 * store's reason first. Only a `value` sort that cannot be priced is refused —
 * the store's reason, or the empty card cache's — as a `prices` refusal.
 */
export async function summarizeLists(
  input: ListsSummaryOptions = {},
): Promise<ListsSummary | ListsSummaryRefusal> {
  const options = parseListsSummaryOptions(input)
  if (isListsSummaryRefusal(options)) return options
  if (options.sort === 'value' && options.priced && (await cardCache.isEmpty())) {
    return { refused: 'prices', reason: syncMessage('domain.list.summary.cacheEmpty') }
  }

  const warnings: ListsSummaryWarning[] = options.unavailable ? [options.unavailable] : []
  const locations = await selectLocations(options, warnings)

  const selected: ReadList[] = []
  for (const location of locations) {
    const outcome = await readList(location, options.sections)
    if (!outcome.ok) {
      warnings.push(outcome.warning)
      continue
    }
    const { read } = outcome
    if (!matchesSelection(read.row, options)) continue
    selected.push(read)
    // Named per list, so a total is never silently short of a line the parser
    // could not read. Only the lines themselves: a fenced block is prose, which
    // a read-only summary does not lose.
    for (const warning of rewriteBlockingMessages(read.content.parse)) {
      warnings.push(listWarning('domain.list.summary.inList', read.row, warning))
    }
  }

  const priced = options.priced ? await priceRows(selected, options.priced, warnings) : undefined
  const types = LIST_TYPES.filter((type) => selected.some((read) => read.row.listType === type))
  const summary: ListsSummary = {
    lists: limitRows(sortRows(selected, options), options.limit),
    totals: totalsOf(selected, priced !== undefined),
    warnings,
  }
  if (types.length > 1) {
    summary.typeTotals = types.map((listType): ListsSummaryTypeTotals => ({
      listType,
      ...totalsOf(
        selected.filter((read) => read.row.listType === listType),
        priced !== undefined,
      ),
    }))
  }
  if (priced) {
    summary.source = priced.source
    summary.currency = priced.currency
  }
  return summary
}

/** A summary row found by its list's identity. */
export function findSummaryRow(
  rows: readonly ListsSummaryRow[],
  { listType, slug }: ListIdentity,
): ListsSummaryRow | undefined {
  return rows.find((row) => row.listType === listType && row.slug === slug)
}

/** A summary's rows grouped by list type, in canonical type order. */
export interface ListsSummaryTypeGroup {
  listType: ListType
  rows: ListsSummaryRow[]
}

/**
 * The rows grouped by type (canonical order; a type with no rows is omitted),
 * each group keeping the rows' order — the shape a menu of lists grouped by
 * type (the interactive price browser's main screen) reads.
 */
export function groupRowsByType(rows: readonly ListsSummaryRow[]): ListsSummaryTypeGroup[] {
  return LIST_TYPES.flatMap((listType): ListsSummaryTypeGroup[] => {
    const ofType = rows.filter((row) => row.listType === listType)
    return ofType.length === 0 ? [] : [{ listType, rows: ofType }]
  })
}

/** A list read for the summary, before filtering, sorting and pricing. */
interface ReadList {
  row: ListsSummaryRow
  location: ListLocation
  /**
   * The one parse of the file: the row's counts and metadata were read from
   * it, and pricing reads it too, so a value cannot drift from the counts.
   */
  content: ParsedListContent
  /** Card names in the counted sections, folded. */
  names: Set<string>
  /** The priced entries in the counted sections, once the list is priced. */
  pricedEntries?: PricedEntry[]
}

/** One list's read, or the warning explaining why it could not be read. */
type ReadOutcome = { ok: true; read: ReadList } | { ok: false; warning: ListsSummaryWarning }

/** The store and currency a priced summary reports. */
interface PricedSelection {
  source: PriceSource
  currency: PriceCurrency
}

/**
 * The candidate files: the type, format and explicit-ref filters, applied
 * before any file is read. A ref naming no list on disk is a warning.
 */
async function selectLocations(
  options: ParsedListsSummaryOptions,
  warnings: ListsSummaryWarning[],
): Promise<ListLocation[]> {
  // A format can only ever match a deck, so no other type is read for one.
  if (options.format !== undefined && options.listType !== undefined) {
    if (options.listType !== 'deck') return []
  }
  const type = options.format !== undefined ? 'deck' : options.listType
  const all = await listLocations(type)
  if (options.lists === undefined) return all

  const byKey = new Map(
    all.map((location): [string, ListLocation] => [
      listIdentityKey(listIdentityOf(location)),
      location,
    ]),
  )
  const chosen: ListLocation[] = []
  for (const ref of uniqueListIdentities(options.lists)) {
    const location = byKey.get(listIdentityKey(ref))
    if (location) {
      chosen.push(location)
      continue
    }
    // A ref of a type the other filters leave out is simply not selected; only
    // a ref naming no list at all is worth a word.
    if (type !== undefined && ref.listType !== type) continue
    warnings.push({
      ...syncMessage('domain.list.summary.notFound', { listType: ref.listType, slug: ref.slug }),
      list: { listType: ref.listType, slug: ref.slug },
    })
  }
  return chosen
}

/** The filters that need the file read: name, label, format, emptiness. */
function matchesSelection(row: ListsSummaryRow, options: ParsedListsSummaryOptions): boolean {
  const { nameTerms } = options
  if (nameTerms.length > 0 && !matchesNameTerms(normalizeCardName(row.name), nameTerms)) {
    return false
  }
  if (options.label !== undefined && !(row.labels ?? []).includes(options.label)) return false
  if (options.format !== undefined && row.format !== options.format) return false
  if (!options.includeEmpty && row.counts.entryCount === 0) return false
  return true
}

/** Read one list file once, and build its row from that one parse. */
async function readList(
  location: ListLocation,
  sections: ReadonlySet<string> | undefined,
): Promise<ReadOutcome> {
  let content: ParsedListContent
  try {
    content = parseListContent(
      location.type,
      await fs.readFile(location.filePath, 'utf-8'),
      location.filePath,
    )
  } catch (error) {
    if (!isExpectedListReadFailure(error)) throw error
    const { listType, slug } = listIdentityOf(location)
    // A file that cannot be parsed at all (unreadable deck front matter) is left
    // out — and said so, rather than counted as empty. It has no title to go
    // by, so the warning names it by its slug.
    const named: NamedListIdentity = { listType, slug, name: slug }
    return {
      ok: false,
      warning: listWarning('domain.list.summary.unreadable', named, errorMessage(error)),
    }
  }
  return { ok: true, read: { location, content, ...rowOf(content, sections) } }
}

/** A row and its counted names, from a list's parse. */
type RowRead = Pick<ReadList, 'row' | 'names'>

function rowOf(content: ParsedListContent, sections: ReadonlySet<string> | undefined): RowRead {
  const identity: NamedListIdentity = {
    listType: content.type,
    slug: content.slug,
    name: content.name,
  }
  switch (content.type) {
    case 'deck': {
      const { parse, frontMatter } = content
      const counted: DeckSection[] = parse.deck.sections.filter(
        (section) =>
          section.cards.length > 0 && (sections === undefined || sections.has(section.name)),
      )
      const row: ListsSummaryRow = { ...identity, counts: countDeck({ sections: counted }) }
      if (frontMatter.labels !== undefined) row.labels = frontMatter.labels
      if (parse.deck.description !== undefined) row.description = parse.deck.description
      if (frontMatter.image !== undefined) row.image = frontMatter.image
      if (frontMatter.format !== undefined) row.format = frontMatter.format
      const names = counted.flatMap((section) => section.cards.map((card) => card.name))
      return { row, names: foldedCardNameSet(names) }
    }
    case 'collection': {
      const row = flatRow(identity, content.parse)
      if (content.parse.labels !== undefined) row.labels = content.parse.labels
      return { row, names: foldedCardNameSet(content.parse.entries.map((entry) => entry.name)) }
    }
    case 'wanted':
      // A wanted list declares no default labels.
      return {
        row: flatRow(identity, content.parse),
        names: foldedCardNameSet(content.parse.entries.map((entry) => entry.name)),
      }
  }
}

/** The fields a flat list's row reads from its parse. */
type FlatParse = {
  entries: readonly FlatEntry[]
  frontMatter?: FlatListFrontMatter
}

/** What a flat list's count reads off each entry. */
type FlatEntry = { section: string; quantity: number }

/** A flat list's row: counts plus the front matter's description and cover. */
function flatRow(
  identity: Pick<ListsSummaryRow, 'listType' | 'slug' | 'name'>,
  parse: FlatParse,
): ListsSummaryRow {
  const row: ListsSummaryRow = {
    ...identity,
    counts: countEntries(
      parse.entries,
      (entry) => entry.section,
      (entry) => entry.quantity,
    ),
  }
  // Advisories about an unusable value are not the summary's to report: the
  // block round-trips, and nothing it counts is lost.
  const { description, image } = readFlatListMetadata(parse.frontMatter?.data ?? {})
  if (description !== undefined) row.description = description
  if (image !== undefined) row.image = image
  return row
}

/**
 * Price each selected list from the parse it was counted from, and set its
 * row's `value`. Lists are priced one build each, so one list's failure costs
 * only its own value; the builds share one per-name memo, so a card several
 * lists hold is looked up and picked once. An empty card cache leaves every
 * row unpriced and says so; a list whose art sidecar is unreadable is priced
 * without its custom art, and a list that fails to price is left unpriced —
 * each with a warning, never a refusal, because the counts do not need prices.
 */
async function priceRows(
  selected: readonly ReadList[],
  priced: ListsSummaryPricing,
  warnings: ListsSummaryWarning[],
): Promise<PricedSelection | undefined> {
  if (await cardCache.isEmpty()) {
    warnings.push(syncMessage('domain.list.summary.cacheEmpty'))
    return undefined
  }
  const memo = createNamePricingMemo(priced.pricing)
  for (const read of selected) {
    const art = await loadListArtOrWarn(read.location.filePath, (cause) => {
      warnings.push(listWarning('domain.list.summary.artUnreadable', read.row, cause))
    })
    try {
      const { report } = await buildPriceReportFromInputs(
        [priceListInput(read.content, art)],
        priced.pricing,
        { refresh: priced.refresh, memo },
      )
      read.pricedEntries = countedEntries(read, report.entries)
      read.row.value = sumPricedEntries(read.pricedEntries)
    } catch (error) {
      warnings.push(listWarning('domain.list.summary.priceFailed', read.row, errorMessage(error)))
    }
  }
  const { source } = priced.pricing
  return { source, currency: sourceCurrency(source) }
}

/** A list's priced entries in its counted sections (decks only narrow). */
function countedEntries(read: ReadList, entries: readonly PricedEntry[]): PricedEntry[] {
  const counted = read.row.listType === 'deck' ? read.row.counts.sections : undefined
  if (counted === undefined) return [...entries]
  const names = new Set(counted.map((section) => section.name))
  return entries.filter((entry) => names.has(entry.section))
}

/** Totals over a set of read lists; `value` only when the summary was priced. */
function totalsOf(reads: readonly ReadList[], priced: boolean): ListsSummaryTotals {
  const names = new Set<string>()
  for (const read of reads) for (const name of read.names) names.add(name)
  const totals: ListsSummaryTotals = {
    listCount: reads.length,
    entryCount: reads.reduce((sum, read) => sum + read.row.counts.entryCount, 0),
    cardCount: reads.reduce((sum, read) => sum + read.row.counts.cardCount, 0),
    distinctCardCount: names.size,
  }
  if (priced) totals.value = sumPricedEntries(reads.flatMap((read) => read.pricedEntries ?? []))
  return totals
}

/** Display name ascending, then slug, then canonical type order: a total order. */
function compareByName(a: ListsSummaryRow, b: ListsSummaryRow): number {
  return (
    compareDisplay(a.name, b.name) ||
    compareData(a.slug, b.slug) ||
    LIST_TYPES.indexOf(a.listType) - LIST_TYPES.indexOf(b.listType)
  )
}

/**
 * The sort's key: copies for `quantity`, priced total for `value` (an unpriced
 * row has the smallest key, so it sorts after every priced one by default).
 */
function sortKey(row: ListsSummaryRow, sort: Exclude<ListsSummarySort, 'name'>): number {
  if (sort === 'quantity') return row.counts.cardCount
  return row.value?.total ?? Number.NEGATIVE_INFINITY
}

/**
 * Order rows: `name` ascending, `quantity` and `value` descending by default
 * (ties by name ascending); `descending` overrides the direction.
 */
function sortRows(
  reads: readonly ReadList[],
  options: ParsedListsSummaryOptions,
): ListsSummaryRow[] {
  const { sort } = options
  const direction = options.descending ? -1 : 1
  return reads
    .map((read) => read.row)
    .sort((a, b) => {
      if (sort === 'name') return direction * compareByName(a, b)
      const byKey = sortKey(a, sort) - sortKey(b, sort)
      // `-Infinity - -Infinity` is NaN: two unpriced rows tie on the key.
      const keyOrder = Number.isNaN(byKey) ? 0 : byKey
      return direction * keyOrder || compareByName(a, b)
    })
}

function limitRows(rows: ListsSummaryRow[], limit: number | undefined): ListsSummaryRow[] {
  return limit === undefined ? rows : rows.slice(0, limit)
}
