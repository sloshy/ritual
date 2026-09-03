import { foldCategoryCardName } from '../../src/card/card-categories'
import {
  type CardCategoriesRecord,
  emptyCardCategoriesRecord,
} from '../../src/list/card-categories-sidecar'

/**
 * Build a categories record from a plain description, keyed exactly as the
 * production fold keys it. Shared so two suites cannot hand-roll two different
 * approximations of {@link foldCategoryCardName} and quietly stop exercising the
 * lookups they claim to.
 */
export function categoriesRecord(
  order: string[],
  cards: Record<string, string[]>,
): CardCategoriesRecord {
  const built = emptyCardCategoriesRecord()
  built.order = [...order]
  for (const [name, categories] of Object.entries(cards)) {
    built.cards.set(foldCategoryCardName(name), { name, categories: [...categories] })
  }
  return built
}

/** A record's entries as `{ name: categories }`, for readable assertions. */
export function categoriesOf(value: CardCategoriesRecord): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const entry of value.cards.values()) out[entry.name] = entry.categories
  return out
}
