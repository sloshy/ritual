import prompts from 'prompts'
import {
  CONDITION_LABELS,
  finishChoices,
  finishRows,
  formatCollectionLine,
  isCondition,
  isFinish,
  lookupPinnedPrinting,
  promptFinishAndCondition,
  resolveCardPrinting,
  VALID_CONDITIONS,
  VALID_FINISHES,
} from './collection-helpers'
import {
  promptEditAction,
  promptSessionConfigUpdate,
  type CardSessionContext,
  type CardSessionStrategy,
  type SessionConfig,
} from './card-session'
import {
  addAnotherFlatListCopy,
  applyFlatListCardEntry,
  applyFlatListChange,
  discardFlatListAdd,
  listFlatListSessionAdds,
  persistFlatListSession,
  resetFlatListSessionTracking,
  type CollectionSession,
  type FlatListStrategyContext,
  type LastAddState,
} from './flat-list-session'
import {
  applyFlatListFieldEdit,
  editFlatListNote,
  entryPrinting,
  findFlatListEntry,
  lastFlatListEditLabel,
  listFlatListEntries,
  removeFlatListEntry,
  discardFlatListSessionChange,
  listFlatListSessionChanges,
  undoFlatListEdit,
} from './flat-list-edit'
import type { CollectionCardEntry } from '../site/data-types'
import type { Condition, Finish, ScryfallCard } from '../types'
import {
  consolidateSetFinish,
  consolidateSetPrinting,
  createSetFinishChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../change-event'

type ValuePromptResponse = { value?: string }

/**
 * Pick a finish for an existing entry, defaulting the cursor to the current one.
 * `printing` prices the choices; it is undefined when the entry's pinned printing
 * isn't in the card cache.
 */
async function promptFinishChoice(
  current: Finish,
  printing: ScryfallCard | undefined,
): Promise<Finish | null> {
  const choices = finishChoices(finishRows(VALID_FINISHES, current), printing)
  const response = (await prompts({
    type: 'select',
    name: 'value',
    message: 'Finish:',
    choices,
    initial: Math.max(0, VALID_FINISHES.indexOf(current)),
  })) as ValuePromptResponse
  return isFinish(response.value) ? response.value : null
}

/** Pick a condition for an existing entry, defaulting the cursor to the current one. */
async function promptConditionChoice(current: Condition): Promise<Condition | null> {
  const response = (await prompts({
    type: 'select',
    name: 'value',
    message: 'Condition:',
    choices: VALID_CONDITIONS.map((c) => ({
      title: c === current ? `${CONDITION_LABELS[c]} (current)` : CONDITION_LABELS[c],
      value: c,
    })),
    initial: Math.max(0, VALID_CONDITIONS.indexOf(current)),
  })) as ValuePromptResponse
  return isCondition(response.value) ? response.value : null
}

/** Build the collection half of a card session. Shared with the unified `edit` command. */
export function createCollectionStrategy(
  session: CollectionSession,
  sessionConfig: SessionConfig,
  listName: string,
  excludeDigitalOnly: boolean,
): CardSessionStrategy {
  const state: LastAddState = { snapshot: null }
  const list: FlatListStrategyContext<CollectionCardEntry> = {
    session,
    state,
    // A "don't care" condition pick defaults to NM (matching the admin editor);
    // formatCollectionLine omits the default NM token, so the rendered line matches
    // what the file will show.
    renderLine: (name, snapshot, cardId) =>
      formatCollectionLine(
        name,
        snapshot.options.set ?? '',
        snapshot.options.collectorNumber ?? '',
        snapshot.options.finish ?? 'nonfoil',
        snapshot.options.condition ?? 'NM',
        snapshot.note,
        cardId,
      ).trim(),
    renderEntry: (entry) =>
      formatCollectionLine(
        entry.name,
        entry.set,
        entry.collectorNumber,
        entry.finish,
        entry.condition,
        entry.note,
        entry.cardId,
      ).trim(),
    sessionAdds: [],
    editUndo: [],
    originals: new Map(),
  }

  /** Re-render the entry after an edit (apply replaces entry objects). */
  const logUpdated = (cardId: number, fallbackName: string): void => {
    const updated = findFlatListEntry(list, cardId)
    console.log(`Changed: ${updated ? list.renderEntry(updated) : fallbackName}`)
  }

  return {
    managerLabel: 'collection manager',
    saveTarget: { filePath: session.filePath, listName },
    sessionConfig,
    updateConfig: (excludeDigital: boolean) =>
      promptSessionConfigUpdate(sessionConfig, true, excludeDigital),
    applyChange: (change: ChangeEvent) => applyFlatListChange(session, change),
    persist: () => persistFlatListSession(session),
    hasUnsavedChanges: () => session.dirty,
    sessionSaved: () => resetFlatListSessionTracking(list),
    noteAdded: (note: string): void => {
      if (state.snapshot) state.snapshot.note = note
    },

    async handleCard(ctx: CardSessionContext, input): Promise<void> {
      const { cardName, forcePrompts } = input
      const isEditing = input.intent === 'edit-last'
      let printing = input.preselected
      if (!printing) {
        const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
        if (result.kind === 'cancelled') return
        if (result.kind === 'none') {
          // A collection entry requires a printing (name-only lines are not part of the
          // collection format), so there is nothing sensible to add here.
          if (!isEditing) console.error('No printings found. Skipping.')
          return
        }
        printing = result.printing
      }

      const finishAndCondition = await promptFinishAndCondition(
        printing,
        sessionConfig,
        forcePrompts,
      )
      if (!finishAndCondition) return

      await applyFlatListCardEntry(
        list,
        ctx,
        cardName,
        {
          set: printing.set.toLowerCase(),
          collectorNumber: printing.collector_number,
          finish: finishAndCondition.finish,
          condition: finishAndCondition.condition,
        },
        isEditing,
        { kind: 'specific', printing },
      )
    },

    addAnotherCopy: (ctx: CardSessionContext) => addAnotherFlatListCopy(list, ctx),
    listSessionAdds: () => listFlatListSessionAdds(list),
    discardSessionAdd: async (ctx: CardSessionContext, index: number) =>
      discardFlatListAdd(list, ctx, index),
    listSessionChanges: () => listFlatListSessionChanges(list),
    discardSessionChange: async (ctx: CardSessionContext, index: number) =>
      discardFlatListSessionChange(list, ctx, index),

    listEntries: () => listFlatListEntries(list),
    lastEditUndoLabel: () => lastFlatListEditLabel(list),
    undoLastEdit: async (ctx: CardSessionContext) => undoFlatListEdit(list, ctx),

    async editEntry(ctx: CardSessionContext, cardId: number): Promise<void> {
      const entry = findFlatListEntry(list, cardId)
      if (!entry) return
      const action = await promptEditAction(list.renderEntry(entry), [
        { title: '🖼️  Change Printing', value: 'printing' },
        { title: '✨ Change Finish', value: 'finish' },
        { title: '📋 Change Condition', value: 'condition' },
        { title: '📝 Edit Note', value: 'note' },
        { title: '🗑️  Remove', value: 'remove' },
      ])
      if (!action) return

      if (action === 'printing') {
        const result = await resolveCardPrinting(entry.name, sessionConfig, excludeDigitalOnly)
        if (result.kind === 'cancelled') return
        if (result.kind === 'none') {
          console.error('No printings found.')
          return
        }
        const finishAndCondition = await promptFinishAndCondition(
          result.printing,
          sessionConfig,
          true,
        )
        if (!finishAndCondition) return
        const target: PrintingTuple = {
          set: result.printing.set.toLowerCase(),
          collectorNumber: result.printing.collector_number,
          finish: finishAndCondition.finish,
          condition: finishAndCondition.condition,
        }
        const before = entryPrinting(entry)
        applyFlatListFieldEdit(list, ctx, entry, cardId, {
          label: `printing on ${entry.name}`,
          change: createSetPrintingChange(entry.name, { ...target, cardId }),
          inverse: createSetPrintingChange(entry.name, { ...before, cardId }),
          consolidate: (changes, original) =>
            consolidateSetPrinting(changes, entry.name, target, entryPrinting(original), cardId),
        })
        logUpdated(cardId, entry.name)
        return
      }

      if (action === 'finish') {
        const finish = await promptFinishChoice(entry.finish, await lookupPinnedPrinting(entry))
        if (!finish || finish === entry.finish) return
        applyFlatListFieldEdit(list, ctx, entry, cardId, {
          label: `finish on ${entry.name}`,
          change: createSetFinishChange(entry.name, { finish, cardId }),
          inverse: createSetFinishChange(entry.name, { finish: entry.finish, cardId }),
          consolidate: (changes, original) =>
            consolidateSetFinish(changes, entry.name, finish, original.finish ?? 'nonfoil', cardId),
        })
        logUpdated(cardId, entry.name)
        return
      }

      if (action === 'condition') {
        const condition = await promptConditionChoice(entry.condition)
        if (!condition || condition === entry.condition) return
        // There is no set-condition change; a set-printing carrying the entry's
        // current printing plus the new condition is the canonical encoding.
        const target: PrintingTuple = { ...entryPrinting(entry), condition }
        applyFlatListFieldEdit(list, ctx, entry, cardId, {
          label: `condition on ${entry.name}`,
          change: createSetPrintingChange(entry.name, { ...target, cardId }),
          inverse: createSetPrintingChange(entry.name, { ...entryPrinting(entry), cardId }),
          consolidate: (changes, original) =>
            consolidateSetPrinting(changes, entry.name, target, entryPrinting(original), cardId),
        })
        logUpdated(cardId, entry.name)
        return
      }

      if (action === 'note') {
        await editFlatListNote(list, ctx, entry, cardId)
        return
      }

      if (action === 'remove') {
        await removeFlatListEntry(list, ctx, entry, cardId)
      }
    },
  }
}
