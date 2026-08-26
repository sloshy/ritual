import type { ScryfallCard } from '../scryfall/types'
import type { WantedListCardEntry } from './data-types'
import { overlayCard } from './session-cache'
import { lookupPrintingCard } from '../card/printing-key'
import { usingCardKingdomPrintings, type SourceCardMaps } from './source-cards'

/**
 * Resolve the Scryfall card for a wanted-list entry against a list's `cards` map,
 * then run it through {@link overlayCard} so any fresher in-session price wins.
 *
 * Shared by the wanted-list page and the combined multi-list view so the two never
 * diverge on the lookup rule; {@link lookupPrintingCard} owns the rule itself.
 *
 * `maps.cardKingdom` is the list's CK printing picks, consulted only when
 * {@link usingCardKingdomPrintings} says they are in force and only for entries
 * that name no printing: a pinned line displays the printing it names whatever
 * store is pricing it. The CK map is deliberately *not* run through
 * {@link lookupPrintingCard} — that helper falls back to the by-name entry,
 * which for a pinned line would answer with some other printing entirely.
 */
export function resolveWantedCardEntry(
  entry: WantedListCardEntry,
  maps: SourceCardMaps,
): ScryfallCard | null {
  if (!entry.set || !entry.collectorNumber) {
    if (usingCardKingdomPrintings(maps.cardKingdom, maps.currency)) {
      const override = maps.cardKingdom[entry.name]
      if (override) return overlayCard(override)
    }
  }
  return overlayCard(lookupPrintingCard(maps.cards, entry))
}
