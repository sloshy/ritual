import {
  promptEditAction,
  promptSpecificity,
  promptWantedFinish,
  promptWantedFinishChoice,
  resolveCardPrinting,
} from './prompts'
import { lookupPinnedPrinting, resolveAddedLanguage } from '../../card/printing-pin'
import { formatWantedListLine } from '../../list/wanted-file'
import { promptSessionConfigUpdate, type SessionConfig } from './config'
import type { CardSessionContext, CardSessionStrategy } from './strategy'
import {
  applyFlatListCardEntry,
  type FlatListStrategyContext,
  type LastAddState,
  type WantedSession,
} from './flat-list-session'
import {
  applyFlatListFieldEdit,
  editSharedFlatListAction,
  sharedFlatListEditActions,
  type FlatListEditEnv,
  entryPrinting,
  findFlatListEntry,
  flatListDelegates,
  logFlatListUpdated,
} from './flat-list-edit'
import type { MoveTargetsProvider } from './edit-move'
import type { WantedListCardEntry } from '../../list/site-data'
import {
  consolidateSetPrinting,
  createSetPrintingChange,
  type PrintingTuple,
} from '../../changes/change-event'
import { displayLanguage, type CardLanguage } from '../../card/card-language'
import { t } from '../../i18n/t'
import { hasSpecificPrinting } from '../../card/card-printing'

/** Build the wanted-list half of a card session. Shared with the unified `edit` command. */
export function createWantedStrategy(
  session: WantedSession,
  sessionConfig: SessionConfig,
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

  const logUpdated = (cardId: number, fallbackName: string): void =>
    logFlatListUpdated(list, cardId, fallbackName)

  return {
    ...flatListDelegates(list),
    managerLabel: t('cli.manager.wanted'),
    saveTarget: { filePath: session.filePath, listName },
    // The wanted list has no condition, but the shared engine config carries the
    // full shape; the condition field is simply never read by this strategy.
    sessionConfig,
    updateConfig: (excludeDigital: boolean) =>
      promptSessionConfigUpdate(sessionConfig, false, excludeDigital),

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

    async editEntry(ctx: CardSessionContext, cardId: number): Promise<void> {
      const entry = findFlatListEntry(list, cardId)
      if (!entry) return
      const pinned = hasSpecificPrinting(entry)
      const env: FlatListEditEnv = { sessionConfig, excludeDigitalOnly, moveTargets }
      const action = await promptEditAction(list.renderEntry(entry), [
        {
          title: `🖼️  ${t(pinned ? 'cli.editAction.changePrinting' : 'cli.editAction.setPrinting')}`,
          value: 'printing',
        },
        // Finish only annotates a specific printing; name-only entries have none to change.
        ...(pinned ? [{ title: `✨ ${t('cli.editAction.changeFinish')}`, value: 'finish' }] : []),
        ...sharedFlatListEditActions(env),
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

      await editSharedFlatListAction(action, list, ctx, entry, cardId, env)
    },
  }
}
