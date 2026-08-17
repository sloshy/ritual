/**
 * Which printing a card name displays as, under the price view the reader has
 * chosen.
 *
 * A name-only line has no printing of its own, so a build picks one for it. That
 * pick is made with the prices of one store: Scryfall's `usd` (TCGplayer) for
 * the default maps, and Card Kingdom's retail feed for the `cardKingdom`
 * overrides beside them. Reading the TCGplayer pick under the Card Kingdom
 * source is what made whole decks price at nothing — CK simply does not stock
 * every printing TCGplayer lists.
 *
 * The override is always *sparse and additive*: a name CK carries no printing of
 * has no entry, and falls back to the Scryfall pick so the card still shows its
 * art and text, with only its price reading as unavailable.
 *
 * Both halves of the gate live here rather than at the call sites. Card Kingdom
 * is a *USD* store, so its picks apply only while USD is the displayed currency
 * — a reader who chose Card Kingdom and then switched to EUR is looking at
 * Cardmarket prices, with no source selector even on screen to undo a CK
 * printing pick with. Every function reads {@link activeUsdSource}, so a memo
 * calling one re-runs when the reader flips the toolbar's source selector.
 */

import type { PriceCurrency } from '../price-currency'
import type { CardKingdomCards } from './data-types'
import { activeUsdSource } from './price-view'
import type { ScryfallCard } from '../types'

/**
 * A Scryfall-picked card map, the Card Kingdom overrides for it, and the
 * currency on screen — everything needed to answer "which printing".
 */
export type SourceCardMaps = {
  cards: Record<string, ScryfallCard | null>
  cardKingdom?: CardKingdomCards
  currency: PriceCurrency
}

/**
 * Whether Card Kingdom's own printing picks are the ones in force: it must have
 * shipped picks, USD must be on screen, and CK must be the selected USD store.
 * A type predicate, so callers index the map without asserting.
 */
export function usingCardKingdomPrintings(
  overrides: CardKingdomCards | undefined,
  currency: PriceCurrency,
): overrides is CardKingdomCards {
  return overrides !== undefined && currency === 'usd' && activeUsdSource() === 'cardkingdom'
}

/**
 * The card to display for a key (a card name, or a `set:cn` printing key),
 * preferring the active source's own pick.
 */
export function sourceCard(maps: SourceCardMaps, key: string): ScryfallCard | null {
  if (usingCardKingdomPrintings(maps.cardKingdom, maps.currency)) {
    const override = maps.cardKingdom[key]
    if (override) return override
  }
  return maps.cards[key] ?? null
}

/**
 * {@link sourceCard} as a whole map, for the callers that hand a card map to
 * something else (the deck page's tile resolver, the session-cache seed).
 *
 * Returns the Scryfall map *by identity* whenever CK's picks are not in force,
 * so a deployment without them pays nothing. When they are, it materializes a
 * merged object: keep the call inside a `createMemo`, and note that a memo over
 * an editor's card *store* then re-merges on every write to that store.
 */
export function sourceCards(maps: SourceCardMaps): Record<string, ScryfallCard | null> {
  if (!usingCardKingdomPrintings(maps.cardKingdom, maps.currency)) return maps.cards
  return { ...maps.cards, ...maps.cardKingdom }
}
