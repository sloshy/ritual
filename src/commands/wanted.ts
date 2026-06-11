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
  type FlatListStrategyContext,
  type LastAddState,
  type WantedSession,
} from './flat-list-session'
import type { WantedListCardEntry } from '../site/data-types'
import type { ChangeEvent } from '../change-event'
import { parseSetCodesInput } from '../set-codes'

type WantedCommandOptions = {
  sets?: string
  finish?: string
  collector?: boolean
  allowDigitalOnlyCards?: boolean
}

type SpecificityPromptResponse = { specificity?: 'name-only' | 'specific' }

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
    applyAndSave: (change: ChangeEvent) => applyFlatListChange(session, change),
    noteAdded: (note: string): void => {
      if (state.snapshot) state.snapshot.note = note
    },

    async handleCard(ctx: CardSessionContext, input): Promise<void> {
      const { cardName, forcePrompts, isEditing } = input

      // Prompt for specificity level
      const specificityResponse = (await prompts({
        type: 'select',
        name: 'specificity',
        message: `How specific for ${cardName}?`,
        choices: [
          { title: 'Name only (cheapest printing)', value: 'name-only' },
          { title: 'Choose specific printing', value: 'specific' },
        ],
      })) as SpecificityPromptResponse
      if (!specificityResponse.specificity) return

      if (specificityResponse.specificity === 'name-only') {
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
    discardSessionAdd: (ctx: CardSessionContext, index: number) =>
      discardFlatListAdd(list, ctx, index),
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
