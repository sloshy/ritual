import type { PhysicalCard } from '../../src/list/move-staging'
import type { ListEntry } from '../../src/list/list-info'

/** Fixtures shared by the move engine and move menu unit tests. */

export function makeListEntry(
  type: 'deck' | 'collection' | 'wanted',
  name: string,
  filePath = `/fake/${type}/${name}.md`,
): ListEntry {
  return { ref: { type, name }, filePath }
}

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
