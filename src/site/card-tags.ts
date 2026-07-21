/**
 * Oracle / art tag matching for the tag filters.
 *
 * Tag slugs (e.g. `mana-rock`, `tutor-creature-giant`) are produced by Scryfall
 * Tagger and are already lowercase and pre-split, so — unlike the card-type
 * filter — matching is plain set membership with no type-line parsing, and they
 * are rendered verbatim (never title-cased) so the UI shows the raw Scryfall
 * slug. The shared `scanCardTypeInput` / `parseCardTypesInput` helpers in
 * `card-types.ts` are reused for the autocomplete input scanning (comma/space
 * separated, lowercased).
 */

import { matchesSelection, type FilterMatchMode } from './filter-mode'

/**
 * Does a card's tag list match the selected tags under the given mode?
 * `selected` slugs are lowercase. With no selected tags, returns true (the filter
 * is inactive).
 */
export function matchesTags(
  cardTags: readonly string[],
  selected: readonly string[],
  mode: FilterMatchMode,
): boolean {
  return matchesSelection(new Set(cardTags), selected, mode)
}
