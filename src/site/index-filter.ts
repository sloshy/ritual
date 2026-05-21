import type { DeckSummary } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { getSummaryLowestPrice, getSummaryTotalPrice } from './utils'
import { getDeckFormatLabel } from '../deck-format'

export type IndexSort = 'alpha' | 'recent' | 'price' | 'lowestPrice'
export type IndexGroup = 'none' | 'format'

export const DEFAULT_INDEX_SORT: IndexSort = 'alpha'
export const DEFAULT_INDEX_GROUP: IndexGroup = 'none'

export interface IndexSortOption {
  value: IndexSort
  label: string
}

export interface IndexGroupOption {
  value: IndexGroup
  label: string
}

export const INDEX_SORT_OPTIONS: IndexSortOption[] = [
  { value: 'alpha', label: 'Alphabetical' },
  { value: 'recent', label: 'Recently updated' },
  { value: 'price', label: 'Current price' },
  { value: 'lowestPrice', label: 'Lowest price' },
]

/**
 * Sort options for the collection and wanted-list index tabs. "Lowest price"
 * (the cheapest-printing-per-card total) only makes sense for decks, so it is
 * omitted here.
 */
export const LIST_SORT_OPTIONS: IndexSortOption[] = INDEX_SORT_OPTIONS.filter(
  (o) => o.value !== 'lowestPrice',
)

export const INDEX_GROUP_OPTIONS: IndexGroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'format', label: 'Format' },
]

/**
 * Narrow a raw `<select>` value to the sort union, falling back to the default.
 * Validates against `options` (defaulting to the full set) so a toolbar that
 * only offers a subset — e.g. the collection/wanted tabs without "Lowest price"
 * — never yields a value outside what it shows.
 */
export function parseIndexSort(
  raw: string,
  options: readonly IndexSortOption[] = INDEX_SORT_OPTIONS,
): IndexSort {
  return options.find((o) => o.value === raw)?.value ?? DEFAULT_INDEX_SORT
}

/** Narrow a raw `<select>` value to the group union, falling back to the default. */
export function parseIndexGroup(raw: string): IndexGroup {
  return INDEX_GROUP_OPTIONS.find((o) => o.value === raw)?.value ?? DEFAULT_INDEX_GROUP
}

/**
 * The fields any index summary (deck, collection, or wanted list) must expose
 * to be sortable by the shared toolbar. Decks, collections, and wanted lists
 * all carry a name, a last-updated timestamp, and per-currency total/lowest
 * prices, so the same comparison logic serves every index tab.
 */
export interface SortableSummary {
  name: string
  lastUpdatedAt?: string
  totalPrice?: number
  totalPriceEur?: number
  totalPriceTix?: number
  lowestPrice?: number
  lowestPriceEur?: number
  lowestPriceTix?: number
}

const ALPHA_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' })

function assertNever(value: never): never {
  throw new Error(`Unhandled sort value: ${String(value)}`)
}

function compareSummaries(
  a: SortableSummary,
  b: SortableSummary,
  sort: IndexSort,
  currency: PriceCurrency,
): number {
  switch (sort) {
    case 'alpha':
      return ALPHA_COLLATOR.compare(a.name, b.name)
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
      return getSummaryTotalPrice(b, currency) - getSummaryTotalPrice(a, currency)
    case 'lowestPrice':
      return getSummaryLowestPrice(b, currency) - getSummaryLowestPrice(a, currency)
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
  currency: PriceCurrency,
  reverse: boolean,
): T[] {
  const out = items.slice()
  out.sort((a, b) => compareSummaries(a, b, sort, currency))
  if (reverse) out.reverse()
  return out
}

export interface DeckGroup {
  /** Stable key used for keyed rendering. */
  key: string
  /** Display label for the group header. */
  label: string
  decks: DeckSummary[]
}

const UNKNOWN_FORMAT_KEY = '__no-format__'
const UNKNOWN_FORMAT_LABEL = 'Other'

/**
 * Partition decks into groups by format, preserving the input order within
 * each group (callers should sort beforehand). Group ordering matches first
 * appearance — `Map` iteration order is insertion order — with the "Other"
 * bucket (decks without a detected format) always last.
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
      label: deck.format ? getDeckFormatLabel(deck.format) : UNKNOWN_FORMAT_LABEL,
      decks: [deck],
    })
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.key === UNKNOWN_FORMAT_KEY) return 1
    if (b.key === UNKNOWN_FORMAT_KEY) return -1
    return 0
  })
}
