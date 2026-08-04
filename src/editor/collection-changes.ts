import type { ChangeInput } from '../change-event'
import type { CollectionCardEntry } from '../site/data-types'
import { DEFAULT_SECTION } from '../types'
import { normalizeCardLabels } from '../card-labels'
import { noteOrUndefined } from '../note-helpers'
import { applyConditionUpdate } from '../finish-condition'
import { findTargetEntryIndex } from './entry-targeting.js'
import type { ApplyChangeOptions } from './apply-batch'

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

/** The fields a parsed/loaded collection entry needs to become a {@link CollectionCardEntry}. */
export type CollectionEntrySource = {
  name: string
  set: string
  collectorNumber: string
  finish?: CollectionCardEntry['finish']
  condition?: CollectionCardEntry['condition']
  labels?: CollectionCardEntry['labels']
  section?: string
  note?: string
  cardId?: number
}

/**
 * Map parsed/loaded collection entries to the card-entry shape the change
 * engine operates on: lowercase set, defaulted finish/condition, `fileOrder`
 * by position. One mapping shared by every surface that replays changes (the
 * admin save handler, the one-shot CLI path, the bundle-import dry run), so
 * their targeting can never diverge.
 */
export function toCollectionCardEntries(
  entries: readonly CollectionEntrySource[],
): CollectionCardEntry[] {
  return entries.map((e, i) => ({
    name: e.name,
    set: e.set.toLowerCase(),
    collectorNumber: e.collectorNumber,
    finish: e.finish ?? 'nonfoil',
    condition: e.condition ?? 'NM',
    labels: e.labels,
    price: 0,
    fileOrder: i,
    section: e.section ?? DEFAULT_SECTION,
    note: e.note,
    cardId: e.cardId,
  }))
}

/**
 * Apply a single change to a collection entries array, returning a new array.
 * Does not mutate the input.
 *
 * A change that does not apply — a targeting change (`remove`, `set-*`,
 * `move-from`) whose entry does not exist, or a commander action, which never
 * applies to a collection — returns the entries **unchanged** and reports
 * through `options.onMiss` (reason 'no-target' or 'not-applicable'). Write paths that must not silently drop a change pass a
 * callback and surface the failure; preview/overlay callers may omit it.
 */
export function applyChangeToCollection(
  entries: CollectionCardEntry[],
  change: CollectionChangeInput,
  options?: ApplyChangeOptions,
): CollectionCardEntry[] {
  switch (change.action) {
    case 'add': {
      const newEntry: CollectionCardEntry = {
        name: change.cardName,
        // Normalized on the way into in-memory state, per the set-code rule: a
        // change may arrive from a CLI flag or an agent spelling it upper-case.
        set: change.set?.toLowerCase() ?? '',
        collectorNumber: change.collectorNumber ?? '',
        finish: change.finish ?? 'nonfoil',
        condition: change.condition ?? 'NM',
        labels:
          change.labels && change.labels.length > 0
            ? normalizeCardLabels(change.labels)
            : undefined,
        price: 0,
        fileOrder: entries.length,
        section: change.section ?? DEFAULT_SECTION,
        cardId: change.cardId,
      }
      return [...entries, newEntry]
    }

    case 'remove': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) {
        options?.onMiss?.('no-target')
        return entries
      }
      return entries.filter((_, i) => i !== idx)
    }

    case 'set-finish': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) {
        options?.onMiss?.('no-target')
        return entries
      }
      return entries.map((e, i) => (i === idx ? { ...e, finish: change.finish } : e))
    }

    case 'set-printing': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) {
        options?.onMiss?.('no-target')
        return entries
      }
      return entries.map((e, i) =>
        i === idx
          ? {
              ...e,
              set: change.set?.toLowerCase() ?? '',
              collectorNumber: change.collectorNumber ?? '',
              finish: change.finish ?? e.finish,
              // A collection entry always carries a grade in memory; clearing
              // means NM, which the serializer writes without an annotation.
              condition: applyConditionUpdate(change.condition, e.condition) ?? 'NM',
            }
          : e,
      )
    }

    case 'set-note': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) {
        options?.onMiss?.('no-target')
        return entries
      }
      const note = noteOrUndefined(change.note)
      return entries.map((e, i) => (i === idx ? { ...e, note } : e))
    }

    case 'set-label': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) {
        options?.onMiss?.('no-target')
        return entries
      }
      // An empty set clears the override — the entry falls back to its list's
      // front-matter default. Normalized so the file's token is always canonical.
      const labels = change.labels.length > 0 ? normalizeCardLabels(change.labels) : undefined
      return entries.map((e, i) => (i === idx ? { ...e, labels } : e))
    }

    case 'set-section': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) {
        options?.onMiss?.('no-target')
        return entries
      }
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
      // Not applicable to this list type — report with the applicability reason.
      options?.onMiss?.('not-applicable')
      return entries
    }

    case 'move-from':
      // A move out of this list removes the card here; the destination write is
      // handled at save time (admin) or on import of the destination's change file.
      return applyChangeToCollection(
        entries,
        {
          action: 'remove',
          cardName: change.cardName,
          cardId: change.cardId,
          set: change.set,
          collectorNumber: change.collectorNumber,
          finish: change.finish,
          condition: change.condition,
          fileOrder: change.fileOrder,
        },
        options,
      )

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
