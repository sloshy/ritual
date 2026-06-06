import type { ChangeInput } from '../change-event'
import type { WantedListCardEntry } from '../site/data-types'
import { DEFAULT_SECTION } from '../types'
import { noteOrUndefined } from '../note-helpers'
import { findTargetEntryIndex } from './entry-targeting.js'

type WantedListChangeInput = ChangeInput & {
  fileOrder?: number
}

export function applyChangeToWantedList(
  entries: WantedListCardEntry[],
  change: WantedListChangeInput,
): WantedListCardEntry[] {
  switch (change.action) {
    case 'add': {
      const hasSet = Boolean(change.set && change.collectorNumber)
      const hasFinish = Boolean(change.finish)
      const state = !hasSet ? 'name-only' : hasFinish ? 'fully-specified' : 'printing'
      const newEntry: WantedListCardEntry = {
        name: change.cardName,
        set: change.set,
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        price: 0,
        fileOrder: entries.length,
        section: change.section ?? DEFAULT_SECTION,
        state,
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
      const target = entries[idx]!
      const finish = change.finish
      const state = !target.set ? 'name-only' : finish ? 'fully-specified' : 'printing'
      return entries.map((e, i) => (i === idx ? { ...e, finish, state } : e))
    }

    case 'set-printing': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) return entries
      const hasSet = Boolean(change.set && change.collectorNumber)
      const hasFinish = Boolean(change.finish)
      const state = !hasSet ? 'name-only' : hasFinish ? 'fully-specified' : 'printing'
      return entries.map((e, i) =>
        i === idx
          ? {
              ...e,
              set: change.set,
              collectorNumber: change.collectorNumber,
              finish: change.finish,
              state,
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
      return entries
    }

    case 'move-from':
    case 'move-to':
      // Move events are managed by the CLI move command and are not applied via the admin UI
      return entries
  }
}
