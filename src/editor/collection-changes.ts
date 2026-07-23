import type { ChangeInput } from '../change-event'
import type { CollectionCardEntry } from '../site/data-types'
import { DEFAULT_SECTION } from '../types'
import { noteOrUndefined } from '../note-helpers'
import { findTargetEntryIndex } from './entry-targeting.js'

type CollectionChangeInput = ChangeInput & {
  /** When provided, targets the exact entry by fileOrder for precise removal. */
  fileOrder?: number
}

/**
 * Collection entries always carry a printing, so a change that introduces or
 * rewrites one (`add`, `move-to`, `set-printing`) must name both a set code and
 * a collector number — applying one without them would serialize a malformed
 * `- Name (:)` line that no longer parses. Returns an error message naming the
 * first offending change, or null when every change is valid. Callers that
 * write collection files (admin save, one-shot CLI mutations) check this before
 * applying; the move engine enforces the same rule in `applyAddToStaged`.
 */
export function findCollectionPrintingError(changes: ChangeInput[]): string | null {
  for (const change of changes) {
    if (
      change.action !== 'add' &&
      change.action !== 'move-to' &&
      change.action !== 'set-printing'
    ) {
      continue
    }
    if (!change.set || !change.collectorNumber) {
      return change.action === 'set-printing'
        ? `Cannot set printing on "${change.cardName}" without set and collector number`
        : `Cannot add "${change.cardName}" to a collection without set and collector number`
    }
  }
  return null
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
        section: change.section ?? DEFAULT_SECTION,
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

    case 'set-printing': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) return entries
      return entries.map((e, i) =>
        i === idx
          ? {
              ...e,
              set: change.set ?? '',
              collectorNumber: change.collectorNumber ?? '',
              finish: change.finish ?? e.finish,
              condition: change.condition ?? e.condition,
            }
          : e,
      )
    }

    case 'set-note': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) return entries
      const note = noteOrUndefined(change.note)
      return entries.map((e, i) => (i === idx ? { ...e, note } : e))
    }

    case 'set-section': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) return entries
      return entries.map((e, i) => (i === idx ? { ...e, section: change.section } : e))
    }

    case 'rename-section': {
      // Membership lives on each entry; the section-order list is maintained by the caller.
      return entries.map((e) =>
        e.section === change.section ? { ...e, section: change.newSection } : e,
      )
    }

    case 'add-section':
    case 'remove-section': {
      // Section existence/order is tracked separately from entries; a remove only ever
      // targets an empty section, so neither op changes the entry array.
      return entries
    }

    case 'set-commander':
    case 'unset-commander': {
      // Not applicable to collections, return unchanged
      return entries
    }

    case 'move-from':
      // A move out of this list removes the card here; the destination write is
      // handled at save time (admin) or on import of the destination's change file.
      return applyChangeToCollection(entries, {
        action: 'remove',
        cardName: change.cardName,
        cardId: change.cardId,
        set: change.set,
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        condition: change.condition,
        fileOrder: change.fileOrder,
      })

    case 'move-to':
      // A move into this list adds the card (e.g. when importing a destination list's changes).
      return applyChangeToCollection(entries, {
        action: 'add',
        cardName: change.cardName,
        cardId: change.cardId,
        set: change.set,
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        condition: change.condition,
      })
  }
}
