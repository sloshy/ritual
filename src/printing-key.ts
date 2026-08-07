import type { ScryfallCard } from './types'
import type { CardLanguage } from './card-language'

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
 * The per-language variant of {@link printingKey}: `set:cn@lang`. The plain
 * `set:cn` key keeps holding the printing's *default-language* object (the one
 * the `default_cards` bulk carries); an `@lang` key holds the same printing's
 * card object in one alternate language. `@` cannot appear in a set code or
 * collector number, so the two key forms can never collide. Like the plain
 * key, this is a lookup key, never display text.
 */
export function printingLanguageKey(
  set: string,
  collectorNumber: string,
  lang: CardLanguage,
): string {
  return `${printingKey(set, collectorNumber)}@${lang}`
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

/** A card line as the `cards` map is queried by: a name, plus a printing when pinned. */
export type PrintingRef = {
  name: string
  set?: string
  collectorNumber?: string
  /** The line's language token, when present. Absent means `en` (a bare line means English). */
  language?: CardLanguage
}

/**
 * Resolve one card line against a list's `cards` map — the reader half of
 * {@link printingKey}, and the only place the map's dual keying is interpreted.
 *
 * The map is keyed both by printing (`lea:161`) and by card name, the latter
 * holding a *representative* printing. Three cases, and the middle one is the
 * subtle one:
 *
 * - **Not pinned** — resolve by name. The representative is the right answer.
 * - **Pinned, key present** — that is the answer, *including when it is `null`*.
 *   The site builders (`site/details/*.ts`) write an explicit `null` to record
 *   "this printing was looked for and is not in the cache", and warn while doing
 *   it. Falling through that to the by-name representative substitutes a
 *   different printing: the page would show art and a price for a line the build
 *   priced at 0, so a wanted list's displayed total silently exceeded its baked
 *   one.
 * - **Pinned, key absent** — the map has no opinion (the admin loader only adds
 *   printings it has), so fall back to the representative rather than showing
 *   nothing.
 *
 * A non-`en` ref first tries its {@link printingLanguageKey} (`set:cn@lang`,
 * holding the alternate-language card object), then falls through the plain
 * `set:cn` key — which still holds the printing's default-language object, the
 * right fallback for prices and images when no per-language object was baked.
 * The explicit-`null` contract applies to **both** key forms: an `@lang` key
 * written as `null` records "looked for, not in the cache" and is returned
 * as-is rather than falling through to a different object.
 *
 * Callers apply their own session-cache overlay to the result; this returns the
 * raw map value.
 */
export function lookupPrintingCard(
  cards: Record<string, ScryfallCard | null>,
  ref: PrintingRef,
): ScryfallCard | null {
  if (ref.set && ref.collectorNumber) {
    if (ref.language !== undefined && ref.language !== 'en') {
      const langKey = printingLanguageKey(ref.set, ref.collectorNumber, ref.language)
      if (Object.hasOwn(cards, langKey)) return cards[langKey] ?? null
    }
    const key = printingKey(ref.set, ref.collectorNumber)
    if (Object.hasOwn(cards, key)) return cards[key] ?? null
  }
  return cards[ref.name] ?? null
}
