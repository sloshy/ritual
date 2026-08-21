import type { ChangeInput } from '../change-event'
import type { WantedListCardEntry } from '../site/data-types'
import { DEFAULT_SECTION } from '../types'
import { noteOrUndefined } from '../note-helpers'
import { storedLanguage } from '../card-language'
import { canSetFinish, finishMatchesPrinting } from '../card-printing'
import { findTargetEntryIndex } from './entry-targeting.js'
import { wantedState } from './wanted-entries'
import type { ApplyChangeOptions } from './apply-batch'

type WantedListChangeInput = ChangeInput & {
  fileOrder?: number
}

/**
 * Apply a single change to a wanted-list entries array, returning a new array.
 * Does not mutate the input.
 *
 * A change that does not apply — a targeting change (`remove`, `set-*`,
 * `move-from`) whose entry does not exist, or a commander action, which never
 * applies to a wanted list — returns the entries **unchanged** and reports
 * through `options.onMiss` (reason 'no-target' or 'not-applicable'). Write paths that must not silently drop a change pass a
 * callback and surface the failure; preview/overlay callers may omit it.
 */
export function applyChangeToWantedList(
  entries: WantedListCardEntry[],
  change: WantedListChangeInput,
  options?: ApplyChangeOptions,
): WantedListCardEntry[] {
  switch (change.action) {
    case 'add': {
      const state = wantedState(change)
      const newEntry: WantedListCardEntry = {
        name: change.cardName,
        // Lowercased at the apply boundary, like the collection engine.
        set: change.set?.toLowerCase(),
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        // The written value: `undefined` means `en` and serializes bare.
        language: change.language,
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
      const target = entries[idx]!
      // A foil/etched token is a claim about a printing, so a name-only entry
      // cannot take one — the caller must pin a printing first. (A wanted line
      // can still be cleared back to nonfoil while it names no printing.)
      if (!canSetFinish(target, change.finish)) {
        options?.onMiss?.('needs-printing')
        return entries
      }
      const finish = change.finish
      // Recomputed from the entry the write produces, through the same rule the
      // parser uses — a set code alone is not a printing.
      const state = wantedState({ ...target, finish })
      return entries.map((e, i) => (i === idx ? { ...e, finish, state } : e))
    }

    case 'set-printing': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) {
        options?.onMiss?.('no-target')
        return entries
      }
      // The printing and the finish are written together here, so the pair has
      // to hold together — see the `set-finish` case above.
      if (!finishMatchesPrinting(change)) {
        options?.onMiss?.('needs-printing')
        return entries
      }
      const state = wantedState(change)
      return entries.map((e, i) =>
        i === idx
          ? {
              ...e,
              set: change.set?.toLowerCase(),
              collectorNumber: change.collectorNumber,
              finish: change.finish,
              // Unlike finish, an absent language leaves the entry's alone —
              // language changes have their own set-language event.
              language: change.language ?? e.language,
              state,
            }
          : e,
      )
    }

    case 'set-language': {
      const idx = findTargetEntryIndex(entries, change)
      if (idx === -1) {
        options?.onMiss?.('no-target')
        return entries
      }
      // `en` clears the stored value so the entry serializes bare, matching
      // what a re-parse of the written line would produce.
      const language = storedLanguage(change.language)
      return entries.map((e, i) => (i === idx ? { ...e, language } : e))
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
    case 'unset-commander':
    case 'set-label': {
      // Not applicable to this list type — report with the applicability reason.
      // (Labels are a collection-only concept.)
      options?.onMiss?.('not-applicable')
      return entries
    }

    case 'move-from':
      // A move out of this list removes the card here; the destination write is
      // handled at save time (admin) or on import of the destination's change file.
      return applyChangeToWantedList(
        entries,
        {
          action: 'remove',
          cardName: change.cardName,
          cardId: change.cardId,
          set: change.set,
          collectorNumber: change.collectorNumber,
          finish: change.finish,
          condition: change.condition,
          language: change.language,
          fileOrder: change.fileOrder,
        },
        options,
      )

    case 'move-to':
      // A move into this list adds the card (e.g. when importing a destination list's changes).
      return applyChangeToWantedList(entries, {
        action: 'add',
        cardName: change.cardName,
        cardId: change.cardId,
        set: change.set,
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        language: change.language,
      })
  }
}
