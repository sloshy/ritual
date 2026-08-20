import prompts from 'prompts'
import {
  finishChoices,
  finishRows,
  isFinish,
  lookupPinnedPrinting,
  promptLanguageChoice,
  resolveAddedLanguage,
  resolveCardPrinting,
  VALID_FINISHES,
} from './collection-helpers'
import {
  formatWantedListLine,
  promptWantedFinish,
  NO_PREFERENCE,
  type WantedFinishChoiceValue,
  type WantedListSessionConfig,
} from './wanted-helpers'
import {
  promptEditAction,
  promptSessionConfigUpdate,
  type CardSessionContext,
  type CardSessionStrategy,
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
  type FlatListStrategyContext,
  type LastAddState,
  type WantedSession,
} from './flat-list-session'
import {
  applyFlatListFieldEdit,
  editFlatListArt,
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
import type { WantedListCardEntry } from '../site/data-types'
import type { Finish, ScryfallCard } from '../types'
import {
  consolidateSetLanguage,
  consolidateSetPrinting,
  createSetLanguageChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../change-event'
import { displayLanguage, type CardLanguage } from '../card-language'
import { t } from '../i18n/t'
import { hasSpecificPrinting } from '../card-printing'

type SpecificityPromptResponse = { specificity?: 'name-only' | 'specific' }
type FinishPromptResponse = { finish?: string }

/** Ask whether a wanted entry should be name-only or pinned to a specific printing. */
async function promptSpecificity(cardName: string): Promise<'name-only' | 'specific' | null> {
  const response = (await prompts({
    type: 'select',
    name: 'specificity',
    message: t('cli.wanted.promptSpecificity', { name: cardName }),
    choices: [
      { title: t('cli.wanted.specificityNameOnly'), value: 'name-only' },
      { title: t('cli.wanted.specificitySpecific'), value: 'specific' },
    ],
  })) as SpecificityPromptResponse
  return response.specificity ?? null
}

/**
 * Pick a finish for an existing wanted entry, including "No preference" (which
 * clears the finish back off the line). Returns undefined for no preference and
 * null on cancel. `printing` prices the choices; it is undefined when the entry's
 * pinned printing isn't in the card cache.
 */
async function promptWantedFinishChoice(
  current: Finish | undefined,
  printing: ScryfallCard | undefined,
): Promise<Finish | undefined | null> {
  const choices = finishChoices<WantedFinishChoiceValue>(
    [
      {
        label:
          current === undefined
            ? t('cli.edit.current', { label: t('cli.wanted.noPreference') })
            : t('cli.wanted.noPreferenceAny'),
        value: NO_PREFERENCE,
      },
      ...finishRows(VALID_FINISHES, current),
    ],
    printing,
  )
  const response = (await prompts({
    type: 'select',
    name: 'finish',
    message: t('cli.printing.promptFinishShort'),
    choices,
    initial: current === undefined ? 0 : Math.max(0, VALID_FINISHES.indexOf(current) + 1),
  })) as FinishPromptResponse
  if (response.finish === undefined) return null
  if (response.finish === NO_PREFERENCE) return undefined
  return isFinish(response.finish) ? response.finish : null
}

/** Build the wanted-list half of a card session. Shared with the unified `edit` command. */
export function createWantedStrategy(
  session: WantedSession,
  sessionConfig: WantedListSessionConfig,
  listName: string,
  excludeDigitalOnly: boolean,
  moveTargets?: MoveTargetsProvider,
): CardSessionStrategy {
  const state: LastAddState = { snapshot: null }
  const list: FlatListStrategyContext<WantedListCardEntry> = {
    session,
    state,
    renderLine: (name, snapshot, cardId) =>
      formatWantedListLine({
        name,
        printing:
          snapshot.options.set && snapshot.options.collectorNumber
            ? { set: snapshot.options.set, collectorNumber: snapshot.options.collectorNumber }
            : undefined,
        finish: snapshot.options.finish,
        language: snapshot.options.language,
        note: snapshot.note,
        cardId,
      }).trim(),
    renderEntry: (entry) =>
      formatWantedListLine({
        name: entry.name,
        printing:
          entry.set && entry.collectorNumber
            ? { set: entry.set, collectorNumber: entry.collectorNumber }
            : undefined,
        finish: entry.finish,
        language: entry.language,
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

  return {
    managerLabel: t('cli.manager.wanted'),
    saveTarget: { filePath: session.filePath, listName },
    // The wanted list has no condition, but the shared engine config carries the
    // full shape; the condition field is simply never read by this strategy.
    sessionConfig,
    updateConfig: (excludeDigital: boolean) =>
      promptSessionConfigUpdate(sessionConfig, false, excludeDigital),
    applyChange: (change: ChangeEvent) => applyFlatListChange(session, change),
    receiveMove: (change, art) => receiveFlatListMove(session, change, art),
    persist: () => persistFlatListSession(session),
    hasUnsavedChanges: () => session.dirty,
    sessionSaved: () => resetFlatListSessionTracking(list),
    noteAdded: (note: string): void => {
      if (state.snapshot) state.snapshot.note = note
    },

    async handleCard(ctx: CardSessionContext, input): Promise<void> {
      const { cardName, forcePrompts } = input
      const isEditing = input.intent === 'edit-last'

      const specificity = await promptSpecificity(cardName)
      if (!specificity) return

      // A fresh add stamps the configured default language (adding never
      // prompts for language); the picker's availability confirm may override.
      const nameOnlyOptions = { language: resolveAddedLanguage(undefined) }
      if (specificity === 'name-only') {
        await applyFlatListCardEntry(list, ctx, cardName, nameOnlyOptions, isEditing, {
          kind: 'cheapest',
        })
        return
      }

      let printing = input.preselected
      let pickedLanguage: CardLanguage | undefined
      if (!printing) {
        const result = await resolveCardPrinting(cardName, sessionConfig, excludeDigitalOnly)
        // A cancel must not fall through to the name-only fallback below — the
        // user backed out of adding this card entirely.
        if (result.kind === 'cancelled') return
        if (result.kind === 'none') {
          if (isEditing) return
          // Name-only entries are first-class in the wanted-list format, so fall
          // back to one rather than dropping the card.
          console.error(t('cli.edit.noPrintingsNameOnly'))
          await applyFlatListCardEntry(list, ctx, cardName, nameOnlyOptions, false, {
            kind: 'cheapest',
          })
          return
        }
        printing = result.printing
        pickedLanguage = result.language
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
      const pinned = hasSpecificPrinting(entry)
      const action = await promptEditAction(list.renderEntry(entry), [
        {
          title: `🖼️  ${t(pinned ? 'cli.editAction.changePrinting' : 'cli.editAction.setPrinting')}`,
          value: 'printing',
        },
        // Finish only annotates a specific printing; name-only entries have none to change.
        ...(pinned ? [{ title: `✨ ${t('cli.editAction.changeFinish')}`, value: 'finish' }] : []),
        { title: `🌐 ${t('cli.editAction.changeLanguage')}`, value: 'language' },
        { title: `🎨 ${t('cli.editAction.setArt')}`, value: 'art' },
        ...(moveTargets
          ? [{ title: `📤 ${t('cli.editAction.moveToList')}`, value: 'move-list' }]
          : []),
        { title: `📝 ${t('cli.editAction.editNote')}`, value: 'note' },
        { title: `🗑️  ${t('cli.editAction.remove')}`, value: 'remove' },
      ])
      if (!action) return

      if (action === 'printing') {
        const specificity = await promptSpecificity(entry.name)
        if (!specificity) return

        let target: PrintingTuple = {}
        if (specificity === 'specific') {
          const result = await resolveCardPrinting(entry.name, sessionConfig, excludeDigitalOnly)
          if (result.kind === 'cancelled') return
          if (result.kind === 'none') {
            console.error(t('cli.edit.noPrintings'))
            return
          }
          const finishResult = await promptWantedFinish(result.printing, undefined)
          if (finishResult === 'cancelled') return
          target = {
            set: result.printing.set.toLowerCase(),
            collectorNumber: result.printing.collector_number,
            finish: finishResult === 'nopreference' ? undefined : finishResult,
            // The entry keeps its language across a printing change unless the
            // picker's availability confirm resolved a different one.
            language: result.language ?? displayLanguage(entry.language),
          }
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
        const finish = await promptWantedFinishChoice(
          entry.finish,
          await lookupPinnedPrinting(entry),
        )
        if (finish === null || finish === entry.finish) return
        // Wanted finishes can be cleared back to "no preference", which set-finish
        // cannot express, so finish edits ride on a set-printing of the same printing.
        const target: PrintingTuple = { ...entryPrinting(entry), finish }
        applyFlatListFieldEdit(list, ctx, entry, cardId, {
          label: t('cli.editLabel.finish', { name: entry.name }),
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

      if (action === 'art') {
        await editFlatListArt(list, entry, cardId)
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
