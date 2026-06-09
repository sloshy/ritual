import { Command } from 'commander'
import type { Choice } from 'prompts'
import type { DeckData } from '../types'
import {
  isCondition,
  isFinish,
  promptFinishAndCondition,
  resolveCardPrinting,
} from './collection-helpers'
import {
  type DeckSessionConfig,
  ensureDeckFile,
  findDeckCard,
  listExistingDecks,
  loadDeck,
  promptDeckConfigUpdate,
  promptSetTargetSection,
  resolveTargetSection,
  writeDeck,
} from './deck-helpers'
import {
  loadCardNamesOrWarn,
  loadCollectorSets,
  promptListSelection,
  runCardSession,
  type CardSessionContext,
  type CardSessionStrategy,
} from './card-session'
import { assignMissingDeckCardIds } from '../card-id'
import { normalizeBoard } from './deck-sync-helpers'
import {
  createAddChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../change-event'
import { applyChangeToDeck } from '../editor/deck-changes'
import { trackAdd, trackAnotherCopy, trackEdit } from '../session-changelog'
import { formatSpecificPrintingPrice } from '../price-currency'
import { parseSetCodesInput } from '../set-codes'

type DeckCommandOptions = {
  sets?: string
  finish?: string
  condition?: string
  section?: string
  collector?: boolean
  allowDigitalOnlyCards?: boolean
}

type DeckStrategyArgs = {
  deckFile: string
  deckName: string
  initialDeck: DeckData
  frontMatter: Record<string, unknown>
  sessionConfig: DeckSessionConfig
  excludeDigitalOnly: boolean
}

function createDeckStrategy(args: DeckStrategyArgs): CardSessionStrategy {
  const { deckFile, deckName, frontMatter, sessionConfig, excludeDigitalOnly } = args
  // Mutable in-memory deck — the single source of truth, re-serialized after each change.
  let deck: DeckData = args.initialDeck
  let lastSection: string | null = null
  let lastPrinting: PrintingTuple | null = null

  /**
   * Apply a change to the in-memory deck and persist it. IDs are assigned to
   * the in-memory copy too (not just on serialize) so the in-memory deck and
   * the file stay identical and subsequent edits resolve cards by ID.
   */
  const applyAndSave = async (change: ChangeEvent): Promise<void> => {
    deck = assignMissingDeckCardIds(applyChangeToDeck(deck, change))
    await writeDeck(deckFile, deck, frontMatter)
  }

  /** Add a card (with or without a printing) to `section`, tracking it as the last added. */
  const addToDeck = async (
    ctx: CardSessionContext,
    cardName: string,
    printing: PrintingTuple,
    section: string,
  ): Promise<void> => {
    await applyAndSave(
      createAddChange(cardName, { ...printing, section, board: normalizeBoard(section) }),
    )

    // Recover the assigned card ID for the changelog and "last added" tracking.
    const located = findDeckCard(deck, cardName, printing, section)
    ctx.lastChangeIndex = trackAdd(
      ctx.sessionChanges,
      createAddChange(cardName, {
        ...printing,
        section,
        board: normalizeBoard(section),
        cardId: located?.cardId,
      }),
    )

    ctx.lastAdded = { name: cardName, hasNote: false, cardId: located?.cardId }
    ctx.lastAddedCount = 1
    lastSection = located?.section ?? section
    lastPrinting = printing
    const printingInfo = printing.set
      ? ` (${printing.set.toUpperCase()}:${printing.collectorNumber})`
      : ''
    console.log(`Added: ${cardName}${printingInfo} to ${section}`)
  }

  return {
    managerLabel: 'deck manager',
    filePath: deckFile,
    listName: deckName,
    sessionConfig,
    extraMenuItems: (): Choice[] => [
      {
        title: `🗂️  Set Target Section (${sessionConfig.targetSection ?? 'prompt every time'})`,
        value: '__SECTION__',
      },
    ],
    handleSentinel: async (_ctx: CardSessionContext, value: string): Promise<boolean> => {
      if (value === '__SECTION__') {
        await promptSetTargetSection(deck, sessionConfig)
        return true
      }
      return false
    },
    updateConfig: (excludeDigital: boolean) =>
      promptDeckConfigUpdate(deck, sessionConfig, excludeDigital),
    applyAndSave,

    async handleCard(ctx: CardSessionContext, input): Promise<void> {
      const { cardName, forcePrompts, isEditing } = input
      let printing = input.preselected
      if (!printing) {
        const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
        if (!result) {
          if (isEditing) return
          // Deck lines may omit the printing, so fall back to a name-only add
          // rather than dropping the card.
          console.error('No printings found. Adding name only.')
          const section = await resolveTargetSection(deck, sessionConfig)
          if (!section) {
            console.log('No section selected. Skipping.')
            return
          }
          await addToDeck(ctx, cardName, {}, section)
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

      const printingTuple: PrintingTuple = {
        set: printing.set.toLowerCase(),
        collectorNumber: printing.collector_number,
        finish: finishAndCondition.finish,
        condition: finishAndCondition.condition,
      }

      // ── Edit: re-set the printing on the existing card ────────────
      if (isEditing && ctx.lastAdded) {
        await applyAndSave(
          createSetPrintingChange(cardName, { ...printingTuple, cardId: ctx.lastAdded.cardId }),
        )
        // The changelog records the entry's final state as an add.
        const addEvent = createAddChange(cardName, {
          ...printingTuple,
          cardId: ctx.lastAdded.cardId,
          section: lastSection ?? undefined,
          board: lastSection ? normalizeBoard(lastSection) : undefined,
        })
        ctx.lastChangeIndex = trackEdit(ctx.sessionChanges, ctx.lastChangeIndex, addEvent, true)
        lastPrinting = printingTuple
        console.log(
          `Edited ${cardName} → ${printingTuple.set?.toUpperCase()}:${printingTuple.collectorNumber}`,
        )
        return
      }

      // ── Add a new copy to the resolved section ────────────────────
      const section = await resolveTargetSection(deck, sessionConfig)
      if (!section) {
        console.log('No section selected. Skipping.')
        return
      }
      await addToDeck(ctx, cardName, printingTuple, section)
      console.log(formatSpecificPrintingPrice(printing, finishAndCondition.finish))
    },

    async addAnotherCopy(ctx: CardSessionContext): Promise<void> {
      if (!ctx.lastAdded || !lastSection) return
      // Another copy of the same printing merges into the existing line, so the
      // entry keeps its card ID and only the quantity increments.
      await applyAndSave(
        createAddChange(ctx.lastAdded.name, {
          ...(lastPrinting ?? undefined),
          cardId: ctx.lastAdded.cardId,
          section: lastSection,
          board: normalizeBoard(lastSection),
        }),
      )
      const newIdx = trackAnotherCopy(ctx.sessionChanges, ctx.lastChangeIndex)
      if (newIdx !== null) ctx.lastChangeIndex = newIdx
      ctx.lastAddedCount++
      console.log(
        `Added another ${ctx.lastAdded.name} to ${lastSection} (${ctx.lastAddedCount}x total)`,
      )
    },
  }
}

export function registerDeckCommand(program: Command): void {
  program
    .command('deck')
    .description('Manage a deck by interactively adding cards to named sections')
    .option('-s, --sets <codes>', 'Filter by set codes (comma-separated, e.g., "FDN, SPG")')
    .option('-f, --finish <finish>', 'Default finish (nonfoil, foil, etched)')
    .option('-c, --condition <condition>', 'Default condition (NM, LP, MP, HP, DMG)')
    .option('--section <name>', 'Add cards to this section (otherwise prompts per card)')
    .option('--collector', 'Start in collector number mode')
    .option('--allow-digital-only-cards', 'Include digital-only sets (e.g., Alchemy)')
    .action(async (options: DeckCommandOptions) => {
      const parsedSets = options.sets ? parseSetCodesInput(options.sets) : undefined
      const excludeDigitalOnly = !options.allowDigitalOnlyCards

      const cardNames = await loadCardNamesOrWarn(parsedSets, excludeDigitalOnly)
      if (!cardNames) return

      // Select or create a deck. Choices show each deck's display name (front
      // matter `name:`), while the selected value carries its file path.
      const existingDecks = await listExistingDecks()
      const selection = await promptListSelection({
        message: 'Select a deck',
        items: existingDecks.map((d) => ({ title: d.name, value: d.file })),
        createTitle: '+ Create New Deck',
        newNameMessage: 'Enter name for new deck:',
      })
      if (!selection) return

      let deckName: string
      let deckFile: string
      if (selection.kind === 'new') {
        deckName = selection.name
        deckFile = await ensureDeckFile(deckName)
      } else {
        const selected = existingDecks.find((d) => d.file === selection.value)
        if (!selected) return
        deckName = selected.name
        deckFile = selected.file
      }

      const loaded = await loadDeck(deckFile)

      const upperCondition = options.condition?.toUpperCase()
      const sessionConfig: DeckSessionConfig = {
        sets: parsedSets,
        finish: isFinish(options.finish) ? options.finish : undefined,
        condition: isCondition(upperCondition) ? upperCondition : undefined,
        entryMode: options.collector ? 'collector' : 'name',
        collectorSets: [],
        activeSetIndex: 0,
        setCardMaps: new Map(),
        targetSection: options.section ?? null,
      }

      // Pre-load set data when starting in collector mode with sets provided
      if (options.collector && parsedSets && parsedSets.length > 0) {
        await loadCollectorSets(sessionConfig, parsedSets)
      }

      await runCardSession({
        strategy: createDeckStrategy({
          deckFile,
          deckName,
          initialDeck: loaded.deck,
          frontMatter: loaded.frontMatter,
          sessionConfig,
          excludeDigitalOnly,
        }),
        cardNames,
        excludeDigitalOnly,
      })
    })
}
