/**
 * The read pages' per-card category lookup.
 *
 * Categories are keyed by card **name** and live in the list's record, not on a
 * card line, so a page resolves each card through
 * {@link cardCategoriesOf} — the one per-card resolution — rather than reading a
 * field off the entry. That is what makes the editing panes work: they hand the
 * page the *live* record (the session's pending `set-categories` replayed) over
 * card data that carries no baked categories at all.
 */

import { createMemo } from 'solid-js'
import type { CardCategoriesOverlay, CardCategory } from '../card/card-categories'
import {
  cardCategoriesOf,
  recordFromJson,
  type CardCategoriesJson,
} from '../list/card-categories-record'

/** What a page needs to attach categories to its card data and its modal. */
export type ListCategoriesLookup = {
  /** One card name's categories, or undefined when it has none. */
  categoriesFor: (name: string | undefined) => readonly CardCategory[] | undefined
  /**
   * The same value as a spreadable overlay, so an absent list writes **no key**
   * — absent means none everywhere this value travels.
   */
  categoriesField: (name: string) => CardCategoriesOverlay
}

export function useListCategories(
  categories: () => CardCategoriesJson | undefined,
): ListCategoriesLookup {
  const record = createMemo(() => recordFromJson(categories()))
  const categoriesFor = (name: string | undefined): readonly CardCategory[] | undefined =>
    name === undefined ? undefined : cardCategoriesOf(record(), name)
  return {
    categoriesFor,
    categoriesField: (name) => {
      const found = categoriesFor(name)
      return found ? { categories: found } : {}
    },
  }
}
