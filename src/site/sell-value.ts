/**
 * What a selection is worth to the chosen buyer, and what the buyer would
 * actually take.
 *
 * Mirrors the sell report engine's per-product budget (`src/sell-report.ts`):
 * several selected tiles can resolve to the same buyer product, and the buyer
 * only takes `qtyBuying` copies of it in total. Without the budget the site's
 * "sell value" would quietly exceed what `ritual sell` reports and what a cart
 * upload could actually ship.
 */

import { buildCkCartCsv, roundCents, type CkCartItem, type SellCartCsv } from '../buylist'
import type { BuylistQuote } from '../buylist'
import type { Finish, ScryfallCard } from '../types'
import { quoteFor } from './buylist-quotes'
import { displayFinish } from '../finish-condition'
import type { CardData } from './card-sorting'

/**
 * The minimum a card must carry to be priced against a buylist: how many copies,
 * and which printing. `SelectedCard` satisfies this structurally; `CardData` is
 * adapted by {@link sellableFromCardData}.
 */
export type SellableCard = {
  quantity: number
  /** Lowercase set code, when the entry pins one. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** The printing actually displayed, used when the entry pins none. */
  scryfallCard: ScryfallCard | null
}

/** Adapt a list tile to the sellable shape (`CardData` spells the card `card`). */
export function sellableFromCardData(card: CardData): SellableCard {
  return {
    quantity: card.quantity,
    finish: card.finish,
    scryfallCard: card.card,
  }
}

/** One tile's share of its buyer product's remaining buy capacity. */
export type SellAllocation = {
  card: SellableCard
  /** The buyer's offer for the tile's printing, or undefined when it has none. */
  quote: BuylistQuote | undefined
  /** Copies the buyer will take from this tile, after the shared budget. */
  sellableQuantity: number
  /** `priceBuy × sellableQuantity`. */
  value: number
}

/**
 * The quote for a selected tile's printing. A tile with no pinned set/collector
 * number is quoted through its resolved Scryfall card, which is the printing the
 * tile displays — the same rule `buylistFieldsFor` uses.
 */
function quoteForSelection(card: SellableCard): BuylistQuote | undefined {
  // Card-first, matching `buylistFieldsFor` and the request builder: the quote
  // belongs to the printing the tile is actually showing, which for an unpinned
  // line is not the one the line names. (Casing no longer matters either way —
  // `quoteKey` folds it — but the pin and the resolved printing can genuinely
  // differ, so the fallback order is still load-bearing.)
  const set = card.scryfallCard?.set ?? card.set
  const collectorNumber = card.scryfallCard?.collector_number ?? card.collectorNumber
  if (set === undefined || collectorNumber === undefined) return undefined
  return quoteFor(set, collectorNumber, displayFinish(card.scryfallCard, card.finish))
}

/**
 * Allocate each selected tile a share of its buyer product's buy limit, in
 * selection order, and price the copies that fit. Tiles sharing a product draw
 * down one budget, so the totals never promise more than the buyer will take.
 */
export function allocateSellQuantities(cards: readonly SellableCard[]): SellAllocation[] {
  const budgets = new Map<number, number>()
  return cards.map((card): SellAllocation => {
    const quote = quoteForSelection(card)
    if (!quote || !quote.buying) return { card, quote, sellableQuantity: 0, value: 0 }
    const remaining = budgets.get(quote.productId) ?? quote.qtyBuying
    const sellableQuantity = Math.min(card.quantity, remaining)
    budgets.set(quote.productId, remaining - sellableQuantity)
    return {
      card,
      quote,
      sellableQuantity,
      value: roundCents(quote.priceBuy * sellableQuantity),
    }
  })
}

/** What a selection is worth to the buyer, and what they would leave behind. */
export type SellValueSummary = {
  /** Total cash the buyer would pay for the copies they will take. */
  value: number
  /** Copies the buyer will take. */
  sellableCount: number
  /** Copies with no active offer at all — unquoted, or the buyer has paused them. */
  notOnBuylistCount: number
  /** Copies the buyer has an active offer for but is already full on. */
  overLimitCount: number
}

/** Summarize {@link allocateSellQuantities} into the header/dialog figures. */
export function summarizeSellValue(cards: readonly SellableCard[]): SellValueSummary {
  const summary: SellValueSummary = {
    value: 0,
    sellableCount: 0,
    notOnBuylistCount: 0,
    overLimitCount: 0,
  }
  for (const allocation of allocateSellQuantities(cards)) {
    summary.value = roundCents(summary.value + allocation.value)
    summary.sellableCount += allocation.sellableQuantity
    const leftover = allocation.card.quantity - allocation.sellableQuantity
    if (leftover === 0) continue
    if (allocation.quote && allocation.quote.buying) summary.overLimitCount += leftover
    else summary.notOnBuylistCount += leftover
  }
  return summary
}

/**
 * The parenthetical after a sell value, naming the copies the buyer will not
 * take. Null when they would take everything selected.
 */
export function sellShortfallNote(summary: SellValueSummary): string | null {
  const parts: string[] = []
  if (summary.notOnBuylistCount > 0) {
    parts.push(
      `${summary.notOnBuylistCount} ${pluralizeCards(summary.notOnBuylistCount)} not on buylist`,
    )
  }
  if (summary.overLimitCount > 0) {
    parts.push(`${summary.overLimitCount} over the buyer's limit`)
  }
  return parts.length > 0 ? `(${parts.join(', ')})` : null
}

/** Named to avoid shadowing by the `cards` parameter every other export here takes. */
function pluralizeCards(count: number): string {
  return count === 1 ? 'card' : 'cards'
}

/**
 * Render a selection as the buyer's cart CSV, using the buyer's own listing
 * title (card name plus variant note), edition spelling, and the
 * budget-capped quantities — the same rows
 * `ritual sell --output csv` writes for the same cards.
 */
export function selectionToCartCsv(cards: readonly SellableCard[]): SellCartCsv {
  const items = allocateSellQuantities(cards).flatMap(
    ({ quote, sellableQuantity }): CkCartItem[] =>
      quote && sellableQuantity > 0
        ? [
            {
              name: quote.name,
              edition: quote.edition,
              variation: quote.variation,
              finish: quote.finish,
              quantity: sellableQuantity,
            },
          ]
        : [],
  )
  return buildCkCartCsv(items)
}
