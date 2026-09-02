import { t } from '../../i18n/t'
import {
  promptCardLabelChoice,
  promptConditionChoice,
  promptDefaultLabelsChoice,
  promptEditAction,
  promptFinishAndCondition,
  promptFinishChoice,
  resolveCardPrinting,
} from './prompts'
import { formatCollectionLine } from '../../card/card-line'
import { lookupPinnedPrinting, resolveAddedLanguage } from '../../card/printing-pin'
import { menuRow, type MenuChoice, type MenuSentinel } from './menu'
import { promptSessionConfigUpdate, type SessionConfig } from './config'
import type { CardSessionContext, CardSessionStrategy } from './strategy'
import {
  applyFlatListCardEntry,
  type CollectionSession,
  type FlatListStrategyContext,
  type LastAddState,
} from './flat-list-session'
import {
  applyFlatListFieldEdit,
  editSharedFlatListAction,
  sharedFlatListEditActions,
  type FlatListEditEnv,
  findFlatListEntry,
  flatListDelegates,
  logFlatListUpdated,
} from './flat-list-edit'
import { printingTupleOf } from './edit-model'
import type { MoveTargetsProvider } from './edit-move'
import type { CollectionCardEntry } from '../../list/site-data'
import {
  consolidateSetFinish,
  consolidateSetLabel,
  consolidateSetPrinting,
  createSetFinishChange,
  createSetLabelChange,
  createSetPrintingChange,
  type PrintingTuple,
} from '../../changes/change-event'
import { displayLanguage, type CardLanguage } from '../../card/card-language'
import {
  formatCardLabels,
  parseCardLabelsValue,
  sameCardLabels,
  type CardLabel,
} from '../../card/card-labels'
import { dumpFrontMatterBlock, readFrontMatterMapping } from '../../list/front-matter-write'
import { applyLabelsPatch } from '../../list/flat-list-metadata'

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

  const logUpdated = (cardId: number, fallbackName: string): void =>
    logFlatListUpdated(list, cardId, fallbackName)

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
    const labels = await promptDefaultLabelsChoice('collection', current)
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
        ? t('cli.labels.defaultSet', { labels: formatCardLabels(labels) })
        : t('cli.labels.defaultCleared'),
    )
  }

  /**
   * The per-entry action menu and the flows behind it. Named rather than
   * inlined in the strategy literal because the session-changes screen's
   * "Edit This Card" action runs this same menu, and the delegates need it
   * before the literal exists.
   */
  const editEntry: CardSessionStrategy['editEntry'] = async (ctx, cardId) => {
    const entry = findFlatListEntry(list, cardId)
    if (!entry) return
    const env: FlatListEditEnv = { sessionConfig, excludeDigitalOnly, moveTargets }
    const action = await promptEditAction(list.renderEntry(entry), [
      // Always "change", never "set": a collection line cannot exist without a
      // printing (`CollectionEntry.set`/`collectorNumber` are required, and a
      // printing-less line is rejected on every write path).
      { title: `🖼️  ${t('cli.editAction.changePrinting')}`, value: 'printing' },
      { title: `✨ ${t('cli.editAction.changeFinish')}`, value: 'finish' },
      { title: `📋 ${t('cli.editAction.changeCondition')}`, value: 'condition' },
      ...sharedFlatListEditActions(env, [
        { title: `🏷️  ${t('cli.editAction.changeLabel')}`, value: 'label' },
      ]),
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
      const before = printingTupleOf(entry)
      applyFlatListFieldEdit(list, ctx, entry, cardId, {
        label: t('cli.editLabel.printing', { name: entry.name }),
        change: createSetPrintingChange(entry.name, { ...target, cardId }),
        inverse: createSetPrintingChange(entry.name, { ...before, cardId }),
        consolidate: (changes, original) =>
          consolidateSetPrinting(changes, entry.name, target, printingTupleOf(original), cardId),
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
      const target: PrintingTuple = { ...printingTupleOf(entry), condition }
      applyFlatListFieldEdit(list, ctx, entry, cardId, {
        label: t('cli.editLabel.condition', { name: entry.name }),
        change: createSetPrintingChange(entry.name, { ...target, cardId }),
        inverse: createSetPrintingChange(entry.name, { ...printingTupleOf(entry), cardId }),
        consolidate: (changes, original) =>
          consolidateSetPrinting(changes, entry.name, target, printingTupleOf(original), cardId),
      })
      logUpdated(cardId, entry.name)
      return
    }

    if (action === 'label') {
      const labels = await promptCardLabelChoice('collection', entry.labels)
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

    await editSharedFlatListAction(action, list, ctx, entry, cardId, env)
  }

  return {
    // The session-changes screen's "Edit This Card" action opens this very
    // menu, so the delegates are handed the same function the strategy exposes.
    ...flatListDelegates(list, editEntry),
    managerLabel: t('cli.manager.collection'),
    saveTarget: { filePath: session.filePath, listName },
    sessionConfig,
    extraMenuItems: (): MenuChoice[] => {
      const params = {
        labels: formatCardLabels(currentDefaultLabels()) || t('cli.labels.none'),
      }
      return [menuRow('🏷️ ', '__LIST_LABELS__', 'cli.labels.menuListLabels', params)]
    },
    handleSentinel: async (_ctx: CardSessionContext, value: MenuSentinel): Promise<void> => {
      if (value === '__LIST_LABELS__') await editListLabels()
    },
    updateConfig: (excludeDigital: boolean) =>
      promptSessionConfigUpdate(sessionConfig, true, excludeDigital),

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
          language: resolveAddedLanguage(pickedLanguage, sessionConfig.language),
        },
        isEditing,
        { kind: 'specific', printing },
      )
    },

    editEntry,
  }
}
