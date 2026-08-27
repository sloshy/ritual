/** The fields the index reads off a flat-list entry. */
export type IndexedEntry = {
  name: string
  /** The entry's set code; absent on a name-only wanted line. */
  set?: string
  fileOrder: number
}

/**
 * The fields the index reads off a rendered card tile. `fileOrder` is required —
 * every tile carries one (it separates two copies of the same printing), and an
 * optional one silently keys as `undefined` and matches nothing.
 */
export type IndexedCard = {
  name: string
  /** The tile's set code; absent on a name-only wanted card. */
  setCode?: string
  fileOrder: number
}

/**
 * A name+set+file-order → entry position map, so a card tile finds the entry
 * that produced it in O(1) instead of rescanning the whole list.
 */
export type EntryIndex = Map<string, number>

/**
 * The index key. Set codes are lowercased on both sides, per the project-wide
 * rule; a missing set (a name-only wanted line) keys as the empty string.
 */
function indexKey(name: string, set: string | undefined, fileOrder: number): string {
  return `${name}|${(set ?? '').toLowerCase()}|${fileOrder}`
}

/** Build the {@link EntryIndex} for a list's entries, in their current order. */
export function buildEntryIndex(entries: readonly IndexedEntry[]): EntryIndex {
  const map: EntryIndex = new Map()
  entries.forEach((e, i) => {
    map.set(indexKey(e.name, e.set, e.fileOrder), i)
  })
  return map
}

/** The position of the entry a card tile came from, or -1 when it has none. */
export function findEntryIndex(index: EntryIndex, card: IndexedCard): number {
  return index.get(indexKey(card.name, card.setCode, card.fileOrder)) ?? -1
}

/**
 * The entry a flat page's card modal is open on. The key is a position in the
 * page's current card list, as a string; one naming a position no longer there,
 * or not a position at all, answers `undefined` rather than the wrong line.
 */
export function entryAtModalKey<E>(entries: readonly E[], key: string | null): E | undefined {
  if (key === null) return undefined
  const index = Number.parseInt(key, 10)
  return Number.isNaN(index) ? undefined : entries[index]
}
