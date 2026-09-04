/**
 * Nesting the two category groupings inside a deck's boards (design §1.1, §7):
 * a `Ramp` card in the sideboard heads under `Sideboard › Ramp`, never under a
 * flat `Ramp` shared with mainboard cards.
 *
 * The composition lives here, outside `groupAndSortCards`, because `DeckPage`
 * partitions its boards *before* the grouper runs (and `useListPage`'s ordering
 * contract forbids a `filterSource` that reads the group-by). Calling the shared
 * grouper once per board keeps its key ordering, fold-collapsing,
 * Uncategorized-last and `reverseGroups` behaviour verbatim — per board, which
 * is exactly what the design asks for. The *category half* of a composite key is
 * the grouper's own heading spelling, so for every category the list's `order`
 * names, a heading and a filter chip can never disagree. An off-vocabulary
 * category is spelled per board (the grouper picks the first card that holds
 * it), so two boards may spell such a name differently — an edge case the
 * vocabulary closes for anything it names.
 */

import type { CardData, CardGroup, CategoryGroupBy, SortLayer } from '../list-view/card-sorting'
import { CATEGORY_GROUP_BYS, groupAndSortCards } from '../list-view/card-sorting'
import type { CardCategory } from '../card/card-categories'
import { t } from '../i18n/t'

/**
 * Whether a grouping is one of the two that nests inside a deck's boards. Takes
 * a bare `string` because the page toolbar erases its group-by union; the
 * membership test reads the one `GroupBy`-checked table, so a renamed member
 * cannot leave the guard behind.
 */
export function isCategoryGroupBy(groupBy: string): groupBy is CategoryGroupBy {
  return (CATEGORY_GROUP_BYS as readonly string[]).includes(groupBy)
}

/** One board of a deck, in display order, with the cards it renders. */
export type DeckBoardCards<C extends CardData = CardData> = {
  /** The board heading, as the deck spells it. English by contract. */
  label: string
  /** The board's cards, already filtered exactly as that board is rendered today. */
  cards: readonly C[]
  /** The commander board's tiles carry no quantity badge; every other board's do. */
  hideCount: boolean
}

/**
 * Everything the shared grouper actually consumes for a category grouping. Its
 * `sectionOrder`, `priceGroupStrategy` and `currency` parameters are read only
 * by the `section` and `price`/`buylist-price` branches, and the within-group
 * sort takes none of them, so they are not forwarded from the page.
 */
export type DeckCategoryGroupOptions = {
  groupBy: CategoryGroupBy
  sortLayers: readonly SortLayer[]
  reverseGroups: boolean
  /** The list's category vocabulary, in sidecar order — the heading order. */
  categoryOrder: readonly CardCategory[]
}

/** A category group nested inside one board. `key` is the rendered heading. */
export interface DeckBoardGroup<C extends CardData = CardData> extends CardGroup<C> {
  /** The board this group nests under — the outer half of `key`. */
  board: string
  /** Forwarded from the board, so the renderer picks the same tile it always did. */
  hideCount: boolean
}

export function groupDeckBoardsByCategory<C extends CardData>(
  boards: readonly DeckBoardCards<C>[],
  options: DeckCategoryGroupOptions,
): DeckBoardGroup<C>[] {
  const nested: DeckBoardGroup<C>[] = []
  for (const board of boards) {
    // A mutable copy: the grouper sorts its buckets in place.
    // `sectionOrder`, `priceGroupStrategy` and `currency` are inert under the two
    // category groupings (see `DeckCategoryGroupOptions`), so they are passed as
    // empty/absent/`'usd'` rather than threaded through the page.
    const groups = groupAndSortCards(
      [...board.cards],
      options.groupBy,
      options.sortLayers,
      [],
      undefined,
      'usd',
      options.reverseGroups,
      options.categoryOrder,
    )
    for (const group of groups) {
      nested.push({
        key: t('site.cardSection.boardCategoryHeading', {
          board: board.label,
          category: group.key,
        }),
        board: board.label,
        hideCount: board.hideCount,
        cards: group.cards,
        // Conditional, never `undefined`: `CardSection.secondaryOf` reads the
        // bare category, and the Uncategorized group (and every `'category'`
        // group) has none.
        ...(group.category !== undefined ? { category: group.category } : {}),
      })
    }
  }
  return nested
}
