/**
 * Oracle / art tag matching and display for the tag filters.
 *
 * Tag slugs (e.g. `mana-rock`, `tutor-creature-giant`) are produced by Scryfall
 * Tagger and are already lowercase and pre-split, so — unlike the card-type
 * filter — matching is plain set membership with no type-line parsing. The shared
 * `scanCardTypeInput` / `parseCardTypesInput` helpers in `card-types.ts` are reused
 * for the autocomplete input scanning (comma/space separated, lowercased).
 */

/** How selected tags are combined when matching a card. */
export type TagMatchLogic = 'and' | 'or'

/** Whether the selected tags are kept ('include') or removed ('exclude'). */
export type TagFilterMode = 'include' | 'exclude'

/**
 * Does a card's tag list match the selected tags under the given logic?
 * `selected` slugs are lowercase. AND requires every selected tag; OR requires at
 * least one. With no selected tags, returns true (the filter is inactive).
 */
export function matchesTags(
  cardTags: readonly string[],
  selected: readonly string[],
  logic: TagMatchLogic,
): boolean {
  if (selected.length === 0) return true
  const tags = new Set(cardTags)
  return logic === 'and' ? selected.every((t) => tags.has(t)) : selected.some((t) => tags.has(t))
}

/** Render a stored tag slug for display ("mana-rock" → "Mana Rock"). */
export function formatTagForDisplay(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
