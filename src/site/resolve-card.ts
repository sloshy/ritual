import type { ScryfallCard } from '../types'
import type { WantedListCardEntry } from './data-types'
import { overlayCard } from './session-cache'
import { lookupPrintingCard } from '../printing-key'

/**
 * Resolve the Scryfall card for a wanted-list entry against a list's `cards` map,
 * then run it through {@link overlayCard} so any fresher in-session price wins.
 *
 * Shared by the wanted-list page and the combined multi-list view so the two never
 * diverge on the lookup rule; {@link lookupPrintingCard} owns the rule itself.
 */
export function resolveWantedCardEntry(
  entry: WantedListCardEntry,
  cards: Record<string, ScryfallCard | null>,
): ScryfallCard | null {
  return overlayCard(lookupPrintingCard(cards, entry))
}
