import { ask } from '../../cli/prompts'
import type { DeckData } from '../../list/deck'
import { promptDefaultLabelsChoice, promptFinishAndCondition, resolveCardPrinting } from './prompts'
import { resolveAddedLanguage } from '../../card/printing-pin'
import { formatCardLabels, sameCardLabels } from '../../card/card-labels'
import { languageToken, type CardLanguage } from '../../card/card-language'
import type { SessionConfig } from './config'
import { findCardById, findDeckCard, writeDeck } from '../../list/deck-io'
import {
  promptDeckConfigUpdate,
  promptDeckFormat,
  promptSetTargetSection,
  resolveTargetSection,
  targetSectionDisplay,
} from './deck-prompts'
import type { MoveTargetsProvider } from './edit-move'
import { t } from '../../i18n/t'
import { getDeckFormatLabel, resolveDeckFormat, type DeckFormatKey } from '../../list/deck-format'
import type { DeckFrontMatter } from '../../list/deck-file'
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
import { menuRow, type MenuChoice, type MenuSentinel } from './menu'
import type { CardSessionContext, CardSessionStrategy, SessionAddItem } from './strategy'
import { normalizeBoard } from '../../deck-sync/diff'
import { assignMissingDeckCardIds, collectDeckCardIds } from '../../card/card-id'
import type { CardArtRef } from '../../list/card-art'
import {
  commitSessionArt,
  createSessionArtChanges,
  noteArtArrival,
  warnUnreconciledArt,
} from './art'
import {
  createAddChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../../changes/change-event'
import { trackAdd, trackAnotherCopy, trackEdit } from '../../changes/session-changelog'
import { splitCommaTokens } from '../../config/config-fields'
import { formatSpecificPrintingPrice } from '../../pricing/price-currency'
import { getDefaultCurrency } from '../../config/ritual-config'

export type DeckStrategyArgs = {
  deckFile: string
  deckName: string
  initialDeck: DeckData
  frontMatter: DeckFrontMatter
  sessionConfig: SessionConfig
  excludeDigitalOnly: boolean
  /**
   * Start the session unsaved. Set for a deck that does not exist on disk yet,
   * so its creation survives as a pending change until the session is saved.
   */
  initiallyDirty?: boolean
  /** Present when the session can move cards to other lists (the unified editor). */
  moveTargets?: MoveTargetsProvider
}

/** Build the deck half of a card session. Shared with the unified `edit` command. */
export function createDeckStrategy(args: DeckStrategyArgs): CardSessionStrategy {
  const { deckFile, deckName, frontMatter, sessionConfig, excludeDigitalOnly } = args
  // Mutable in-memory deck session — the single source of truth, written to
  // disk only when the session is saved. Per-copy adds (one per copy, in add
  // order) drive the discard picker; the distinct line ids first created this
  // session are what re-pack keeps dense on full removal.
  const state: DeckSessionState = {
    filePath: deckFile,
    deck: args.initialDeck,
    sessionAdds: [],
    sessionLineIds: [],
    pendingMoveIds: [],
    editUndo: [],
    originals: new Map(),
    dirty: args.initiallyDirty ?? false,
    art: createSessionArtChanges(),
  }
  let lastSection: string | null = null
  let lastPrinting: PrintingTuple | null = null

  /**
   * The deck's format, resolved the same way the site resolves it — declared in
   * front matter, else inferred from the sections — so a deck the site shows as
   * "Commander" never reads as "not set" here.
   */
  const currentFormat = (): DeckFormatKey | null =>
    resolveDeckFormat(state.deck, frontMatter.format)

  /** The deck's format as shown in the menu: its label, or "not set". */
  const formatDisplay = (): string => {
    const format = currentFormat()
    return format ? getDeckFormatLabel(format) : t('cli.deck.formatNotSet')
  }

  /**
   * Prompt for a new deck format and apply it to the front matter. Format is a
   * deck-level property outside the card change-event model, so it marks the
   * session dirty (persisted by the next save) without a changelog entry.
   */
  const changeFormat = async (): Promise<void> => {
    const current = currentFormat()
    const next = await promptDeckFormat({ current })
    if (!next || next === current) return
    frontMatter.format = next
    state.deck.format = next
    state.dirty = true
    console.log(t('cli.deck.formatChanged', { format: getDeckFormatLabel(next) }))
  }

  /** The deck's tags as shown in the menu: comma-joined, or "none". */
  const tagsDisplay = (): string =>
    frontMatter.tags && frontMatter.tags.length > 0
      ? frontMatter.tags.join(', ')
      : t('cli.deck.tagsNone')

  /**
   * Prompt for the deck's tags (comma-separated; empty clears them). Like a
   * format change, tags are deck-level front matter outside the card
   * change-event model: the edit marks the session dirty and is persisted by
   * the next save, with no changelog entry. Description and the sync source
   * stay out of the TUI — a single-line prompt would mangle a multi-line
   * description, and linking is `deck-sync link`'s job — `ritual metadata set`
   * covers both.
   */
  const changeTags = async (): Promise<void> => {
    const value = await ask<string>({
      type: 'text',
      message: t('cli.deck.promptTags'),
      subjectKey: 'cli.prompt.subject.deckTags',
      initial: (frontMatter.tags ?? []).join(', '),
    })
    if (value === undefined) return
    const tags = [...new Set(splitCommaTokens([value]))]
    const before = frontMatter.tags ?? []
    if (tags.length === before.length && tags.every((tag, i) => tag === before[i])) return
    if (tags.length === 0) delete frontMatter.tags
    else frontMatter.tags = tags
    state.dirty = true
    console.log(
      tags.length > 0
        ? t('cli.deck.tagsSet', { tags: tags.join(', ') })
        : t('cli.deck.tagsCleared'),
    )
  }

  /** The deck's default labels as shown in the menu row: comma-joined, or "none". */
  const labelsDisplay = (): string =>
    formatCardLabels(frontMatter.labels ?? []) || t('cli.labels.none')

  /**
   * Prompt for the deck's default card labels (`labels:` front matter). Like a
   * format or tags change, this is deck-level front matter outside the card
   * change-event model: the edit marks the session dirty and is persisted by
   * the next save, with no changelog entry.
   */
  const changeLabels = async (): Promise<void> => {
    const current = frontMatter.labels ?? []
    const labels = await promptDefaultLabelsChoice('deck', current)
    if (labels === null || sameCardLabels(labels, current)) return
    if (labels.length === 0) delete frontMatter.labels
    else frontMatter.labels = labels
    state.dirty = true
    console.log(
      labels.length > 0
        ? t('cli.labels.defaultSet', { labels: formatCardLabels(labels) })
        : t('cli.labels.defaultCleared'),
    )
  }

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
    const languageInfo = languageToken(printing.language)
    console.log(
      t('cli.deck.addedCard', { card: `${cardName}${printingInfo}${languageInfo}`, section }),
    )
  }

  return {
    managerLabel: t('cli.manager.deck'),
    saveTarget: { filePath: deckFile, listName: deckName },
    sessionConfig,
    extraMenuItems: (): MenuChoice[] => [
      menuRow('🗂️ ', '__SECTION__', 'cli.deck.menuTargetSection', {
        section: targetSectionDisplay(sessionConfig),
      }),
      menuRow('🏷️ ', '__FORMAT__', 'cli.deck.menuChangeFormat', { format: formatDisplay() }),
      menuRow('🔖', '__TAGS__', 'cli.deck.menuEditTags', { tags: tagsDisplay() }),
      menuRow('🏷️ ', '__LIST_LABELS__', 'cli.labels.menuListLabels', { labels: labelsDisplay() }),
    ],
    handleSentinel: async (_ctx: CardSessionContext, value: MenuSentinel): Promise<void> => {
      if (value === '__SECTION__') await promptSetTargetSection(state.deck, sessionConfig)
      if (value === '__FORMAT__') await changeFormat()
      if (value === '__TAGS__') await changeTags()
      if (value === '__LIST_LABELS__') await changeLabels()
    },
    updateConfig: (excludeDigital: boolean) =>
      promptDeckConfigUpdate(state.deck, sessionConfig, excludeDigital),
    applyChange: (change: ChangeEvent) => applyDeckChange(state, change),
    receiveMove: (change, art?: CardArtRef): void => {
      // The event carries no destination id (`sourceCardId` names the source
      // line); the arriving line gets a deck id of its own via
      // assignMissingDeckCardIds.
      if (art === undefined) {
        applyDeckChange(state, { ...change, cardId: undefined })
        return
      }
      // A deck has no explicit id pool, so the arriving line's `&N` is read off
      // the deck as the one the apply introduced. Heal any line still missing
      // an id first (the apply would do it anyway, idempotently), so that
      // difference names the moved card's line and nothing else.
      state.deck = assignMissingDeckCardIds(state.deck, state.pendingMoveIds)
      const before = new Set(collectDeckCardIds(state.deck))
      applyDeckChange(state, { ...change, cardId: undefined })
      const landed = collectDeckCardIds(state.deck).find((id) => !before.has(id))
      // No new id means the copy merged onto a line the deck already had, which
      // stands for the card in its own right and may carry art of its own.
      if (landed !== undefined) noteArtArrival(state.art, landed, art)
    },
    persist: async (): Promise<void> => {
      await writeDeck(deckFile, state.deck, frontMatter)
      state.dirty = false
      warnUnreconciledArt(await commitSessionArt(deckFile, state.art))
    },
    hasUnsavedChanges: () => state.dirty,
    sessionSaved: (): void => {
      state.sessionAdds = []
      state.sessionLineIds = []
      // The save committed the pending moves, so their id reservations end.
      state.pendingMoveIds = []
      state.editUndo = []
      state.originals.clear()
      lastSection = null
      lastPrinting = null
    },

    async handleCard(ctx: CardSessionContext, input): Promise<void> {
      const { cardName, forcePrompts } = input
      const isEditing = input.intent === 'edit-last'
      let printing = input.preselected
      // Set only when the picker's availability confirm resolved a language
      // (the printing does not exist in the configured default language).
      let pickedLanguage: CardLanguage | undefined
      if (!printing) {
        const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
        // A cancel must not fall through to the name-only fallback below — the
        // user backed out of adding this card entirely.
        if (result.kind === 'cancelled') return
        if (result.kind === 'none') {
          if (isEditing) return
          // Deck lines may omit the printing, so fall back to a name-only add
          // rather than dropping the card.
          console.error(t('cli.edit.noPrintingsNameOnly'))
          const section = await resolveTargetSection(state.deck, sessionConfig)
          if (!section) {
            console.log(t('cli.deck.noSectionSelected'))
            return
          }
          await addToDeck(ctx, cardName, { language: resolveAddedLanguage(undefined) }, section)
          return
        }
        printing = result.printing
        pickedLanguage = result.language
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
        language: resolveAddedLanguage(pickedLanguage),
      }

      // ── Edit: re-set the printing on the existing card ────────────
      if (isEditing && ctx.lastAdded) {
        applyDeckChange(
          state,
          createSetPrintingChange(cardName, {
            ...printingTuple,
            // Explicit, `en` included: an absent language would leave the
            // previous add's token alone, but this edit replaces the entry's
            // options wholesale (mirrors applyFlatListCardEntry).
            language: printingTuple.language ?? 'en',
            cardId: ctx.lastAdded.cardId,
          }),
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
          t('cli.deck.editedPrinting', {
            name: cardName,
            printing: `${printingTuple.set?.toUpperCase()}:${printingTuple.collectorNumber}`,
          }),
        )
        return
      }

      // ── Add a new copy to the resolved section ────────────────────
      const section = await resolveTargetSection(state.deck, sessionConfig)
      if (!section) {
        console.log(t('cli.deck.noSectionSelected'))
        return
      }
      await addToDeck(ctx, cardName, printingTuple, section)
      console.log(
        formatSpecificPrintingPrice(printing, finishAndCondition.finish, getDefaultCurrency()),
      )
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
        t('cli.deck.addedAnother', {
          name: ctx.lastAdded.name,
          section: lastSection,
          count: ctx.lastAddedCount,
        }),
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
      editDeckCard(state, ctx, cardId, {
        sessionConfig,
        excludeDigitalOnly,
        move: args.moveTargets
          ? {
              targets: args.moveTargets,
              selfFile: deckFile,
              sessionConfig,
              excludeDigitalOnly,
            }
          : undefined,
      }),
  }
}
