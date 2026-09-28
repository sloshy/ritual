import type { ListType } from '../list/list-type'
import type { PriceSource } from './price-source'

/**
 * Whether a list of this type ever marks its totals "Est.". Only decks and
 * wanted lists do: every collection line pins its printing, and a collection
 * card with no price is reported by the missing-price count alone.
 */
export function listTypeEstimatesPrices(type: ListType): boolean {
  return type !== 'collection'
}

/**
 * The field-name suffix each store's baked summary figures carry: TCGplayer's
 * are the unsuffixed USD fields (the original, single-store shape), and the
 * others are named for their currency or, for the second USD store, the store.
 */
const SOURCE_FIELD_SUFFIX = {
  tcgplayer: '',
  cardmarket: 'Eur',
  cardhoarder: 'Tix',
  cardkingdom: 'CardKingdom',
} as const satisfies Record<PriceSource, string>

type SourceFieldSuffix = (typeof SOURCE_FIELD_SUFFIX)[PriceSource]

/** A summary's per-store figures for one base metric (`totalPrice`, `lowestPrice`, …). */
export type PriceViewFields<Base extends string> = {
  [K in `${Base}${SourceFieldSuffix}`]?: number
}

/** One base metric read at a store; 0 when the summary carries no figure for it. */
function summaryValue<Base extends string>(
  item: PriceViewFields<Base>,
  base: Base,
  source: PriceSource,
): number {
  const key: `${Base}${SourceFieldSuffix}` = `${base}${SOURCE_FIELD_SUFFIX[source]}`
  return item[key] ?? 0
}

export function getSummaryTotalPrice(
  item: PriceViewFields<'totalPrice'>,
  source: PriceSource,
): number {
  return summaryValue(item, 'totalPrice', source)
}

export function getSummaryLowestPrice(
  item: PriceViewFields<'lowestPrice'>,
  source: PriceSource,
): number {
  return summaryValue(item, 'lowestPrice', source)
}

export function getSummaryMissingPriceCount(
  item: PriceViewFields<'missingPriceCount'>,
  source: PriceSource,
): number {
  return summaryValue(item, 'missingPriceCount', source)
}

export function getSummaryEstimatedPriceCount(
  item: PriceViewFields<'estimatedPriceCount'>,
  source: PriceSource,
): number {
  return summaryValue(item, 'estimatedPriceCount', source)
}
