import { displayLanguage } from '../card-language'
import type { CollectionCardEntry } from './data-types'

/**
 * How many copies of a collection card a trade may take, derived by counting the
 * duplicate lines that represent it.
 *
 * A collection stores one line per physical copy, so the trade cap for any one
 * line is the size of its duplicate group — not 1. Surfaces that render those
 * lines unmerged (the combined view, where the lowest-common-denominator rule
 * keeps one tile per line) still have to hand the trade board the group's count,
 * or the second copy's "Add to Trade" is refused as already-at-max while the
 * user plainly owns two.
 *
 * A noted line is its own unit — the note is why that copy is distinguishable —
 * and never joins a group.
 */

/** Identity of a collection line's duplicate group. Noted lines are excluded by the caller. */
function collectionQtyKey(entry: CollectionCardEntry): string {
  return `${entry.name}|${entry.set.toLowerCase()}|${entry.collectorNumber}|${entry.finish}|${entry.condition}|${displayLanguage(entry.language)}`
}

/** Copies per duplicate group across a collection's lines. Noted lines are left out. */
export function collectionTradeQtyMap(
  entries: readonly CollectionCardEntry[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const entry of entries) {
    if (entry.note) continue
    const key = collectionQtyKey(entry)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
}

/** The trade cap for one collection line, given its list's {@link collectionTradeQtyMap}. */
export function collectionTradeMaxQty(
  entry: CollectionCardEntry,
  qtyMap: Map<string, number>,
): number {
  return entry.note ? 1 : (qtyMap.get(collectionQtyKey(entry)) ?? 1)
}
