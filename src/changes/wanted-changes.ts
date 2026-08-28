import type { ChangeInput } from './change-event'
import type { WantedListCardEntry } from '../list/site-data'
import { DEFAULT_SECTION } from '../list/deck'
import { noteOrUndefined } from '../card/note-helpers'
import { storedLanguage } from '../card/card-language'
import { canSetFinish, finishMatchesPrinting } from '../card/card-printing'
import { removeTarget, updateTarget } from './entry-targeting.js'
import { wantedState } from '../list/wanted-entries'
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

    case 'remove':
      return removeTarget(entries, change, options)

    case 'set-finish': {
      const finish = change.finish
      // A foil/etched token is a claim about a printing, so a name-only entry
      // cannot take one — the caller must pin a printing first. (A wanted line
      // can still be cleared back to nonfoil while it names no printing.)
      return updateTarget(entries, change, options, (e) =>
        canSetFinish(e, finish)
          ? // Recomputed from the entry the write produces, through the same rule
            // the parser uses — a set code alone is not a printing.
            { ...e, finish, state: wantedState({ ...e, finish }) }
          : 'needs-printing',
      )
    }

    case 'set-printing':
      // The printing and the finish are written together here, so the pair has
      // to hold together — see the `set-finish` case above.
      return updateTarget(entries, change, options, (e) =>
        finishMatchesPrinting(change)
          ? {
              ...e,
              set: change.set?.toLowerCase(),
              collectorNumber: change.collectorNumber,
              finish: change.finish,
              // Unlike finish, an absent language leaves the entry's alone —
              // language changes have their own set-language event.
              language: change.language ?? e.language,
              state: wantedState(change),
            }
          : 'needs-printing',
      )

    case 'set-language': {
      // `en` clears the stored value so the entry serializes bare, matching
      // what a re-parse of the written line would produce.
      const language = storedLanguage(change.language)
      return updateTarget(entries, change, options, (e) => ({ ...e, language }))
    }

    case 'set-note': {
      const note = noteOrUndefined(change.note)
      return updateTarget(entries, change, options, (e) => ({ ...e, note }))
    }

    case 'set-section':
      return updateTarget(entries, change, options, (e) => ({ ...e, section: change.section }))

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
      return applyChangeToWantedList(
        entries,
        {
          action: 'add',
          cardName: change.cardName,
          cardId: change.cardId,
          set: change.set,
          collectorNumber: change.collectorNumber,
          finish: change.finish,
          language: change.language,
          section: change.section,
        },
        options,
      )
  }
}
