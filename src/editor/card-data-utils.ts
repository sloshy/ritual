import type { ScryfallCard } from '../types'
import { scryfallCardLanguage } from '../card-language'
import { cardPrintingKey, printingLanguageKey } from '../printing-key'

/**
 * Index one card object into a printing-keyed `cards` map. English objects own
 * the plain `set:cn` slot; a foreign-language object goes under its
 * {@link printingLanguageKey} (`set:cn@lang`) and only claims the plain slot
 * when nothing holds it yet (a printing that exists in no other language must
 * still resolve art and price by its plain key). An English object always wins
 * the plain slot back from such a fallback, whatever order the list arrived in.
 */
export function indexPrintingCard(
  result: Record<string, ScryfallCard | null>,
  card: ScryfallCard,
): void {
  const plainKey = cardPrintingKey(card)
  const language = scryfallCardLanguage(card)
  if (language === 'en') {
    result[plainKey] = card
    return
  }
  result[printingLanguageKey(card.set, card.collector_number, language)] = card
  if (!Object.hasOwn(result, plainKey)) result[plainKey] = card
}

/** Builds a set:collectorNumber(@lang) → ScryfallCard lookup from a printings array. */
export function buildPrintingKeys(items: ScryfallCard[]): Record<string, ScryfallCard> {
  const result: Record<string, ScryfallCard> = {}
  for (const p of items) {
    indexPrintingCard(result, p)
  }
  return result
}

/**
 * How a card map is handed to the editors' stores: the one printing that was
 * resolved, and optionally the card's full printing list. Shared so the two
 * stores (and anything that drives them) cannot drift a parameter apart.
 *
 * `card` must be a printing *of* `cardName`. The deck store files a card handed
 * over without a printing list into that name's printing list, and
 * `findPrinting` matches on `set:cn` alone — so a card belonging to some other
 * name would be resolvable by any line pinned to that printing.
 */
export type AddCardToStore = (
  cardName: string,
  card?: ScryfallCard,
  printings?: ScryfallCard[],
) => void

/**
 * Fill the by-name representative slot for a card the editor just learned about.
 *
 * Written only when the name holds no card yet: the representative is what every
 * *name-only* line of that card renders, so a flow that resolves one specific
 * printing (picking a printing for some copies, adding a pinned copy of a card
 * already on the list) must not repaint the copies that still pin nothing. Those
 * copies keep the printing they were showing until the data they actually stand
 * for changes. A price refresh is the opposite case and assigns the slot outright.
 *
 * A recorded `null` counts as empty here — unlike {@link indexPrintingCard}'s
 * `Object.hasOwn` test on a printing key, where `null` is the real answer "this
 * printing was looked up and is not cached". A name with no card is a slot
 * waiting to be filled, and filling it is what makes the line render at all.
 *
 * An English object still reclaims the slot from a foreign-language one, the
 * same rule {@link indexPrintingCard} applies to the plain printing key: a `[ja]`
 * copy resolved first must not leave every name-only line of that card in
 * Japanese for the rest of the session.
 */
export function seedNameRepresentative(
  cards: Record<string, ScryfallCard | null>,
  cardName: string,
  card: ScryfallCard,
): void {
  const held = cards[cardName]
  if (held == null) {
    cards[cardName] = card
    return
  }
  if (scryfallCardLanguage(held) !== 'en' && scryfallCardLanguage(card) === 'en') {
    cards[cardName] = card
  }
}
