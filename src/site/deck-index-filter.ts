import type { DeckSummary } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { getSummaryLowestPrice, getSummaryTotalPrice } from './utils'
import { getDeckFormatLabel } from '../deck-format'

export type DeckIndexSort = 'alpha' | 'recent' | 'price' | 'lowestPrice'
export type DeckIndexGroup = 'none' | 'format'

export const DEFAULT_DECK_INDEX_SORT: DeckIndexSort = 'alpha'
export const DEFAULT_DECK_INDEX_GROUP: DeckIndexGroup = 'none'

export interface DeckIndexSortOption {
  value: DeckIndexSort
  label: string
}

export interface DeckIndexGroupOption {
  value: DeckIndexGroup
  label: string
}

export const DECK_INDEX_SORT_OPTIONS: DeckIndexSortOption[] = [
  { value: 'alpha', label: 'Alphabetical' },
  { value: 'recent', label: 'Recently updated' },
  { value: 'price', label: 'Current price' },
  { value: 'lowestPrice', label: 'Lowest price' },
]

export const DECK_INDEX_GROUP_OPTIONS: DeckIndexGroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'format', label: 'Format' },
]

/** Narrow a raw `<select>` value to the sort union, falling back to the default. */
export function parseDeckIndexSort(raw: string): DeckIndexSort {
  return DECK_INDEX_SORT_OPTIONS.find((o) => o.value === raw)?.value ?? DEFAULT_DECK_INDEX_SORT
}

/** Narrow a raw `<select>` value to the group union, falling back to the default. */
export function parseDeckIndexGroup(raw: string): DeckIndexGroup {
  return DECK_INDEX_GROUP_OPTIONS.find((o) => o.value === raw)?.value ?? DEFAULT_DECK_INDEX_GROUP
}

const ALPHA_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' })

function assertNever(value: never): never {
  throw new Error(`Unhandled sort value: ${String(value)}`)
}

function compareDecks(
  a: DeckSummary,
  b: DeckSummary,
  sort: DeckIndexSort,
  currency: PriceCurrency,
): number {
  switch (sort) {
    case 'alpha':
      return ALPHA_COLLATOR.compare(a.name, b.name)
    case 'recent': {
      // Most recent first by default. Decks without a timestamp sort last.
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
 * Sort decks by the chosen criterion using a stable sort, then optionally
 * reverse. Does not mutate the input array.
 */
export function sortDecks(
  decks: readonly DeckSummary[],
  sort: DeckIndexSort,
  currency: PriceCurrency,
  reverse: boolean,
): DeckSummary[] {
  const out = decks.slice()
  out.sort((a, b) => compareDecks(a, b, sort, currency))
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
