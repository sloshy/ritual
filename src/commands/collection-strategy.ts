import prompts from 'prompts'
import { DEFAULT_LOCALE } from '../i18n/runtime'
import { t, tIn } from '../i18n/t'
import {
  conditionLabel,
  finishChoices,
  finishRows,
  formatCollectionLine,
  isCondition,
  isFinish,
  lookupPinnedPrinting,
  promptFinishAndCondition,
  promptLanguageChoice,
  resolveAddedLanguage,
  resolveCardPrinting,
  VALID_CONDITIONS,
  VALID_FINISHES,
} from './collection-helpers'
import {
  menuItem,
  promptEditAction,
  promptSessionConfigUpdate,
  type CardSessionContext,
  type CardSessionStrategy,
  type MenuChoice,
  type MenuSentinel,
  type SessionConfig,
} from './card-session'
import {
  addAnotherFlatListCopy,
  applyFlatListCardEntry,
  applyFlatListChange,
  discardFlatListAdd,
  listFlatListSessionAdds,
  persistFlatListSession,
  receiveFlatListMove,
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
  moveFlatListEntry,
  removeFlatListEntry,
  discardFlatListSessionChange,
  listFlatListSessionChanges,
  undoFlatListEdit,
} from './flat-list-edit'
import type { MoveTargetsProvider } from './edit-move'
import type { CollectionCardEntry } from '../site/data-types'
import type { Condition, Finish, ScryfallCard } from '../types'
import {
  consolidateSetFinish,
  consolidateSetLabel,
  consolidateSetLanguage,
  consolidateSetPrinting,
  createSetFinishChange,
  createSetLabelChange,
  createSetLanguageChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../change-event'
import { displayLanguage, type CardLanguage } from '../card-language'
import {
  CARD_LABEL_CHOICES,
  CARD_LABEL_DEFAULT_CHOICES,
  formatCardLabels,
  parseCardLabelsValue,
  sameCardLabels,
  type CardLabel,
  type CardLabelChoice,
} from '../card-labels'
import { dumpFrontMatterBlock, readFrontMatterMapping } from '../front-matter-write'
import { applyLabelsPatch } from '../flat-list-metadata'

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
    message: t('cli.printing.promptFinishShort'),
    choices,
    initial: Math.max(0, VALID_FINISHES.indexOf(current)),
  })) as ValuePromptResponse
  return isFinish(response.value) ? response.value : null
}

/**
 * Pick a label state from `choices`, marking the current one and starting the
 * cursor on it. Returns null when cancelled. Choices round-trip through their
 * canonical serialized form (`''` for the clear row) — a real domain value,
 * like `promptConditionChoice`'s, rather than an array index. Shared by the
 * per-card override picker and the list-default picker.
 */
async function promptLabelChoiceFrom(
  choices: readonly CardLabelChoice[],
  current: readonly CardLabel[] | undefined,
  message: string,
): Promise<CardLabel[] | null> {
  const currentKey = formatCardLabels(current ?? [])
  const currentIndex = choices.findIndex((choice) => formatCardLabels(choice.labels) === currentKey)
  const response = (await prompts({
    type: 'select',
    name: 'value',
    message,
    choices: choices.map((choice, i) => ({
      title:
        i === currentIndex ? t('cli.edit.current', { label: t(choice.label) }) : t(choice.label),
      value: formatCardLabels(choice.labels),
    })),
    initial: Math.max(0, currentIndex),
  })) as ValuePromptResponse
  const key = response.value
  if (key === undefined) return null
  const picked = choices.find((choice) => formatCardLabels(choice.labels) === key)
  return picked ? [...picked.labels] : null
}

/**
 * Pick a label override for an existing entry: the four label states plus
 * "Use list default" (clear, encoded as `[]`).
 */
async function promptLabelChoice(
  current: readonly CardLabel[] | undefined,
): Promise<CardLabel[] | null> {
  return promptLabelChoiceFrom(CARD_LABEL_CHOICES, current, t('cli.collection.promptLabel'))
}

