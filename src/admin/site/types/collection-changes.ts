import type { ChangeInput } from '../../../change-event'
import type { CollectionCardEntry } from '../../../site/data-types'
import { findTargetEntryIndex } from './entry-targeting.js'

type CollectionChangeInput = ChangeInput & {
  /** When provided, targets the exact entry by fileOrder for precise removal. */
  fileOrder?: number
}

/**
 * Apply a single change to a collection entries array, returning a new array.
 * Does not mutate the input.
 */
export function applyChangeToCollection(
  entries: CollectionCardEntry[],
  change: CollectionChangeInput,
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
        cardId: change.cardId,
      }
      return [...entries, newEntry]
    }

    case 'remove': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) return entries
      return entries.filter((_, i) => i !== idx)
    }

    case 'set-finish': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) return entries
      return entries.map((e, i) => (i === idx ? { ...e, finish: change.finish } : e))
    }

    case 'set-commander':
    case 'unset-commander': {
      // Not applicable to collections, return unchanged
      return entries
    }

    case 'move-from':
    case 'move-to':
      // Move events are managed by the CLI move command and are not applied via the admin UI
      return entries
  }
}
