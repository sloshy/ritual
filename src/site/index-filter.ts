import type { DeckSummary } from '../list/site-data'
import { compareDisplayBase } from '../i18n/collate'
import type { MessageKey } from '../i18n/messages/en'
import type { ParameterlessKey } from '../i18n/t'
import type { PriceSource } from '../pricing/price-source'
import { getSummaryTotalPrice, type PriceViewFields } from '../pricing/price-summary'
import { deckFormatLabelKey } from '../list/deck-format'
import { assertNever } from '../util/assert-never'

export type IndexSort = 'alpha' | 'recent' | 'price'
export type IndexGroup = 'none' | 'format'

export const DEFAULT_INDEX_SORT: IndexSort = 'alpha'
export const DEFAULT_INDEX_GROUP: IndexGroup = 'none'

/**
 * A row of an index toolbar dropdown. `label` is a {@link MessageKey}, not
 * rendered text: these tables are built once at module load, so a table of
 * strings would leave the dropdowns in the boot-time language after a locale
 * switch. `value` stays an English slug — it is what the URL carries.
 *
 * The tables below are `as const`, and the exported option types are derived
 * from them, so a consumer's `t(option.label)` keeps the literal key type and
 * stays a compile-time-checked call rather than an untyped lookup.
 */
type IndexSortOptionShape = {
  value: IndexSort
  label: MessageKey
}

type IndexGroupOptionShape = {
  value: IndexGroup
  label: MessageKey
}

export const INDEX_SORT_OPTIONS = [
  { value: 'alpha', label: 'site.index.sortAlphabetical' },
  { value: 'recent', label: 'site.index.sortRecent' },
  { value: 'price', label: 'site.index.sortPrice' },
] as const satisfies readonly IndexSortOptionShape[]

export const INDEX_GROUP_OPTIONS = [
  { value: 'none', label: 'site.index.groupNone' },
  { value: 'format', label: 'site.index.groupFormat' },
] as const satisfies readonly IndexGroupOptionShape[]

export type IndexGroupOption = (typeof INDEX_GROUP_OPTIONS)[number]

/** Narrow a raw `<select>` value to the sort union, falling back to the default. */
export function parseIndexSort(raw: string): IndexSort {
  return INDEX_SORT_OPTIONS.find((o) => o.value === raw)?.value ?? DEFAULT_INDEX_SORT
}

/** Narrow a raw `<select>` value to the group union, falling back to the default. */
export function parseIndexGroup(raw: string): IndexGroup {
  return INDEX_GROUP_OPTIONS.find((o) => o.value === raw)?.value ?? DEFAULT_INDEX_GROUP
}

/**
 * The fields any index summary (deck, collection, or wanted list) must expose
 * to be sortable by the shared toolbar: a name, a last-updated timestamp, and
 * per-store totals, so the same comparison logic serves every index tab.
 */
export interface SortableSummary extends PriceViewFields<'totalPrice'> {
  name: string
  lastUpdatedAt?: string
}

function compareSummaries(
  a: SortableSummary,
  b: SortableSummary,
  sort: IndexSort,
  source: PriceSource,
): number {
  switch (sort) {
    case 'alpha':
      // Was a bare `new Intl.Collator(undefined, …)`, which follows whatever
      // locale the host browser happens to have — the same index could sort two
      // ways on two machines. It now follows the *UI* locale explicitly.
      return compareDisplayBase(a.name, b.name)
    case 'recent': {
      // Most recent first by default. Items without a timestamp sort last.
      const aT = a.lastUpdatedAt
      const bT = b.lastUpdatedAt
      if (aT === bT) return 0
      if (!aT) return 1
      if (!bT) return -1
      return aT < bT ? 1 : -1
    }
    case 'price':
      return getSummaryTotalPrice(b, source) - getSummaryTotalPrice(a, source)
    default:
      return assertNever(sort)
  }
}

/**
 * Sort index summaries by the chosen criterion using a stable sort, then
 * optionally reverse. Does not mutate the input array.
 */
export function sortSummaries<T extends SortableSummary>(
  items: readonly T[],
  sort: IndexSort,
  source: PriceSource,
  reverse: boolean,
): T[] {
  const out = items.slice()
  out.sort((a, b) => compareSummaries(a, b, sort, source))
  if (reverse) out.reverse()
  return out
}

export interface DeckGroup {
  /** Stable key used for keyed rendering. */
  key: string
  /**
   * The catalog key of the group header: the format's name, or
   * `site.index.otherFormat` for the bucket of decks with no detected format.
   * A key rather than text: the view renders it, so the heading follows a
   * language switch instead of freezing in the language it was grouped in.
   */
  labelKey: ParameterlessKey
  decks: DeckSummary[]
}

const UNKNOWN_FORMAT_KEY = '__no-format__'

/**
 * Partition decks into groups by format, preserving the input order within
 * each group (callers should sort beforehand). Group ordering matches first
 * appearance — `Map` iteration order is insertion order — with the bucket of
 * decks without a detected format always last.
 */
export function groupDecksByFormat(decks: readonly DeckSummary[]): DeckGroup[] {
  const byKey = new Map<string, DeckGroup>()
  for (const deck of decks) {
    const key = deck.format ?? UNKNOWN_FORMAT_KEY
    const existing = byKey.get(key)
    if (existing) {
      existing.decks.push(deck)
      continue
    }
    byKey.set(key, {
      key,
      labelKey: deck.format ? deckFormatLabelKey(deck.format) : 'site.index.otherFormat',
      decks: [deck],
    })
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.key === UNKNOWN_FORMAT_KEY) return 1
    if (b.key === UNKNOWN_FORMAT_KEY) return -1
    return 0
  })
}