/** Pick a condition for an existing entry, defaulting the cursor to the current one. */
async function promptConditionChoice(current: Condition): Promise<Condition | null> {
  const response = (await prompts({
    type: 'select',
    name: 'value',
    message: t('cli.printing.promptCondition'),
    choices: VALID_CONDITIONS.map((c) => ({
      title:
        c === current ? t('cli.edit.current', { label: conditionLabel(c) }) : conditionLabel(c),
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
  moveTargets?: MoveTargetsProvider,
): CardSessionStrategy {
  const state: LastAddState = { snapshot: null }
  const list: FlatListStrategyContext<CollectionCardEntry> = {
    session,
    state,
    // A "don't care" condition pick defaults to NM (matching the admin editor);
    // formatCollectionLine omits the default NM token, so the rendered line matches
    // what the file will show.
    renderLine: (name, snapshot, cardId) =>
      formatCollectionLine({
        cardName: name,
        set: snapshot.options.set ?? '',
        collectorNumber: snapshot.options.collectorNumber ?? '',
        finish: snapshot.options.finish ?? 'nonfoil',
        condition: snapshot.options.condition ?? 'NM',
        language: snapshot.options.language,
        note: snapshot.note,
        cardId,
      }).trim(),
    renderEntry: (entry) =>
      formatCollectionLine({
        cardName: entry.name,
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        condition: entry.condition,
        language: entry.language,
        labels: entry.labels,
        note: entry.note,
        cardId: entry.cardId,
      }).trim(),
    sessionAdds: [],
    editUndo: [],
    originals: new Map(),
  }

  /** Re-render the entry after an edit (apply replaces entry objects). */
  const logUpdated = (cardId: number, fallbackName: string): void => {
    const updated = findFlatListEntry(list, cardId)
    console.log(
      t('cli.edit.changedLine', { line: updated ? list.renderEntry(updated) : fallbackName }),
    )
  }

  /** The list's current default labels, read from the session's front-matter block. */
  const currentDefaultLabels = (): CardLabel[] => {
    const raw = session.frontMatter?.data.labels
    if (raw === undefined) return []
    const parsed = parseCardLabelsValue(raw, 'labels')
    return parsed.ok ? parsed.labels : []
  }

  /**
   * Edit the list's default labels (`labels:` front matter). Deferred like
   * every session edit — the block is rebuilt in memory and written on Save,
   * following the deck strategy's Change Format precedent (model mutation +
   * dirty flag, no ChangeEvent: front matter is not a card change).
   */
  const editListLabels = async (): Promise<void> => {
    if (session.frontMatter) {
      // A merge over keys we cannot see would clobber them (the same refusal
      // the metadata write path gives).
      const mapping = readFrontMatterMapping(session.frontMatter.raw)
      if (!mapping.ok) {
        console.error(t('cli.collection.frontMatterUnreadable'))
        return
      }
    }
    const data = session.frontMatter?.data ?? {}
    const stored =
      data.labels === undefined ? undefined : parseCardLabelsValue(data.labels, 'labels')
    const current = stored?.ok ? stored.labels : []
    const labels = await promptLabelChoiceFrom(
      CARD_LABEL_DEFAULT_CHOICES,
      current,
      t('cli.collection.promptDefaultLabels'),
    )
    if (labels === null) return
    // A stored value the parser refuses reads as "none" above, but re-picking
    // "No default" must still rewrite the block — it is how the TUI repairs an
    // invalid hand-edited value.
    const storedIsClean = stored === undefined || stored.ok
    if (storedIsClean && sameCardLabels(labels, current)) return

    const merged = applyLabelsPatch(data, labels)
    const dumped = dumpFrontMatterBlock(merged)
    session.frontMatter = dumped === undefined ? undefined : { raw: dumped, data: merged }
    session.dirty = true
    console.log(
      labels.length > 0
        ? t('cli.collection.defaultLabelsSet', { labels: formatCardLabels(labels) })
        : t('cli.collection.defaultLabelsCleared'),
    )
  }

  return {
    managerLabel: t('cli.manager.collection'),
    saveTarget: { filePath: session.filePath, listName },
    sessionConfig,
    extraMenuItems: (): MenuChoice[] => {
      const params = {
        labels: formatCardLabels(currentDefaultLabels()) || t('cli.collection.labelsNone'),
      }
      return [
        menuItem(`🏷️  ${t('cli.collection.menuListLabels', params)}`, '__LIST_LABELS__', [
          tIn(DEFAULT_LOCALE, 'cli.collection.menuListLabels', params),
        ]),
      ]
    },
    handleSentinel: async (_ctx: CardSessionContext, value: MenuSentinel): Promise<void> => {
      if (value === '__LIST_LABELS__') await editListLabels()
    },
    updateConfig: (excludeDigital: boolean) =>
      promptSessionConfigUpdate(sessionConfig, true, excludeDigital),
    applyChange: (change: ChangeEvent) => applyFlatListChange(session, change),
    receiveMove: (change) => receiveFlatListMove(session, change),
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
      // Set only when the picker's availability confirm resolved a language
      // (the printing does not exist in the configured default language).
      let pickedLanguage: CardLanguage | undefined
      if (!printing) {
        const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
        if (result.kind === 'cancelled') return
        if (result.kind === 'none') {
          // A collection entry requires a printing (name-only lines are not part of the
          // collection format), so there is nothing sensible to add here.
          if (!isEditing) console.error(t('cli.collection.noPrintingsSkip'))
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

      await applyFlatListCardEntry(
        list,
        ctx,
        cardName,
        {
          set: printing.set.toLowerCase(),
          collectorNumber: printing.collector_number,
          finish: finishAndCondition.finish,
          condition: finishAndCondition.condition,
          language: resolveAddedLanguage(pickedLanguage),
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
        { title: `🖼️  ${t('cli.editAction.changePrinting')}`, value: 'printing' },
        { title: `✨ ${t('cli.editAction.changeFinish')}`, value: 'finish' },
        { title: `📋 ${t('cli.editAction.changeCondition')}`, value: 'condition' },
        { title: `🌐 ${t('cli.editAction.changeLanguage')}`, value: 'language' },
        { title: `🏷️  ${t('cli.editAction.changeLabel')}`, value: 'label' },
        ...(moveTargets
          ? [{ title: `📤 ${t('cli.editAction.moveToList')}`, value: 'move-list' }]
          : []),
        { title: `📝 ${t('cli.editAction.editNote')}`, value: 'note' },
        { title: `🗑️  ${t('cli.editAction.remove')}`, value: 'remove' },
      ])
      if (!action) return

      if (action === 'printing') {
        const result = await resolveCardPrinting(entry.name, sessionConfig, excludeDigitalOnly)
        if (result.kind === 'cancelled') return
        if (result.kind === 'none') {
          console.error(t('cli.edit.noPrintings'))
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
          // The entry keeps its language across a printing change unless the
          // picker's availability confirm resolved a different one (resolved
          // explicitly so the tuple restores/compares the real token).
          language: result.language ?? displayLanguage(entry.language),
        }
        const before = entryPrinting(entry)
        applyFlatListFieldEdit(list, ctx, entry, cardId, {
          label: t('cli.editLabel.printing', { name: entry.name }),
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
          label: t('cli.editLabel.finish', { name: entry.name }),
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
          label: t('cli.editLabel.condition', { name: entry.name }),
          change: createSetPrintingChange(entry.name, { ...target, cardId }),
          inverse: createSetPrintingChange(entry.name, { ...entryPrinting(entry), cardId }),
          consolidate: (changes, original) =>
            consolidateSetPrinting(changes, entry.name, target, entryPrinting(original), cardId),
        })
        logUpdated(cardId, entry.name)
        return
      }

      if (action === 'language') {
        const language = await promptLanguageChoice(entry.language)
        if (language === null || language === displayLanguage(entry.language)) return
        applyFlatListFieldEdit(list, ctx, entry, cardId, {
          label: t('cli.editLabel.language', { name: entry.name }),
          change: createSetLanguageChange(entry.name, { language, cardId }),
          inverse: createSetLanguageChange(entry.name, {
            language: displayLanguage(entry.language),
            cardId,
          }),
          consolidate: (changes, original) =>
            consolidateSetLanguage(changes, entry.name, language, original.language, cardId),
        })
        logUpdated(cardId, entry.name)
        return
      }

      if (action === 'label') {
        const labels = await promptLabelChoice(entry.labels)
        if (labels === null || sameCardLabels(labels, entry.labels)) {
          return
        }
        applyFlatListFieldEdit(list, ctx, entry, cardId, {
          label: t('cli.editLabel.labels', { name: entry.name }),
          change: createSetLabelChange(entry.name, { labels, cardId }),
          inverse: createSetLabelChange(entry.name, { labels: [...(entry.labels ?? [])], cardId }),
          consolidate: (changes, original) =>
            consolidateSetLabel(changes, entry.name, labels, original.labels, cardId),
        })
        logUpdated(cardId, entry.name)
        return
      }

      if (action === 'move-list' && moveTargets) {
        await moveFlatListEntry(list, ctx, entry, cardId, {
          targets: moveTargets,
          selfFile: session.filePath,
          sessionConfig,
          excludeDigitalOnly,
        })
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
