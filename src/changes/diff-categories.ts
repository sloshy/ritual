import {
  createSetCategoriesChange,
  createSetCategoryOrderChange,
  type ChangeEvent,
} from './change-event'
import { foldCategoryCardName, sameCardCategories } from '../card/card-categories'
import { type CardCategoriesRecord, orderedCategoryEntries } from '../list/card-categories-sidecar'

/**
 * The categories sidecar's counterpart of `diff-cards.ts`: what changed between
 * two revisions of a list's `<list>.categories.json`, as change events.
 *
 * **Persistence fence — this module must never import `src/i18n`.** It produces
 * persisted events, and `detect-changes` writes them into a list's
 * `.changes.md`. Asserted by `test/unit/i18n-conventions.test.ts`.
 */

/**
 * The events that turn `before` into `after`: a `set-category-order` when the
 * vocabulary order differs, then one `set-categories` per card whose list
 * changed — an empty list being a clear. Pure; no event at all when the two
 * records agree.
 *
 * Cards are walked in the pinned data order of their stored names so a diff is
 * reproducible, and each event carries the **after** spelling of the name when
 * it has one (the card is still categorized) and the before spelling otherwise
 * (it was cleared).
 */
export function diffCardCategories(
  before: CardCategoriesRecord,
  after: CardCategoriesRecord,
): ChangeEvent[] {
  const events: ChangeEvent[] = []
  if (!sameCardCategories(before.order, after.order)) {
    events.push(createSetCategoryOrderChange(after.order))
  }

  // The union of both revisions' cards, in the canonical order both sides
  // serialize in: the surviving ones first (named by their AFTER spelling),
  // then the ones `after` no longer holds, which are the clears.
  const cleared = orderedCategoryEntries(before).filter(
    (entry) => !after.cards.has(foldCategoryCardName(entry.name)),
  )

  for (const entry of [...orderedCategoryEntries(after), ...cleared]) {
    const key = foldCategoryCardName(entry.name)
    const from = before.cards.get(key)?.categories
    const to = after.cards.get(key)?.categories
    if (sameCardCategories(from, to)) continue
    events.push(createSetCategoriesChange(entry.name, to ?? []))
  }
  return events
}
