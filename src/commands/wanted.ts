import { Command } from 'commander'
import prompts from 'prompts'
import { getWantedDir } from '../ritual-config'
import { isFinish, resolveCardPrinting } from './collection-helpers'
import {
  ensureWantedListFile,
  formatWantedListLine,
  promptWantedFinish,
  type WantedListSessionConfig,
} from './wanted-helpers'
import {
  listMarkdownNames,
  loadCardNamesOrWarn,
  loadCollectorSets,
  promptEditAction,
  promptListSelection,
  promptSessionConfigUpdate,
  runCardSession,
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
  loadWantedSession,
  persistFlatListSession,
  resetFlatListSessionTracking,
  type FlatListStrategyContext,
  type LastAddState,
  type WantedSession,
} from './flat-list-session'
import {
  applyFlatListFieldEdit,
  editFlatListNote,
  entryPrinting,
  findFlatListEntry,
  lastFlatListEditLabel,
  listFlatListEntries,
  removeFlatListEntry,
  undoFlatListEdit,
} from './flat-list-edit'
import type { WantedListCardEntry } from '../site/data-types'
import type { Finish } from '../types'
import {
  consolidateSetPrinting,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../change-event'
import { capitalize } from '../utils'
import { parseSetCodesInput } from '../set-codes'

type WantedCommandOptions = {
  sets?: string
  finish?: string
  collector?: boolean
  allowDigitalOnlyCards?: boolean
}

type SpecificityPromptResponse = { specificity?: 'name-only' | 'specific' }
type FinishPromptResponse = { finish?: string }

const NO_PREFERENCE = '__NONE__'

/** Ask whether a wanted entry should be name-only or pinned to a specific printing. */
async function promptSpecificity(cardName: string): Promise<'name-only' | 'specific' | null> {
  const response = (await prompts({
    type: 'select',
    name: 'specificity',
    message: `How specific for ${cardName}?`,
    choices: [
      { title: 'Name only (cheapest printing)', value: 'name-only' },
      { title: 'Choose specific printing', value: 'specific' },
    ],
  })) as SpecificityPromptResponse
  return response.specificity ?? null
}

/**
 * Pick a finish for an existing wanted entry, including "No preference" (which
 * clears the finish back off the line). Returns undefined for no preference and
 * null on cancel.
 */
async function promptWantedFinishChoice(
  current: Finish | undefined,
): Promise<Finish | undefined | null> {
  const finishes: Finish[] = ['nonfoil', 'foil', 'etched']
  const choices = [
    {
      title: current === undefined ? 'No preference (current)' : 'No preference (any finish)',
      value: NO_PREFERENCE,
    },
    ...finishes.map((f) => ({
      title: f === current ? `${capitalize(f)} (current)` : capitalize(f),
      value: f,
    })),
  ]
  const response = (await prompts({
    type: 'select',
    name: 'finish',
    message: 'Finish:',
    choices,
    initial: current === undefined ? 0 : Math.max(0, finishes.indexOf(current) + 1),
  })) as FinishPromptResponse
  if (response.finish === undefined) return null
  if (response.finish === NO_PREFERENCE) return undefined
  return isFinish(response.finish) ? response.finish : null
}

function createWantedStrategy(
  session: WantedSession,
  sessionConfig: WantedListSessionConfig,
  listName: string,
  excludeDigitalOnly: boolean,
): CardSessionStrategy {
  const state: LastAddState = { snapshot: null }
  const list: FlatListStrategyContext<WantedListCardEntry> = {
    session,
    state,
    renderLine: (name, snapshot, cardId) =>
      formatWantedListLine(
        name,
        snapshot.options.set && snapshot.options.collectorNumber
          ? { set: snapshot.options.set, collectorNumber: snapshot.options.collectorNumber }
          : undefined,
        snapshot.options.finish,
        snapshot.note,
        cardId,
      ).trim(),
    renderEntry: (entry) =>
      formatWantedListLine(
        entry.name,
        entry.set && entry.collectorNumber
          ? { set: entry.set, collectorNumber: entry.collectorNumber }
          : undefined,
        entry.finish,
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
    managerLabel: 'wanted list manager',
    filePath: session.filePath,
    listName,
    // The wanted list has no condition, but the shared engine config carries the
    // full shape; the condition field simply stays undefined for this command.
    sessionConfig,
    updateConfig: (excludeDigital: boolean) =>
      promptSessionConfigUpdate(sessionConfig, false, excludeDigital),
    applyChange: (change: ChangeEvent) => applyFlatListChange(session, change),
    persist: () => persistFlatListSession(session),
    hasUnsavedChanges: () => session.dirty,
    sessionSaved: () => resetFlatListSessionTracking(list),
    noteAdded: (note: string): void => {
      if (state.snapshot) state.snapshot.note = note
    },

    async handleCard(ctx: CardSessionContext, input): Promise<void> {
      const { cardName, forcePrompts, isEditing } = input

      const specificity = await promptSpecificity(cardName)
      if (!specificity) return

      if (specificity === 'name-only') {
        await applyFlatListCardEntry(list, ctx, cardName, {}, isEditing, { kind: 'cheapest' })
        return
      }

      let printing = input.preselected
      if (!printing) {
        const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
        if (!result) {
          if (isEditing) return
          // Name-only entries are first-class in the wanted-list format, so fall
          // back to one rather than dropping the card.
          console.error('No printings found. Adding name only.')
          await applyFlatListCardEntry(list, ctx, cardName, {}, false, { kind: 'cheapest' })
          return
        }
        printing = result.printing
      }

      // Prompt for finish (with "No preference" option for wanted lists). Forcing
      // bypasses the session's default finish so the prompt always appears.
      const finishResult = await promptWantedFinish(
        printing,
        forcePrompts ? undefined : sessionConfig.finish,
      )
      if (finishResult === 'cancelled') return
      const finish = finishResult === 'nopreference' ? undefined : finishResult

      await applyFlatListCardEntry(
        list,
        ctx,
        cardName,
        {
          set: printing.set.toLowerCase(),
          collectorNumber: printing.collector_number,
          finish,
        },
        isEditing,
        { kind: 'specific', printing },
      )
    },

    addAnotherCopy: (ctx: CardSessionContext) => addAnotherFlatListCopy(list, ctx),
    listSessionAdds: () => listFlatListSessionAdds(list),
    discardSessionAdd: async (ctx: CardSessionContext, index: number) =>
      discardFlatListAdd(list, ctx, index),

    listEntries: () => listFlatListEntries(list),
    lastEditUndoLabel: () => lastFlatListEditLabel(list),
    undoLastEdit: async (ctx: CardSessionContext) => undoFlatListEdit(list, ctx),

    async editEntry(ctx: CardSessionContext, cardId: number): Promise<void> {
      const entry = findFlatListEntry(list, cardId)
      if (!entry) return
      const hasPrinting = Boolean(entry.set && entry.collectorNumber)
      const action = await promptEditAction(list.renderEntry(entry), [
        { title: '🖼️  Change Printing', value: 'printing' },
        // Finish only annotates a specific printing; name-only entries have none to change.
        ...(hasPrinting ? [{ title: '✨ Change Finish', value: 'finish' }] : []),
        { title: '📝 Edit Note', value: 'note' },
        { title: '🗑️  Remove', value: 'remove' },
      ])
      if (!action) return

      if (action === 'printing') {
        const specificity = await promptSpecificity(entry.name)
        if (!specificity) return

        let target: PrintingTuple = {}
        if (specificity === 'specific') {
          const result = await resolveCardPrinting(entry.name, sessionConfig, excludeDigitalOnly)
          if (!result) {
            console.error('No printings found.')
            return
          }
          const finishResult = await promptWantedFinish(result.printing, undefined)
          if (finishResult === 'cancelled') return
          target = {
            set: result.printing.set.toLowerCase(),
            collectorNumber: result.printing.collector_number,
            finish: finishResult === 'nopreference' ? undefined : finishResult,
          }
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
        const finish = await promptWantedFinishChoice(entry.finish)
        if (finish === null || finish === entry.finish) return
        // Wanted finishes can be cleared back to "no preference", which set-finish
        // cannot express, so finish edits ride on a set-printing of the same printing.
        const target: PrintingTuple = { ...entryPrinting(entry), finish }
        applyFlatListFieldEdit(list, ctx, entry, cardId, {
          label: `finish on ${entry.name}`,
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

export function registerWantedListCommand(program: Command): void {
  program
    .command('wanted-list')
    .alias('wanted')
    .description('Manage your wanted list of cards to acquire')
    .option('-s, --sets <codes>', 'Filter by set codes (comma-separated, e.g., "FDN, SPG")')
    .option('-f, --finish <finish>', 'Default finish (nonfoil, foil, etched)')
    .option('--collector', 'Start in collector number mode')
    .option('--allow-digital-only-cards', 'Include digital-only sets (e.g., Alchemy)')
    .action(async (options: WantedCommandOptions) => {
      const parsedSets = options.sets ? parseSetCodesInput(options.sets) : undefined
      const excludeDigitalOnly = !options.allowDigitalOnlyCards

      const cardNames = await loadCardNamesOrWarn(parsedSets, excludeDigitalOnly)
      if (!cardNames) return

      const existingLists = await listMarkdownNames(getWantedDir())
      const selection = await promptListSelection({
        message: 'Select a wanted list file',
        items: existingLists.map((c) => ({ title: c, value: c })),
        createTitle: '+ Create New Wanted List',
        newNameMessage: 'Enter name for new wanted list:',
      })
      if (!selection) return
      const selectedList = selection.kind === 'new' ? selection.name : selection.value

      const listFile = await ensureWantedListFile(selectedList)
      const session = await loadWantedSession(listFile)

      const sessionConfig: SessionConfig = {
        sets: parsedSets,
        finish: isFinish(options.finish) ? options.finish : undefined,
        entryMode: options.collector ? 'collector' : 'name',
        collectorSets: [],
        activeSetIndex: 0,
        setCardMaps: new Map(),
      }

      // Pre-load set data when starting in collector mode with sets provided
      if (options.collector && parsedSets && parsedSets.length > 0) {
        await loadCollectorSets(sessionConfig, parsedSets)
      }

      await runCardSession({
        strategy: createWantedStrategy(session, sessionConfig, selectedList, excludeDigitalOnly),
        cardNames,
        excludeDigitalOnly,
      })
    })
}
