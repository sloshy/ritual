/**
 * A list summary's per-store price figures, computed once for every list type.
 *
 * Each builder records its counted lines as it walks the list, then sums them
 * here per store — after the detail's buylist quotes are baked, so Card
 * Kingdom prices from the very quotes the page reads — and writes the summary
 * fields through the table the readers use (`summaryPriceField`). A new store
 * or metric is one change here, not one per builder.
 */

import { summaryPriceField, type PriceViewFields } from '../pricing/price-summary'
import { scryfallSourceFor, type PriceSource } from '../pricing/price-source'
import { getCardPrice, getCardPriceForFinish, type PriceCurrency } from '../pricing/price-currency'
import { displayFinish, type Finish } from '../card/finish-condition'
import type { CardLanguage } from '../card/card-language'
import type { ScryfallCard } from '../scryfall/types'
import type { BakedBuylist } from '../list/site-data'
import { bakedCardKingdomRetail } from './shared'

/** One store's running totals over a list's counted lines. */
export type StorePriceTotals = {
  total: number
  /** Decks only: every line at its cheapest printing (the "Lowest Price" figure). */
  lowest: number
  /** Copies with no price from this store. */
  missing: number
  /** Copies whose price is an estimate: no pinned printing, or no price. */
  estimated: number
}

/** What every counted line carries, whatever its list type. */
export type PricedLine = {
  quantity: number
  /** Whether the line names its printing; an unpinned line's price is an estimate. */
  pinned: boolean
}

/** How one store prices a list's lines. */
export type StoreLinePricing<Line extends PricedLine> = {
  source: PriceSource
  /** The unit price this store shows for the line; 0 when it has none. */
  price: (line: Line) => number
  /** The line at its cheapest printing (decks' "Lowest Price" toggle), when the list has one. */
  lowest?: (line: Line) => number
}

/** Sum a list's counted lines per store. */
export function sumStorePrices<Line extends PricedLine>(
  lines: readonly Line[],
  stores: readonly StoreLinePricing<Line>[],
): Map<PriceSource, StorePriceTotals> {
  const totals = new Map<PriceSource, StorePriceTotals>()
  for (const store of stores) {
    const sum: StorePriceTotals = { total: 0, lowest: 0, missing: 0, estimated: 0 }
    for (const line of lines) {
      const price = store.price(line)
      sum.total += price * line.quantity
      if (store.lowest) sum.lowest += store.lowest(line) * line.quantity
      if (price === 0) sum.missing += line.quantity
      if (!line.pinned || price === 0) sum.estimated += line.quantity
    }
    totals.set(store.source, sum)
  }
  return totals
}

/** The summary field each {@link StorePriceTotals} metric is baked under. */
const METRIC_FIELDS = {
  total: 'totalPrice',
  lowest: 'lowestPrice',
  missing: 'missingPriceCount',
  estimated: 'estimatedPriceCount',
} as const satisfies Record<keyof StorePriceTotals, string>

type MetricField<Metric extends keyof StorePriceTotals> = (typeof METRIC_FIELDS)[Metric]

/**
 * The summary fields for the chosen metrics, one per store summed (`totalPrice`,
 * `totalPriceEur`, `totalPriceCardKingdom`, …). A store that was not summed —
 * one the site does not offer — writes nothing.
 */
export function summaryPriceFields<Metric extends keyof StorePriceTotals>(
  totals: ReadonlyMap<PriceSource, StorePriceTotals>,
  metrics: readonly Metric[],
): PriceViewFields<MetricField<Metric>> {
  const fields: PriceViewFields<MetricField<Metric>> = {}
  for (const [source, sum] of totals) {
    for (const metric of metrics) {
      fields[summaryPriceField(METRIC_FIELDS[metric], source)] = sum[metric]
    }
  }
  return fields
}

/** A name-only wanted entry's cheapest printing in each currency. */
export type CheapestByCurrency = Partial<Record<PriceCurrency, ScryfallCard | null>>

/** One counted flat-list (collection or wanted) entry, for the summary's per-store totals. */
export type FlatSummaryLine = PricedLine & {
  /** The printing the entry displays: its pin, else a name-only entry's pick. */
  card: ScryfallCard | null
  /**
   * A name-only wanted entry's per-currency cheapest printings, each priced at
   * its base price; absent for an entry that names its printing, which prices
   * at that printing and its finish.
   */
  cheapest?: CheapestByCurrency
  /** The entry's own `[finish]` token; absent reads as the printing's default. */
  finish?: Finish
  language?: CardLanguage
  /** The printing the Card Kingdom view shows: the pin, else CK's own pick. */
  ckCard: ScryfallCard | null
}

/**
 * How each store the site offers prices a flat list's entries: the Scryfall
 * store of every baked currency, plus Card Kingdom — read off the detail's
 * baked quotes — when the site offers it.
 */
export function flatListStores(
  currencies: readonly PriceCurrency[],
  buylist: BakedBuylist | undefined,
  offersCardKingdom: boolean,
): StoreLinePricing<FlatSummaryLine>[] {
  const stores = currencies.map((currency): StoreLinePricing<FlatSummaryLine> => ({
    source: scryfallSourceFor(currency),
    price: (line) => {
      if (line.cheapest) {
        const card = line.cheapest[currency] ?? line.card
        return card ? getCardPrice(card, currency) : 0
      }
      return line.card
        ? getCardPriceForFinish(line.card, displayFinish(line.card, line.finish), currency)
        : 0
    },
  }))
  if (offersCardKingdom) {
    stores.push({
      source: 'cardkingdom',
      price: (line) => bakedCardKingdomRetail(buylist, line.ckCard, line.finish, line.language),
    })
  }
  return stores
}
