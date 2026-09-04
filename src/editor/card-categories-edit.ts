/**
 * The editors' shared, pure category-edit body — the `card-tags-edit.ts` sibling,
 * far smaller because a `set-categories` is one whole-list, latest-wins event
 * rather than a per-value delta.
 *
 * UI-layer, so its refusals are rendered strings (the `section-edits.ts`
 * precedent); it is not on the persistence fence.
 */

import { t } from '../i18n/t'
import { defaultCategories } from '../config/default-categories'
import { promptCardCategories } from './categories-prompt'
import {
  foldCardCategory,
  foldCategoryCardName,
  hasCardCategory,
  parseCardCategory,
  type CardCategory,
} from '../card/card-categories'
import {
  cardCategoriesOf,
  pruneCardCategories,
  resolveCategoryOrder,
  type CardCategoriesRecord,
} from '../list/card-categories-record'

/**
 * The categories a list's own cards already use, in vocabulary order, followed
 * by the configured defaults it does not name — the dialog's one-click
 * additions. Deduped by fold, keeping the first spelling seen.
 */
export function categorySuggestions(
  record: CardCategoriesRecord,
  defaults: readonly CardCategory[],
): CardCategory[] {
  const suggestions: CardCategory[] = []
  const seen = new Set<string>()
  for (const name of resolveCategoryOrder(record)) {
    const key = foldCardCategory(name)
    if (seen.has(key)) continue
    seen.add(key)
    suggestions.push(name)
  }
  for (const name of defaults) {
    const key = foldCardCategory(name)
    if (seen.has(key)) continue
    seen.add(key)
    suggestions.push(name)
  }
  return suggestions
}

/**
 * Why a rename is refused, or null. Mirrors `sectionNameError`: empty,
 * malformed (the shared shape rule), or already used by another category
 * case-insensitively. `currentName` is the category being renamed, so a pure
 * case change of the same name is allowed.
 */
export function categoryRenameError(
  order: readonly CardCategory[],
  name: string,
  currentName?: string,
): string | null {
  const parsed = parseCardCategory(name)
  if (!parsed.ok) return t('ui.editor.categoryInvalid', { reason: parsed.message })
  const key = foldCardCategory(parsed.category)
  const currentKey = currentName === undefined ? undefined : foldCardCategory(currentName)
  const clash = order.find((existing) => foldCardCategory(existing) === key)
  if (clash !== undefined && key !== currentKey) {
    return t('ui.editor.categoryExists', { name: clash })
  }
  return null
}

/** How many of the list's cards hold `category`. Drives the Manage modal's count column. */
export function categoryUsageCount(record: CardCategoriesRecord, category: CardCategory): number {
  let count = 0
  for (const entry of record.cards.values()) {
    if (hasCardCategory(entry.categories, category)) count++
  }
  return count
}

/**
 * The list's categories in display order — the vocabulary the Manage modal lists
 * **and the one every editor guard validates against**, so a rename can never
 * land on a category the cards use but `order` does not name. The editors' one
 * name for that list; the sidecar's `resolveCategoryOrder` is the rule.
 */
export function categoryManagerOrder(record: CardCategoriesRecord): CardCategory[] {
  return resolveCategoryOrder(record)
}

/**
 * The record with the given card names' entries dropped — what a save reports in
 * `prunedCategories` after its removals took the list's last line of a name.
 * Pure; `order` is untouched, exactly as {@link pruneCardCategories} leaves it.
 */
export function recordWithoutCardNames(
  record: CardCategoriesRecord,
  names: readonly string[],
): CardCategoriesRecord {
  if (names.length === 0) return record
  const gone = new Set(names.map(foldCategoryCardName))
  const kept = new Set([...record.cards.keys()].filter((key) => !gone.has(key)))
  return pruneCardCategories(record, kept).categories
}

/** What {@link openCategoriesPrompt} needs of an editor session. */
export type CategoriesEditTarget = {
  categoriesRecord: () => CardCategoriesRecord
  handleSetCategoriesFor: (cardName: string, categories: CardCategory[]) => void
}

/**
 * Open the "Edit Categories…" dialog for one card. Identical in every editor
 * because categories are keyed by card name — unlike tags, whose per-copy
 * baseline differs between the deck and the flat controllers — so the handler
 * lives here once.
 *
 * Seeded from the **live** record (what the user sees now); the *baseline* an
 * edit is compared against is the loaded one, inside `handleSetCategoriesFor`,
 * which is what makes "restore the original ⇒ record nothing" work.
 */
export function openCategoriesPrompt(editor: CategoriesEditTarget, cardName: string): void {
  const record = editor.categoriesRecord()
  promptCardCategories({
    current: cardCategoriesOf(record, cardName),
    suggestions: categorySuggestions(record, defaultCategories()),
    onSave: (categories) => editor.handleSetCategoriesFor(cardName, categories),
  })
}
