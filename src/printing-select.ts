/**
 * Choosing *which printing* of a card to show and price, parameterized by who
 * is doing the pricing.
 *
 * A card line that names no printing still has to be displayed as one, so a
 * printing is picked for it: a representative (recent, mid-priced) one, and —
 * for the "Lowest Price" view — the cheapest one. Both picks must be made with
 * the prices of the store that will then quote them, or the pick lands on a
 * printing that store does not sell and the card reads as unpriced. That is why
 * these take a pricing function rather than a currency: Scryfall's price fields
 * go through `computeRepresentativePrints`, Card Kingdom's retail feed through
 * `src/cardkingdom/retail.ts`, and the algorithm is shared.
 *
 * A dependency-free leaf on purpose. `src/scryfall/client.ts` sits in an import
 * cycle with the cache and config modules, so a consumer that wanted only the
 * selection rule had to pull the whole Scryfall barrel (and its
 * client-instantiating side effects) to get it.
 */

import { cardPrintingKey } from './printing-key'
import { printingFinishes } from './finish-condition'
import type { Finish, ScryfallCard } from './types'

/**
 * What one printing costs, in whatever the caller is pricing in. 0 (or any
 * non-positive number) means "no price here" — an unpriced printing, or a store
 * that does not carry it at all.
 */
export type PrintingPriceFn = (card: ScryfallCard) => number

/**
 * {@link PrintingPriceFn} for a specific finish. A store sells a foil as its own
 * product at its own price, so the cheapest-copy question is asked per
 * printing+finish while the representative question — asked per card name,
 * before any line's finish is known — is not.
 */
export type FinishPriceFn = (card: ScryfallCard, finish: Finish) => number

/** The cheapest printing+finish found, and what it costs. */
export type CheapestPrintingResult = {
  price: number
  card: ScryfallCard
  finish: Finish
}

/** No printings barred — shared, so the common default costs no allocation. */
export const NO_BANNED_PRINTINGS: ReadonlySet<string> = new Set()

/** How many recent printings the representative pick considers. */
const REPRESENTATIVE_CANDIDATES = 5

/**
 * Pick the representative printing out of a newest-first printing list: among
 * the {@link REPRESENTATIVE_CANDIDATES} most recent priced printings, the newest
 * one that is not priced far above their median. The recency bias is the point
 * — a card's "default" printing should be one a player can actually buy today —
 * and the median guard is what keeps a recent serialized or borderless chase
 * printing from becoming it.
 *
 * A printing `priceOf` answers 0 for is not a candidate, which is what makes
 * "this store does not carry this printing" and "this printing has no price"
 * the same, correct answer: skip it.
 *
 * @param bannedPrintings - `set:collectorNumber` keys (set code lowercased) that
 *   must never be chosen; the selection slides to the next eligible printing.
 */
export function selectRepresentativePrinting(
  recentPrintings: readonly ScryfallCard[],
  priceOf: PrintingPriceFn,
  bannedPrintings: ReadonlySet<string> = NO_BANNED_PRINTINGS,
): ScryfallCard | null {
  type Candidate = { card: ScryfallCard; price: number }
  const candidates: Candidate[] = []
  for (const card of recentPrintings) {
    if (candidates.length >= REPRESENTATIVE_CANDIDATES) break
    if (bannedPrintings.has(cardPrintingKey(card))) continue
    const price = priceOf(card)
    if (Number.isFinite(price) && price > 0) candidates.push({ card, price })
  }
  if (candidates.length === 0) return null

  const sorted = [...candidates].sort((a, b) => a.price - b.price)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 1 ? sorted[mid]!.price : (sorted[mid - 1]!.price + sorted[mid]!.price) / 2
  return candidates.find((c) => c.price <= median * 1.5)?.card ?? null
}

/**
 * The cheapest printing under one pricing function, judged at whatever finish
 * `priceOf` reads — the counterpart of {@link selectRepresentativePrinting} for
 * a display surface, which shows a printing rather than a printing+finish.
 *
 * Use {@link selectCheapestPrintingFinish} where the finish travels with the
 * answer (a price report quotes it; a card tile re-derives it from the line).
 */
export function selectCheapestPrinting(
  printings: readonly ScryfallCard[],
  priceOf: PrintingPriceFn,
): ScryfallCard | null {
  let cheapest: ScryfallCard | null = null
  let minPrice = Infinity
  for (const card of printings) {
    const price = priceOf(card)
    if (Number.isFinite(price) && price > 0 && price < minPrice) {
      minPrice = price
      cheapest = card
    }
  }
  return cheapest
}

/**
 * The cheapest printing *and finish* under one pricing function. Candidate
 * finishes come from {@link printingFinishes} rather than raw `card.finishes`,
 * so a finish Ritual doesn't model can't be quoted at the nonfoil price under
 * its own name.
 */
export function selectCheapestPrintingFinish(
  printings: readonly ScryfallCard[],
  priceOf: FinishPriceFn,
): CheapestPrintingResult | null {
  let best: CheapestPrintingResult | null = null
  for (const card of printings) {
    for (const finish of printingFinishes(card)) {
      const price = priceOf(card, finish)
      if (Number.isFinite(price) && price > 0 && (best === null || price < best.price)) {
        best = { price, card, finish }
      }
    }
  }
  return best
}
