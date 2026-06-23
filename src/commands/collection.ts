import { Command } from 'commander'
import prompts from 'prompts'
import { getCollectionsDir } from '../ritual-config'
import {
  CONDITION_LABELS,
  ensureCollectionFile,
  formatCollectionLine,
  isCondition,
  isFinish,
  promptFinishAndCondition,
  resolveCardPrinting,
  VALID_CONDITIONS,
  VALID_FINISHES,
} from './collection-helpers'
import {
  applyCacheRefreshOptions,
  listMarkdownNames,
  loadCollectorSets,
  prepareCardSessionCache,
  promptEditAction,
  promptListSelection,
  promptSessionConfigUpdate,
  runCardSession,
  type CacheRefreshOptions,
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
  loadCollectionSession,
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
import type { Condition, Finish } from '../types'
import {
  consolidateSetFinish,
  consolidateSetPrinting,
  createSetFinishChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../change-event'
import { capitalize } from '../utils'
import { parseSetCodesInput } from '../set-codes'

type CollectionCommandOptions = CacheRefreshOptions & {
  sets?: string
  finish?: string
  condition?: string
  collector?: boolean
  allowDigitalOnlyCards?: boolean
}

type ValuePromptResponse = { value?: string }

/** Pick a finish for an existing entry, defaulting the cursor to the current one. */
async function promptFinishChoice(current: Finish): Promise<Finish | null> {
  const response = (await prompts({
    type: 'select',
    name: 'value',
    message: 'Finish:',
    choices: VALID_FINISHES.map((f) => ({
      title: f === current ? `${capitalize(f)} (current)` : capitalize(f),
      value: f,
    })),
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

function createCollectionStrategy(
  session: CollectionSession,
  sessionConfig: SessionConfig,
  listName: string,
  excludeDigitalOnly: boolean,
): CardSessionStrategy {
  const state: LastAddState = { snapshot: null }
  const list: FlatListStrategyContext<CollectionCardEntry> = {
    session,
    state,
    // Collection entries always carry a condition (a "don't care" pick is stored as
    // NM, matching the admin editor), so render the same default the file will show.
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
    filePath: session.filePath,
    listName,
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
      const { cardName, forcePrompts, isEditing } = input
      let printing = input.preselected
      if (!printing) {
        const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
        if (!result) {
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
        if (!result) {
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
        const finish = await promptFinishChoice(entry.finish)
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

export function registerCollectionCommand(program: Command): void {
  const collectionCommand = program
    .command('collection')
    .alias('collect')
    .description('Manage your collection of cards by interactively adding them')
    .option('-s, --sets <codes>', 'Filter by set codes (comma-separated, e.g., "FDN, SPG")')
    .option('-f, --finish <finish>', 'Default finish (nonfoil, foil, etched)')
    .option('-c, --condition <condition>', 'Default condition (NM, LP, MP, HP, DMG)')
    .option('--collector', 'Start in collector number mode')
    .option('--allow-digital-only-cards', 'Include digital-only sets (e.g., Alchemy)')
  applyCacheRefreshOptions(collectionCommand)
  collectionCommand.action(async (options: CollectionCommandOptions) => {
    const parsedSets = options.sets ? parseSetCodesInput(options.sets) : undefined
    const excludeDigitalOnly = !options.allowDigitalOnlyCards

    const cardNames = await prepareCardSessionCache(options, parsedSets, excludeDigitalOnly)
    if (!cardNames) return

    const existingCollections = await listMarkdownNames(getCollectionsDir())
    const selection = await promptListSelection({
      message: 'Select a collection file',
      items: existingCollections.map((c) => ({ title: c, value: c })),
      createTitle: '+ Create New Collection',
      newNameMessage: 'Enter name for new collection:',
    })
    if (!selection) return
    const selectedCollection = selection.kind === 'new' ? selection.name : selection.value

    const collectionFile = await ensureCollectionFile(selectedCollection)
    const session = await loadCollectionSession(collectionFile)

    const upperCondition = options.condition?.toUpperCase()
    const sessionConfig: SessionConfig = {
      sets: parsedSets,
      finish: isFinish(options.finish) ? options.finish : undefined,
      condition: isCondition(upperCondition) ? upperCondition : undefined,
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
      strategy: createCollectionStrategy(
        session,
        sessionConfig,
        selectedCollection,
        excludeDigitalOnly,
      ),
      cardNames,
      excludeDigitalOnly,
    })
  })
}
