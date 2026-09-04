/**
 * Category matching and input scanning for the categories filter row.
 *
 * Unlike the lowercase tag slugs `card-tags.ts` matches, a category keeps its
 * case and is compared through `foldCardCategory`, so nothing here lowercases:
 * the values that reach `CardFilters.cardCategories`, the chips, the URL and the
 * suggestion list are all case-kept, and every comparison folds.
 */

import {
  CARD_CATEGORY_SEPARATOR,
  foldCardCategory,
  normalizeCardCategories,
  parseCardCategory,
  type CardCategory,
} from '../card/card-categories'
import { matchesSelection, type FilterMatchMode } from './filter-mode'
import { scanSeparatedTokens, type TagsInputScan } from './TagsInput'

/**
 * Does a card's category list match the selected categories under the given
 * mode? Both sides fold before the shared `matchesSelection` — which documents
 * that its `selected` entries are already normalized. An empty selection means
 * the filter is inactive.
 */
export function matchesCardCategories(
  cardCategories: readonly CardCategory[] | undefined,
  selected: readonly string[],
  mode: FilterMatchMode,
): boolean {
  if (selected.length === 0) return true
  return matchesSelection(
    new Set((cardCategories ?? []).map(foldCardCategory)),
    selected.map(foldCardCategory),
    mode,
  )
}

/**
 * Commit the category-shaped tokens of a comma-separated field, **dropping the
 * ones the grammar refuses and keeping the rest**: pasting `Ramp, #bad, Draw`
 * commits `Ramp` and `Draw` rather than nothing at all. `normalizeCardCategories`
 * is the shipped dedupe rule (fold-keyed, first spelling wins, order preserved),
 * so nothing here re-implements it.
 */
function commitCategoryTokens(value: string): CardCategory[] {
  const parsed = value.split(CARD_CATEGORY_SEPARATOR).flatMap((part) => {
    const result = parseCardCategory(part)
    return result.ok ? [result.category] : []
  })
  return normalizeCardCategories(parsed)
}

/**
 * Split a (possibly partial) categories-filter input into committed category
 * names plus the token still being typed. **Commas only** — a category may
 * contain spaces (`Board Wipes`), so whitespace never separates, and the shipped
 * `parseCardCategoriesInput` grammar is the one that decides what a name may be.
 * Committed names keep their case and are deduped by `foldCardCategory`; a
 * refused token is dropped and the rest still commit, so one bad entry in a
 * pasted list does not discard the good ones.
 */
export function scanCardCategoryInput(value: string): TagsInputScan {
  return scanSeparatedTokens(value, CARD_CATEGORY_SEPARATOR, commitCategoryTokens)
}

/**
 * Fully parse the field on Enter, committing the trailing token too. Refused
 * tokens are dropped and the rest commit — the row's values are always
 * category-shaped, so a malformed entry simply adds nothing of its own.
 */
export function parseCardCategoryFilterInput(value: string): string[] {
  return commitCategoryTokens(value)
}
