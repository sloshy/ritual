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
  findCardById,
  findDeckCard,
  listExistingDecks,
  loadDeck,
  promptDeckConfigUpdate,
  promptSetTargetSection,
  resolveTargetSection,
  writeDeck,
} from './deck-helpers'
import {
  applyDeckChange,
  discardDeckSessionAdd,
  discardDeckSessionChange,
  editDeckCard,
  lastDeckEditLabel,
  listDeckEntries,
  listDeckSessionAdds,
  listDeckSessionChanges,
  undoDeckEdit,
  type DeckSessionState,
} from './deck-edit'
import {
  applyCacheRefreshOptions,
  loadCollectorSets,
  prepareCardSessionCache,
  promptListSelection,
  runCardSession,
  type CacheRefreshOptions,
  type CardSessionContext,
  type CardSessionStrategy,
  type SessionAddItem,
} from './card-session'
import { normalizeBoard } from './deck-sync-helpers'
import {
  createAddChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../change-event'
import { trackAdd, trackAnotherCopy, trackEdit } from '../session-changelog'
import { formatSpecificPrintingPrice } from '../price-currency'
import { parseSetCodesInput } from '../set-codes'

type DeckCommandOptions = CacheRefreshOptions & {
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
  // Mutable in-memory deck session — the single source of truth, written to
  // disk only when the session is saved. Per-copy adds (one per copy, in add
  // order) drive the discard picker; the distinct line ids first created this
  // session are what re-pack keeps dense on full removal.
  const state: DeckSessionState = {
    deck: args.initialDeck,
    sessionAdds: [],
    sessionLineIds: [],
    editUndo: [],
    originals: new Map(),
    dirty: false,
  }
  let lastSection: string | null = null
  let lastPrinting: PrintingTuple | null = null

  /** Add a card (with or without a printing) to `section`, tracking it as the last added. */
  const addToDeck = async (
    ctx: CardSessionContext,
    cardName: string,
    printing: PrintingTuple,
    section: string,
  ): Promise<void> => {
    applyDeckChange(
      state,
      createAddChange(cardName, { ...printing, section, board: normalizeBoard(section) }),
    )

    // Recover the assigned card ID for the changelog and "last added" tracking.
    const located = findDeckCard(state.deck, cardName, printing, section)
    ctx.lastChangeIndex = trackAdd(
      ctx.sessionChanges,
      createAddChange(cardName, {
        ...printing,
        section,
        board: normalizeBoard(section),
        cardId: located?.cardId,
      }),
    )

    if (located?.cardId !== undefined) {
      state.sessionAdds.push({ cardId: located.cardId, name: cardName, printing, section })
      // A quantity of 1 after the add means this add created the line, so its id was
      // allocated this session and participates in re-pack when fully discarded.
      if (findCardById(state.deck, located.cardId)?.card.quantity === 1) {
        state.sessionLineIds.push(located.cardId)
      }
    }

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
        await promptSetTargetSection(state.deck, sessionConfig)
        return true
      }
      return false
    },
    updateConfig: (excludeDigital: boolean) =>
      promptDeckConfigUpdate(state.deck, sessionConfig, excludeDigital),
    applyChange: (change: ChangeEvent) => applyDeckChange(state, change),
    persist: async (): Promise<void> => {
      await writeDeck(deckFile, state.deck, frontMatter)
      state.dirty = false
    },
    hasUnsavedChanges: () => state.dirty,
    sessionSaved: (): void => {
      state.sessionAdds = []
      state.sessionLineIds = []
      state.editUndo = []
      state.originals.clear()
      lastSection = null
      lastPrinting = null
    },

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
          const section = await resolveTargetSection(state.deck, sessionConfig)
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
        applyDeckChange(
          state,
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
      const section = await resolveTargetSection(state.deck, sessionConfig)
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
      applyDeckChange(
        state,
        createAddChange(ctx.lastAdded.name, {
          ...(lastPrinting ?? undefined),
          cardId: ctx.lastAdded.cardId,
          section: lastSection,
          board: normalizeBoard(lastSection),
        }),
      )
      const newIdx = trackAnotherCopy(ctx.sessionChanges, ctx.lastChangeIndex)
      if (newIdx !== null) ctx.lastChangeIndex = newIdx
      if (ctx.lastAdded.cardId !== undefined) {
        // Copies merge into the existing line, so this records another copy of the
        // same id (no new line id, hence nothing added to sessionLineIds).
        state.sessionAdds.push({
          cardId: ctx.lastAdded.cardId,
          name: ctx.lastAdded.name,
          printing: lastPrinting ?? {},
          section: lastSection,
        })
      }
      ctx.lastAddedCount++
      console.log(
        `Added another ${ctx.lastAdded.name} to ${lastSection} (${ctx.lastAddedCount}x total)`,
      )
    },

    listSessionAdds: (): SessionAddItem[] => listDeckSessionAdds(state),

    async discardSessionAdd(ctx: CardSessionContext, index: number): Promise<void> {
      if (!discardDeckSessionAdd(state, ctx, index)) return
      // The discarded copy may have been the "last added"; reset so the copy/edit
      // shortcuts don't point at a stale entry until the next add.
      lastSection = null
      lastPrinting = null
    },

    listSessionChanges: () => listDeckSessionChanges(state),

    async discardSessionChange(ctx: CardSessionContext, index: number): Promise<void> {
      if (!discardDeckSessionChange(state, ctx, index)) return
      // A discarded copy may have been the "last added"; reset so the copy/edit
      // shortcuts don't point at a stale entry until the next add.
      lastSection = null
      lastPrinting = null
    },

    listEntries: () => listDeckEntries(state.deck),
    lastEditUndoLabel: () => lastDeckEditLabel(state),
    undoLastEdit: async (ctx: CardSessionContext) => undoDeckEdit(state, ctx),
    editEntry: (ctx: CardSessionContext, cardId: number) =>
      editDeckCard(state, ctx, cardId, { sessionConfig, excludeDigitalOnly }),
  }
}

export function registerDeckCommand(program: Command): void {
  const deckCommand = program
    .command('deck')
    .description('Manage a deck by interactively adding cards to named sections')
    .option('-s, --sets <codes>', 'Filter by set codes (comma-separated, e.g., "FDN, SPG")')
    .option('-f, --finish <finish>', 'Default finish (nonfoil, foil, etched)')
    .option('-c, --condition <condition>', 'Default condition (NM, LP, MP, HP, DMG)')
    .option('--section <name>', 'Add cards to this section (otherwise prompts per card)')
    .option('--collector', 'Start in collector number mode')
    .option('--allow-digital-only-cards', 'Include digital-only sets (e.g., Alchemy)')
  applyCacheRefreshOptions(deckCommand)
  deckCommand.action(async (options: DeckCommandOptions) => {
    const parsedSets = options.sets ? parseSetCodesInput(options.sets) : undefined
    const excludeDigitalOnly = !options.allowDigitalOnlyCards

    const cardNames = await prepareCardSessionCache(options, parsedSets, excludeDigitalOnly)
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
