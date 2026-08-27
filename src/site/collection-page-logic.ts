import { formatCardLabels } from '../card/card-labels'
import { displayLanguage } from '../card/card-language'
import type { CollectionCardEntry } from '../list/site-data'

/** One duplicate-grouped tile: the representative entry and how many copies it stands for. */
export type GroupedEntry = { entry: CollectionCardEntry; count: number }

/**
 * Identity of a tile when grouping duplicates: printing + condition plus the raw
 * label override and the copy's custom art, so a keep-marked or custom-art copy
 * never merges into (and mislabels, or zero-prices) a stack of otherwise
 * identical tradable copies. The art joins as the *fact* as well as the URL: a
 * copy whose art file was not deployed has no URL to tell it apart, and merging
 * would price the priceless copy at retail. Shared by
 * {@link groupDuplicateEntries} and {@link groupCardIds}, so a tile's card IDs
 * are exactly the entries it visually represents.
 */
export function duplicateGroupKey(entry: CollectionCardEntry): string {
  return `${entry.name}|${entry.set}|${entry.collectorNumber}|${entry.finish}|${entry.condition}|${displayLanguage(entry.language)}|${formatCardLabels(entry.labels ?? [])}|${entry.customArt ?? ''}|${entry.hasCustomArt === true ? 'art' : ''}`
}

/**
 * Fold entries sharing a {@link duplicateGroupKey} into one tile each, keeping
 * the first entry of every group as its representative and counting the rest.
 * Groups come back in first-appearance order.
 */
export function groupDuplicateEntries(entries: readonly CollectionCardEntry[]): GroupedEntry[] {
  const grouped = new Map<string, GroupedEntry>()
  for (const entry of entries) {
    const key = duplicateGroupKey(entry)
    const existing = grouped.get(key)
    if (existing) existing.count++
    else grouped.set(key, { entry, count: 1 })
  }
  return [...grouped.values()]
}

/**
 * The card IDs behind each {@link duplicateGroupKey}, in entry order. Built once
 * per card list, not per tile — re-keying every entry for every tile is
 * quadratic. Entries without an `&N` yet contribute nothing.
 */
export function buildGroupIdIndex(entries: readonly CollectionCardEntry[]): Map<string, number[]> {
  const index = new Map<string, number[]>()
  for (const entry of entries) {
    if (entry.cardId === undefined) continue
    const key = duplicateGroupKey(entry)
    const ids = index.get(key)
    if (ids) ids.push(entry.cardId)
    else index.set(key, [entry.cardId])
  }
  return index
}

/** A tile's card IDs: its {@link duplicateGroupKey} group, or its own entry. */
export function groupCardIds(
  index: Map<string, number[]>,
  entry: CollectionCardEntry,
  groupDuplicates: boolean,
): number[] {
  if (!groupDuplicates) return entry.cardId !== undefined ? [entry.cardId] : []
  return index.get(duplicateGroupKey(entry)) ?? []
}
