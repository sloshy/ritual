/**
 * List-entry fixtures, free of `bun:test` and of any runtime `src/cache`
 * import — see `./cards.ts` for why that matters. `test/test-utils.ts`
 * re-exports everything here.
 */

import type { CollectionCardEntry } from '../../src/list/site-data'
import type { PhysicalCard } from '../../src/list/move-staging'
import type { ListEntry } from '../../src/list/list-info'

/**
 * A collection line with neutral defaults; spread overrides on top. One copy,
 * `tst:1` nonfoil NM in `Main`, priced at zero — nothing that would accidentally
 * satisfy a filter or a price assertion a test did not ask for.
 */
export function makeCollectionEntry(
  overrides: Partial<CollectionCardEntry> = {},
): CollectionCardEntry {
  return {
    name: 'Test Card',
    set: 'tst',
    collectorNumber: '1',
    finish: 'nonfoil',
    condition: 'NM',
    price: 0,
    fileOrder: 0,
    section: 'Main',
    ...overrides,
  }
}

/** One list the move engine and move menus can target. */
export function makeListEntry(
  type: 'deck' | 'collection' | 'wanted',
  name: string,
  filePath = `/fake/${type}/${name}.md`,
): ListEntry {
  return { ref: { type, name }, filePath }
}

/** One physical copy staged for a move, living in `listEntry`. */
export function makePhysicalCard(
  name: string,
  listEntry: ListEntry,
  overrides: Partial<PhysicalCard> = {},
): PhysicalCard {
  return {
    key: `${listEntry.filePath}:${name}:0`,
    name,
    set: 'lea',
    collectorNumber: '1',
    cardId: 1,
    listEntry,
    ...overrides,
  }
}
