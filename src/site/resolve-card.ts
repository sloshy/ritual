import type { ScryfallCard } from '../types'
import type { WantedListCardEntry } from './data-types'
import { hasSpecificPrinting } from '../card-printing'
import { overlayCard } from './session-cache'

/**
 * Resolve the Scryfall card for a wanted-list entry against a list's `cards` map.
 * Pinned entries look up by their `<set>:<collectorNumber>` printing key (falling
 * back to the card name), while name-only entries resolve directly by name. The
 * result is run through {@link overlayCard} so any fresher in-session price wins.
 *
 * Shared by the wanted-list page and the combined multi-list view so the two never
 * diverge on the lookup rule.
 */
export function resolveWantedCardEntry(
  entry: WantedListCardEntry,
  cards: Record<string, ScryfallCard | null>,
): ScryfallCard | null {
  if (hasSpecificPrinting(entry)) {
    const key = `${entry.set.toLowerCase()}:${entry.collectorNumber}`
    return overlayCard(cards[key] ?? cards[entry.name] ?? null)
  }
  return overlayCard(cards[entry.name] ?? null)
}
