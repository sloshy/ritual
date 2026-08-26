/**
 * Pricing a printing at Card Kingdom's NM retail, and choosing which printing
 * to price when a card line names no set.
 *
 * Every consumer of CK retail goes through here — `ritual price --source
 * cardkingdom`, the static site bake, and `serve --api` — so a card can never be
 * priced at one printing by the CLI and another by the site. The lookups all
 * run through {@link PrintingQuoteFn}, the same cache-backed matcher the
 * buylist quotes use, so retail and buy prices always describe the same product.
 *
 * The reason this exists at all: a representative printing chosen from
 * Scryfall's `usd` (TCGplayer) prices is frequently a printing Card Kingdom
 * does not stock, which reads as an unpriced card the moment the view switches
 * to CK. Selecting from CK's own catalog, with CK's own prices, is what makes
 * the CK view price whole lists instead of half of them.
 */

import { displayFinish, type Finish } from '../card/finish-condition'
import { displayLanguage, type CardLanguage } from '../card/card-language'
import {
  NO_BANNED_PRINTINGS,
  selectCheapestPrinting,
  selectCheapestPrintingFinish,
  selectRepresentativePrinting,
  type CheapestPrintingResult,
  type PrintingPriceFn,
} from '../card/printing-select'
import type { ScryfallCard } from '../scryfall/types'
import type { PrintingQuoteFn } from './quote'

/**
 * CK NM retail for one printing+finish; 0 when CK has no product for it, or
 * carries it at no price. A non-English copy quotes at 0 by rule — CK's feed is
 * English-only, and the English product's price is not this card's price.
 *
 * Two properties inherited from the shared matcher, deliberately:
 *
 * - **Out of stock still has a price.** The gate is `priceRetail > 0`, never
 *   `qtyRetail > 0` — an empty shelf does not change what CK is asking, and a
 *   list priced "at Card Kingdom" means at their prices, not at their inventory.
 * - **Ties are broken buy-side.** When several products match one printing,
 *   `chooseProduct` prefers the one CK is actively *buying*. That is the sell
 *   report's rule showing through; it only decides between products that are
 *   already the same printing and finish, so the retail figure it yields is
 *   still a real asking price for the card in hand.
 */
export function cardKingdomRetail(
  quote: PrintingQuoteFn,
  card: ScryfallCard,
  finish: Finish,
  language?: CardLanguage,
): number {
  const matched = quote({
    set: card.set,
    collectorNumber: card.collector_number,
    finish,
    scryfallId: card.id,
    ...(displayLanguage(language) !== 'en' ? { language } : {}),
  })
  return matched && matched.priceRetail > 0 ? matched.priceRetail : 0
}

/**
 * CK retail for a printing at its display finish — the finish a tile shows it
 * at when no `[finish]` token narrows it, resolved through the same
 * `displayFinish` rule the site's `sitePrice` and the bake's `buylistRequestFor`
 * use. This is the pricing function the printing *selection* runs on: choosing
 * a printing is a per-name question, asked before any one line's finish is
 * known.
 */
export function cardKingdomPriceOf(quote: PrintingQuoteFn): PrintingPriceFn {
  return (card) => cardKingdomRetail(quote, card, displayFinish(card, undefined))
}

/**
 * The cheapest CK-retail printing+finish across a card's printings — the CK
 * counterpart of `findCheapestPrinting`, running the same scan over CK's prices
 * so the two stores cannot disagree about which finishes are candidates.
 */
export function findCheapestCardKingdomPrinting(
  quote: PrintingQuoteFn,
  printings: readonly ScryfallCard[],
): CheapestPrintingResult | null {
  return selectCheapestPrintingFinish(printings, (card, finish) =>
    cardKingdomRetail(quote, card, finish),
  )
}

/**
 * A card's two Card Kingdom printing picks. The Scryfall counterpart is
 * `CurrencyPrint`; `cheapest` carries its finish and price because CK sells a
 * foil as its own product at its own price, and callers that go on to quote it
 * must quote the finish that was actually cheapest.
 */
export type CardKingdomPrints = {
  representative: ScryfallCard | null
  cheapest: CheapestPrintingResult | null
}

/**
 * The Card Kingdom counterpart of `computeRepresentativePrints`: the printing a
 * name-only line displays under the CK price source, and the cheapest printing
 * CK sells for its "Lowest Price" view.
 *
 * Both are chosen with CK's prices over CK's catalog, so neither can land on a
 * printing CK does not stock. `cheapest` is deliberately finish-aware while
 * `representative` is not — a representative is picked per card name, before any
 * line's finish is in play.
 *
 * A card CK carries no printing of yields `{ representative: null, cheapest:
 * null }`; callers fall back to the Scryfall selection and the card simply reads
 * as unpriced under CK, which is the honest answer.
 *
 * @param recentPrintings - Printings newest-first, for the representative pick.
 * @param allPrintings - Every printing of the card, for the cheapest pick.
 * @param bannedPrintings - `set:collectorNumber` keys barred from the representative pick.
 */
export function cardKingdomPrints(
  quote: PrintingQuoteFn,
  recentPrintings: readonly ScryfallCard[],
  allPrintings: readonly ScryfallCard[],
  bannedPrintings: ReadonlySet<string> = NO_BANNED_PRINTINGS,
): CardKingdomPrints {
  return {
    representative: selectRepresentativePrinting(
      recentPrintings,
      cardKingdomPriceOf(quote),
      bannedPrintings,
    ),
    cheapest: findCheapestCardKingdomPrinting(quote, allPrintings),
  }
}

/**
 * A card's Card Kingdom picks as a *display* surface needs them: printings, with
 * no finish attached.
 *
 * The difference from {@link cardKingdomPrints} is the cheapest pick. A price
 * report quotes the printing+finish it chose, so it wants the finish-aware
 * answer — CK's cheapest offering may well be a foil. A card tile cannot use
 * that: it prices whatever printing it displays at the *line's* finish (through
 * `displayFinish`, as `sitePrice` does), so a printing chosen for a foil price
 * CK only sells as a foil would display at no price at all. Picking at the
 * display finish keeps the printing shown and the price shown in agreement,
 * which is also how the Scryfall cheapest map behaves (it reads the base `usd`
 * field, never `usd_foil`).
 */
export function cardKingdomDisplayPrints(
  quote: PrintingQuoteFn,
  recentPrintings: readonly ScryfallCard[],
  allPrintings: readonly ScryfallCard[],
  bannedPrintings: ReadonlySet<string> = NO_BANNED_PRINTINGS,
): CardKingdomDisplayPrints {
  const priceOf = cardKingdomPriceOf(quote)
  return {
    representative: selectRepresentativePrinting(recentPrintings, priceOf, bannedPrintings),
    cheapest: selectCheapestPrinting(allPrintings, priceOf),
  }
}

/** {@link cardKingdomDisplayPrints}' result: two printings, no finishes. */
export type CardKingdomDisplayPrints = {
  representative: ScryfallCard | null
  cheapest: ScryfallCard | null
}
