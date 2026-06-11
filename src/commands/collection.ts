import { Command } from 'commander'
import { getCollectionsDir } from '../ritual-config'
import {
  ensureCollectionFile,
  formatCollectionLine,
  isCondition,
  isFinish,
  promptFinishAndCondition,
  resolveCardPrinting,
} from './collection-helpers'
import {
  listMarkdownNames,
  loadCardNamesOrWarn,
  loadCollectorSets,
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
  loadCollectionSession,
  type CollectionSession,
  type FlatListStrategyContext,
  type LastAddState,
} from './flat-list-session'
import type { CollectionCardEntry } from '../site/data-types'
import type { ChangeEvent } from '../change-event'
import { parseSetCodesInput } from '../set-codes'

type CollectionCommandOptions = {
  sets?: string
  finish?: string
  condition?: string
  collector?: boolean
  allowDigitalOnlyCards?: boolean
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
  }

  return {
    managerLabel: 'collection manager',
    filePath: session.filePath,
    listName,
    sessionConfig,
    updateConfig: (excludeDigital: boolean) =>
      promptSessionConfigUpdate(sessionConfig, true, excludeDigital),
    applyAndSave: (change: ChangeEvent) => applyFlatListChange(session, change),
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
    discardSessionAdd: (ctx: CardSessionContext, index: number) =>
      discardFlatListAdd(list, ctx, index),
  }
}

export function registerCollectionCommand(program: Command): void {
  program
    .command('collection')
    .alias('collect')
    .description('Manage your collection of cards by interactively adding them')
    .option('-s, --sets <codes>', 'Filter by set codes (comma-separated, e.g., "FDN, SPG")')
    .option('-f, --finish <finish>', 'Default finish (nonfoil, foil, etched)')
    .option('-c, --condition <condition>', 'Default condition (NM, LP, MP, HP, DMG)')
    .option('--collector', 'Start in collector number mode')
    .option('--allow-digital-only-cards', 'Include digital-only sets (e.g., Alchemy)')
    .action(async (options: CollectionCommandOptions) => {
      const parsedSets = options.sets ? parseSetCodesInput(options.sets) : undefined
      const excludeDigitalOnly = !options.allowDigitalOnlyCards

      const cardNames = await loadCardNamesOrWarn(parsedSets, excludeDigitalOnly)
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
