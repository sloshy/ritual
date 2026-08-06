import type { ScryfallCard } from './types'

/**
 * The canonical `set:collectorNumber` key for one printing, with **both halves
 * lowercased**.
 *
 * Folding the collector number is the part that is easy to get wrong. Collector
 * numbers carry letters (`123a`, `A-12`), which makes them look like opaque
 * identifiers worth preserving — but throughout this project a printing is
 * identified case-insensitively: `findPrinting` in `card-printing.ts` lowercases
 * both sides, and `collectionKey` in `collection-sync/diff.ts` folds both halves
 * "so the two sides cannot miss each other over casing alone". `507A` and `507a`
 * are the same printing. A key that disagreed with those two would be the odd one
 * out, and the disagreement would be invisible.
 *
 * It has to fold, because the two sides of this key come from different places:
 * the `cards` map is *built* from Scryfall's spelling (`cardPrintingKey`) but
 * *read* by the spelling a markdown line used. Preserve case and a line reading
 * `(MKM:507A)` misses a cache that holds `507a` — blank art, zero price, no
 * buylist quote, no error.
 *
 * Lives at the root rather than under `site/` because every layer keys printings
 * this way — the admin card-data loader that builds the map, the site and editor
 * code that reads it, and the banned-printings config. Each hand-written
 * `` `${set}:${cn}` `` that skipped it drifted: some lowercased nothing, some
 * lowercased only the set, one lowercased the whole string.
 *
 * Not to be confused with the *quote* key (`src/buylist/types.ts`), which adds a
 * finish and is a wire contract, or the sync key (`collection-sync/diff.ts`),
 * which adds finish and condition. This key is for lookups, never for display:
 * set codes render uppercase (`formatPrintingLabel`).
 */
export function printingKey(set: string, collectorNumber: string): string {
  return `${set.toLowerCase()}:${collectorNumber.toLowerCase()}`
}

/**
 * `SET:collectorNumber` as the UI and markdown spell it: set code uppercased,
 * collector number verbatim. The display counterpart of {@link printingKey} —
 * uppercasing a whole key would also fold the collector number's own case.
 */
export function formatPrintingLabel(set: string, collectorNumber: string): string {
  return `${set.toUpperCase()}:${collectorNumber}`
}

/** {@link printingKey} for a resolved printing — the common case at the map's producers. */
export function cardPrintingKey(card: ScryfallCard): string {
  return printingKey(card.set, card.collector_number)
}
