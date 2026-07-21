/**
 * The three-way match mode shared by every multi-value card filter (color
 * identity, card types, oracle tags, art tags) and the matching helper behind it.
 *
 * Each of those filters compares a card's own set of values against the set the
 * user selected, and the mode picks which relationship counts as a match. Having
 * one vocabulary across all of them keeps the filter menu to a single control per
 * filter rather than a separate "any/all" and "include/exclude" pair.
 *
 * Lives in its own module because `card-types.ts` and `card-tags.ts` both need
 * `matchesSelection`, and both are imported by `card-filters.ts` — defining it in
 * any of the three would introduce an import cycle.
 */

/**
 * How a card's values are matched against the selected ones:
 * - `include`: the card has at least one of the selected values.
 * - `exclude`: the card has none of them.
 * - `exact`: the card has every one of them.
 *
 * Color identity reads `exact` more strictly — see `matchesColorIdentity` in
 * `card-filters.ts`, where it means the identity *equals* the selection rather
 * than merely containing it.
 */
export const FILTER_MATCH_MODES = ['include', 'exclude', 'exact'] as const

export type FilterMatchMode = (typeof FILTER_MATCH_MODES)[number]

/**
 * Set codes support only include/exclude: a card belongs to exactly one set, so
 * `exact` ("has every selected set") could never match a selection of two or more.
 */
export type SetCodeFilterMode = Exclude<FilterMatchMode, 'exact'>

export const SET_CODE_FILTER_MODES = [
  'include',
  'exclude',
] as const satisfies readonly SetCodeFilterMode[]

/**
 * Color identity adds a fourth mode. A card's identity is its *complete* color
 * set, which makes two extra containment questions meaningful that a tag list
 * can't ask: `subset` ("playable in a deck of these colors") and `exact`
 * ("identity equals this selection"). `include`/`exclude` keep the same any-of /
 * none-of meaning they have everywhere else.
 */
export const COLOR_MATCH_MODES = ['subset', ...FILTER_MATCH_MODES] as const

export type ColorMatchMode = (typeof COLOR_MATCH_MODES)[number]

/**
 * Does a card's `values` match `selected` under `mode`? `selected` entries are
 * lowercase. With nothing selected the filter is inactive, so this returns true.
 */
export function matchesSelection(
  values: ReadonlySet<string>,
  selected: readonly string[],
  mode: FilterMatchMode,
): boolean {
  if (selected.length === 0) return true
  switch (mode) {
    case 'include':
      return selected.some((value) => values.has(value))
    case 'exclude':
      return !selected.some((value) => values.has(value))
    case 'exact':
      return selected.every((value) => values.has(value))
  }
}
