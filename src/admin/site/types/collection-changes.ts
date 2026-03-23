import type { ChangeEvent } from './deck-changes'
import type { CollectionCardEntry } from '../../../site/data-types'

/** The subset of ChangeEvent fields that applyChangeToCollection needs. */
type ChangeInput = Omit<ChangeEvent, 'id' | 'timestamp'> & {
  /** When provided, targets the exact entry by fileOrder for precise removal. */
  fileOrder?: number
}

/**
 * Apply a single change to a collection entries array, returning a new array.
 * Does not mutate the input.
 */
export function applyChangeToCollection(
  entries: CollectionCardEntry[],
  change: ChangeInput,
): CollectionCardEntry[] {
  switch (change.action) {
    case 'add': {
      const newEntry: CollectionCardEntry = {
        name: change.cardName,
        set: change.set ?? '',
        collectorNumber: change.collectorNumber ?? '',
        finish: change.finish ?? 'nonfoil',
        condition: change.condition ?? 'NM',
        price: 0,
        fileOrder: entries.length,
      }
      return [...entries, newEntry]
    }

    case 'remove': {
      // Prefer precise targeting by fileOrder when available
      if (change.fileOrder !== undefined) {
        const idx = entries.findIndex((e) => e.fileOrder === change.fileOrder)
        if (idx === -1) return entries
        return entries.filter((_, i) => i !== idx)
      }

      // Fallback: match by name + optional set/collectorNumber
      const idx = entries.findIndex((e) => {
        if (e.name !== change.cardName) return false
        if (change.set && e.set.toLowerCase() !== change.set.toLowerCase()) return false
        if (change.collectorNumber && e.collectorNumber !== change.collectorNumber) return false
        return true
      })
      if (idx === -1) return entries
      return entries.filter((_, i) => i !== idx)
    }

    case 'set-finish': {
      return entries.map((e) => {
        if (e.name === change.cardName) {
          return { ...e, finish: change.finish ?? 'nonfoil' }
        }
        return e
      })
    }

    case 'set-commander': {
      // Not applicable to collections, return unchanged
      return entries
    }
  }
}
