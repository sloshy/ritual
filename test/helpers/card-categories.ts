import fs from 'node:fs/promises'
import { foldCategoryCardName } from '../../src/card/card-categories'
import {
  categoriesSidecarPath,
  serializeCardCategoriesSidecar,
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

/**
 * Put a readable `<list>.categories.json` next to `listFilePath`, written by the
 * production serializer at the production path — so a suite never hand-rolls the
 * file name, the fold or the canonical bytes.
 */
export async function writeCategoriesSidecar(
  listFilePath: string,
  order: string[],
  cards: Record<string, string[]>,
): Promise<void> {
  await fs.writeFile(
    categoriesSidecarPath(listFilePath),
    serializeCardCategoriesSidecar(categoriesRecord(order, cards)),
  )
}

/**
 * Put a `<list>.categories.json` next to `listFilePath` that no parser can read
 * — the fixture behind every "refuses rather than overwriting it" case. The path
 * comes from the production rule so a rename of the sidecar suffix cannot leave
 * the tests writing somewhere nothing reads.
 */
export async function writeUnreadableCategoriesSidecar(listFilePath: string): Promise<void> {
  await fs.writeFile(categoriesSidecarPath(listFilePath), '{ not json')
}
