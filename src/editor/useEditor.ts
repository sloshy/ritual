import {
  type Accessor,
  type Setter,
  batch,
  createSignal,
  createEffect,
  createMemo,
  on,
  onMount,
  onCleanup,
} from 'solid-js'
import { replaySectionOrder } from '../changes/change-event'
import type { Finish } from '../card/finish-condition'
import type { ScryfallCard } from '../scryfall/types'
import type { CardLanguage } from '../card/card-language'
import type { PriceCurrency } from '../pricing/price-currency'
import { DEFAULT_CURRENCY } from '../pricing/price-currency'
import type { ChangeEvent, CardPrintingOptions } from '../changes/change-event'
import { retargetImportedChanges } from './import-changes'
import type { ContextMenuState, CardContextInfo } from '../list-view/card-context'
import { statusMessage, useEditorStatus } from './useEditorStatus'
import { entityListType } from './entity'
import type { ListType } from '../list/list-type'
import { useT } from '../ui/i18n'
import { useDialogState } from './useDialogState'
import { useCardIdPool } from './useCardIdPool'
import { useCardChanges } from './useCardChanges'
import { reconcileIdPoolForUndo, replayChanges, type ReplayResult } from './reconcile-undo'
import type { UnmatchedChange } from '../changes/apply-batch'
import { addedCopyArtActions, artIdsResetByUndo } from './pending-art'
import { useNavigationGuard } from './navigation-guard'
import { clampQuantity } from '../ui/quantity'
import type {
  AddCardExtras,
  ChangePrintingTools,
  EditorConfig,
  ImportResult,
  ListItem,
  SectionInfo,
  TextPromptState,
  UseEditorResult,
} from './editor-config'
import {
  IDLE_PRINTING_FLOW,
  advancePrintingFlow,
  confirmPrintingCount,
  startBulkPrintingFlow,
  startPrintingFlow,
  type PrintingFlowState,
} from './change-printing-flow'
import {
  canonicalSection as canonicalSectionIn,
  moveBaselineSection,
  sectionInfoFrom,
  sectionNameError,
} from './section-edits'
import { addedCardNamesFrom, refusedToConflicts, usedIdsAfterRestore } from './session-changes'

/** A navigation deferred until the user confirms discarding unsaved changes. */
type PendingNavigation = { run: () => void; cancel?: () => void }

/** Upper bound on copies a single add-from-search may commit. */
const MAX_ADD_COPIES = 999

export function useEditor<TData, TCardEntry = unknown>(
  config: EditorConfig<TData>,
  initialSlug?: string | null,
): UseEditorResult<TData, TCardEntry> {
  const [slug, setSlug] = createSignal<string | null>(null)
  const [list, setList] = createSignal<ListItem[]>([])
  const [data, setData] = createSignal<TData | null>(null) as [
    Accessor<TData | null>,
    Setter<TData | null>,
  ]
  const [contentHash, setContentHash] = createSignal<string>('')
  // True once this editing session has saved at least once. Subsequent saves
  // fold into the same changelog entry; reloading the list starts a new session.
  const [hasSavedThisSession, setHasSavedThisSession] = createSignal(false)
  const [extra, setExtra] = createSignal<Record<string, unknown>>({})
  const [contextMenuCard, setContextMenuCard] = createSignal<ContextMenuState | null>(null)
  // The change-printing flow on screen plus its bulk-run queue, as one value so
  // a transition that touches both (see `change-printing-flow.ts`) is one write.
  const [printingFlow, setPrintingFlow] = createSignal<PrintingFlowState>(IDLE_PRINTING_FLOW)
  const changePrinting = createMemo(() => printingFlow().flow)
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [pendingNav, setPendingNav] = createSignal<PendingNavigation | null>(null)

  const [status, statusActions] = useEditorStatus()
  const t = useT()
  const listType = (): ListType => entityListType(config.entityLabel)
  const dialogs = useDialogState()
  const pool = useCardIdPool()
  const changes = useCardChanges<TCardEntry>()
  const navigationGuard = useNavigationGuard()

  const currency = config.currency ?? ((): PriceCurrency => DEFAULT_CURRENCY)
  let original: TData | null = null
  // Section order as loaded from disk. The live order is this replayed against the
  // section-structural changes (see `sectionOrder`), so it stays correct across undo.
  // A signal (not a plain variable) so the `sectionOrder` memo recomputes when a new
  // list loads, independent of the `changes` signal write that happens alongside it.
  const [originalSectionOrder, setOriginalSectionOrder] = createSignal<string[]>([])

  const isDataReady = createMemo(() => {
    const d = data()
    return d !== null && config.hasData(d) && slug() !== null && !status.loading
  })

  // Fetch list on mount
  onMount(() => {
    config
      .fetchList()
      .then((response: unknown) => {
        const items = config.extractListItems(response)
        if (items) setList(items)
        // Apply a deep-linked selection only after its <option> exists, so the
        // <select> reflects it; the data-fetch effect below then loads it.
        // These two writes must stay separate (do NOT wrap in `batch`): the
        // un-batched sequence flushes the <For> options first, then the slug,
        // so the value binding re-applies with the matching <option> present.
        // Batching would run the value binding before the options render and
        // the selection would silently fail to stick.
        if (initialSlug) setSlug(initialSlug)
      })
      .catch(() =>
        statusActions.setError(statusMessage('ui.editor.loadListFailed', { listType: listType() })),
      )
  })

  // Fetch data when slug changes
  createEffect(
    on([slug, refreshKey], ([s]) => {
      if (!s) return
      const controller = new AbortController()
      statusActions.loadStart()

      config
        .fetchData(s, controller.signal)
        .then((response: unknown) => {
          if (controller.signal.aborted) return
          const result = config.processLoadResponse(response)
          if (result) {
            setData(() => result.data)
            original = result.data
            const loadedOrder = result.extra.sectionOrder
            setOriginalSectionOrder(
              Array.isArray(loadedOrder)
                ? loadedOrder.filter((s): s is string => typeof s === 'string')
                : [],
            )
            pool.resetPool(result.poolIds)
            config.loadCardData(response)
            setContentHash(result.contentHash)
            setExtra(result.extra)
            changes.discardAll()
            setHasSavedThisSession(false)
            statusActions.loadSuccess()
          } else {
            statusActions.loadError(statusMessage('ui.editor.loadFailed', { listType: listType() }))
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return
          statusActions.loadError(statusMessage('ui.editor.loadFailed', { listType: listType() }))
        })

      onCleanup(() => controller.abort())
    }),
  )

  /**
   * Route a navigation through the discard guard. With unsaved changes the
   * action is stashed and the discard dialog opened (it runs on confirm via
   * {@link handleDiscard}, and `onCancel` runs instead if the user backs out);
   * otherwise it runs immediately. Returns true when it ran synchronously.
   */
  const guardedNavigate = (proceed: () => void, onCancel?: () => void): boolean => {
    if (changes.changeCount() > 0) {
      // A second attempt (e.g. Back pressed twice before answering) supersedes
      // the first, which still has to undo whatever it did to get here.
      pendingNav()?.cancel?.()
      setPendingNav({ run: proceed, cancel: onCancel })
      dialogs.openDiscard()
      return false
    }
    proceed()
    return true
  }

  // Expose this editor's guard so list/tab/page navigation (and the unsaved-
  // changes unload prompt) routes through it while it is the mounted editor.
  onCleanup(
    navigationGuard.register({
      attempt: (proceed, onCancel) => void guardedNavigate(proceed, onCancel),
      isDirty: () => changes.changeCount() > 0,
    }),
  )

  const handleSelect = (e: Event) => {
    const target = e.currentTarget as HTMLSelectElement
    const value = target.value || null
    if (value === slug()) return
    // The bound `value` only re-asserts when `slug` actually changes, so revert
    // the visible selection by hand when the switch is deferred for confirmation.
    if (!guardedNavigate(() => setSlug(value))) {
      target.value = slug() ?? ''
    }
  }

  const handleCancelDiscard = () => {
    const pending = pendingNav()
    setPendingNav(null)
    dialogs.closeDiscard()
    // Let the caller undo whatever it did to start the navigation (the admin
    // router restores the URL a refused Back/Forward already changed).
    pending?.cancel?.()
  }

  /**
   * Set an explicit finish on one targeted card (vs {@link handleSetFoil}'s toggle).
   * `cardId` should be supplied by the caller when a specific copy is meant — flat
   * lists have one entry per copy, so resolving by name alone would be ambiguous.
   * Backs both the menu foil toggle and the bulk "Set as Foil/Nonfoil" actions.
   */
  const handleSetFinishFor = (cardName: string, finish: Finish, cardId?: number) => {
    const d = data()
    if (!d) return
    const id = cardId ?? config.findCardId(d, cardName)
    // Apply first, and record the change only if it landed. The engine refuses
    // a foil/etched token on a line that pins no printing, and a change event
    // for an edit the data never took would save an edit the file cannot hold.
    // Bulk callers rely on this: a mixed selection foils the pinned cards and
    // silently skips the name-only ones rather than failing as a whole.
    let missed = false
    const next = config.applyChange(
      d,
      { action: 'set-finish', cardName, finish, cardId: id },
      { onMiss: () => (missed = true) },
    )
    if (missed) return
    const originalFinish: Finish = original
      ? config.findOriginalFinish(original, cardName, id)
      : 'nonfoil'
    changes.setFinish(cardName, finish, originalFinish, id)
    setData(() => next)
  }

  /**
   * Set an explicit language on one targeted card, mirroring
   * {@link handleSetFinishFor}. `cardId` should be supplied when a specific copy
   * is meant — flat lists have one entry per copy, so resolving by name alone
   * would be ambiguous. Consolidation folds a missing original to `en` (a bare
   * line always means English), so restoring the on-disk language cancels the
   * pending change.
   */
  const handleSetLanguageFor = (cardName: string, language: CardLanguage, cardId?: number) => {
    const d = data()
    if (!d) return
    const id = cardId ?? config.findCardId(d, cardName)
    const originalLanguage = original
      ? config.findOriginalLanguage?.(original, cardName, id)
      : undefined
    changes.setLanguage(cardName, language, originalLanguage, id)
    setData((prev) =>
      prev !== null
        ? config.applyChange(prev, { action: 'set-language', cardName, language, cardId: id })
        : prev,
    )
  }

  const handleSetFoil = () => {
    const menu = contextMenuCard()
    const d = data()
    if (!menu || !d) return
    // The tile's own id decides which copy toggles — and which copy's finish
    // decides the direction. Falling back to a name lookup only when the tile
    // carries no id (a card added this session, before the save assigns one).
    const cardId = menu.cardIds[0] ?? config.findCardId(d, menu.cardName)
    const currentFinish = config.findCurrentFinish(d, menu.cardName, cardId)
    const newFinish: Finish =
      currentFinish === 'foil' || currentFinish === 'etched' ? 'nonfoil' : 'foil'
    handleSetFinishFor(menu.cardName, newFinish, cardId)
    setContextMenuCard(null)
  }

  const handleAddCardFromSearch = async (
    cardName: string,
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
    quantity = 1,
    extras?: AddCardExtras,
  ) => {
    // Normalize the set code to lowercase at this single boundary so every
    // downstream consumer (change events and in-memory entries) stores it
    // lowercase, per the set-code normalization rule.
    const normalized: CardPrintingOptions = options
      ? { ...options, set: options.set?.toLowerCase() }
      : {}
    // Capped as much to keep a bad caller from emitting an unbounded run of
    // change events as to bound what the dialog can ask for.
    const copies = clampQuantity(quantity, 1, MAX_ADD_COPIES)
    // One `add` event per copy — the change format has no quantity field. Decks
    // fold the copies into one entry, so they all share a card ID; flat lists
    // store one entry per copy and each needs its own. Batched so the view
    // repaints once rather than per copy.
    const sharedId = config.copyModel === 'quantity' ? pool.allocate() : undefined
    const labels = extras?.labels
    const art = extras?.art ?? null
    // Resolved against the data as it stands *before* the first copy is applied:
    // afterwards the new line exists and every further copy merges into it.
    const currentData = data()
    const mergeTargetId =
      currentData !== null
        ? config.findAddMergeTargetId?.(currentData, {
            action: 'add',
            cardName,
            set: normalized.set,
            collectorNumber: normalized.collectorNumber,
            finish: normalized.finish,
            condition: normalized.condition,
            language: normalized.language,
            labels,
          })
        : undefined
    batch(() => {
      for (let i = 0; i < copies; i++) {
        const cardId = sharedId ?? pool.allocate()
        const result = changes.addCard(cardName, { ...normalized, cardId, labels })
        setData((prev) =>
          prev !== null
            ? config.applyChange(prev, {
                action: 'add',
                cardName,
                set: normalized.set,
                collectorNumber: normalized.collectorNumber,
                finish: normalized.finish,
                condition: normalized.condition,
                language: normalized.language,
                labels,
                cardId,
              })
            : prev,
        )
        // Where this copy's art belongs — including the case the rule exists
        // for: an add that cancelled a pending removal *and named art* puts that
        // art on the line that survived, rather than dropping it with the add.
        const actions = addedCopyArtActions(
          result.kind === 'cancelled'
            ? { kind: 'cancelled', cardId, survivorId: result.cancelled?.cardId, art }
            : { kind: 'recorded', cardId, mergeTargetId, art },
        )
        for (const action of actions) {
          if (action.kind === 'reset') config.onCardArtReset?.(action.cardId)
          else config.onCardArt?.(action.cardId, action.art)
        }
      }
    })
    config.addCardData(cardName, scryfallCard, allPrintings)

    try {
      await config.onCardAdded?.(cardName, scryfallCard)
    } catch {
      // Price hook failure doesn't block adding the card
    }
  }

  const changePrintingTools: ChangePrintingTools = {
    setPrinting: (cardName, target, original, cardId) =>
      changes.setPrinting(cardName, target, original, cardId),
    addCard: (cardName, options) => changes.addCard(cardName, options),
    decrementCard: (cardName, cardId) => changes.decrementCard(cardName, cardId),
    allocateId: () => pool.allocate(),
  }

  const startChangePrinting = (target: CardContextInfo) => {
    if (!config.applyChangePrinting) return
    setPrintingFlow((prev) => startPrintingFlow(prev, target))
  }

  const confirmChangePrintingCount = (count: number) => {
    setPrintingFlow((prev) => confirmPrintingCount(prev, count))
  }

  /** Begin a sequential change-printing run over many targets (bulk multi-select). */
  const startBulkChangePrinting = (targets: CardContextInfo[]) => {
    if (!config.applyChangePrinting || targets.length === 0) return
    setPrintingFlow((prev) => startBulkPrintingFlow(prev, targets))
  }

  // Close the flow; while a bulk run is active this opens the next queued card's.
  const cancelChangePrinting = () => setPrintingFlow(advancePrintingFlow)

  const handleChangePrintingSelect = (
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
  ) => {
    const flow = changePrinting()
    const d = data()
    if (!flow || !d || !config.applyChangePrinting) {
      setPrintingFlow(advancePrintingFlow)
      return
    }
    // Register the chosen printing's card data so the editor immediately shows
    // the new printing's image/price. The card-data store is separate from the
    // entry list and is keyed by name and set:collector_number, so without this
    // the entry would update but its rendered card would not.
    config.addCardData(flow.target.cardName, scryfallCard, allPrintings)
    // Normalize the set code to lowercase at this single boundary so every
    // downstream consumer (change events and in-memory entries) stores it
    // lowercase, per the set-code normalization rule.
    const normalizedOptions: CardPrintingOptions = options
      ? { ...options, set: options.set?.toLowerCase() }
      : {}
    config.applyChangePrinting({
      data: d,
      original,
      target: flow.target,
      count: flow.count,
      options: normalizedOptions,
      tools: changePrintingTools,
      setData,
    })
    setPrintingFlow(advancePrintingFlow)
  }

  // Sections live in the data for decks (`sectionsOf`) and in a separate order list for flat
  // lists, where the live order is the loaded order replayed against the section changes.
  const sectionOrder = createMemo<string[]>(() => {
    const d = data()
    if (config.sectionsOf && d) return config.sectionsOf(d)
    return replaySectionOrder(originalSectionOrder(), changes.changes())
  })

  const sectionInfo = createMemo<SectionInfo[]>(() => {
    const d = data()
    const counts = d && config.cardCountsBySection ? config.cardCountsBySection(d) : {}
    return sectionInfoFrom(sectionOrder(), counts)
  })

  const canonicalSection = (name: string): string | undefined =>
    canonicalSectionIn(sectionOrder(), name)

  const handleAddSection = (name: string) => {
    const trimmed = name.trim()
    if (sectionNameError(sectionOrder(), trimmed) !== null) return
    changes.addChange({ action: 'add-section', section: trimmed })
    setData((prev) =>
      prev !== null ? config.applyChange(prev, { action: 'add-section', section: trimmed }) : prev,
    )
  }

  const handleRenameSection = (oldName: string, newName: string) => {
    const trimmed = newName.trim()
    if (trimmed === oldName) return
    if (sectionNameError(sectionOrder(), trimmed, oldName) !== null) return
    changes.addChange({ action: 'rename-section', section: oldName, newSection: trimmed })
    setData((prev) =>
      prev !== null
        ? config.applyChange(prev, {
            action: 'rename-section',
            section: oldName,
            newSection: trimmed,
          })
        : prev,
    )
  }

  const handleRemoveSection = (name: string) => {
    const info = sectionInfo().find((s) => s.name === name)
    if (!info || info.count > 0) return
    changes.addChange({ action: 'remove-section', section: name })
    setData((prev) =>
      prev !== null ? config.applyChange(prev, { action: 'remove-section', section: name }) : prev,
    )
  }

  /**
   * Move one or more targeted cards into a section, creating it if needed. The
   * destination section is resolved/created once up front, then each target's move
   * is applied. Backs both the single-card menu move and the bulk multi-select move.
   */
  const handleMoveCardsToSection = (targets: CardContextInfo[], section: string) => {
    const d = data()
    if (!d || targets.length === 0) return
    const raw = section.trim()
    if (!raw) return
    // Resolve to an existing section's canonical casing when one matches case-insensitively;
    // otherwise create the new section first so it persists even if no other card lands there.
    const existing = canonicalSection(raw)
    const trimmed = existing ?? raw
    if (!existing) handleAddSection(trimmed)
    for (const target of targets) {
      const cardId = target.cardIds[0]
      const originalSection = moveBaselineSection(original, target, config.cardSectionOf)
      changes.setSection(target.cardName, trimmed, originalSection, cardId)
      setData((prev) =>
        prev !== null
          ? config.applyChange(prev, {
              action: 'set-section',
              cardName: target.cardName,
              section: trimmed,
              cardId,
            })
          : prev,
      )
    }
  }

  const handleMoveCardToSection = (target: CardContextInfo, section: string) => {
    handleMoveCardsToSection([target], section)
    setContextMenuCard(null)
  }

  const [textPrompt, setTextPrompt] = createSignal<TextPromptState | null>(null)
  const closeTextPrompt = () => setTextPrompt(null)

  // Validation shared by the new-section and rename prompts, worded for the dialog.
  const sectionNameMessage = (value: string, allowExisting?: string): string | null => {
    const error = sectionNameError(sectionOrder(), value, allowExisting)
    if (error === null) return null
    return error.kind === 'required'
      ? t('ui.editor.sectionNameRequired')
      : t('ui.editor.sectionExists', { name: error.clash })
  }

  const promptNewSectionForCards = (targets: CardContextInfo[]) => {
    // Close the editor-level menu; the deck editor's parallel menu state is cleared by its wrapper.
    setContextMenuCard(null)
    setTextPrompt({
      title: t('ui.editor.moveToNewSection'),
      label: t('ui.editor.newSectionName'),
      initialValue: '',
      confirmLabel: t('ui.editor.move'),
      validate: (v) => sectionNameMessage(v),
      onConfirm: (v) => {
        handleMoveCardsToSection(targets, v.trim())
        closeTextPrompt()
      },
    })
  }

  const promptNewSectionForCard = (target: CardContextInfo) => promptNewSectionForCards([target])

  const promptRenameSection = (oldName: string) => {
    setTextPrompt({
      title: t('ui.editor.renameSection'),
      label: t('ui.editor.sectionName'),
      initialValue: oldName,
      confirmLabel: t('ui.editor.rename'),
      validate: (v) => sectionNameMessage(v, oldName),
      onConfirm: (v) => {
        handleRenameSection(oldName, v.trim())
        closeTextPrompt()
      },
    })
  }

  /**
   * Take the changes a replay refused back out of the pending list. The engines
   * are the authority on what a list can hold, so a change they will not apply
   * is not a pending edit — and a save that posted it would write a changelog
   * entry for an edit the file never took.
   */
  const dropRefusedChanges = (refused: readonly UnmatchedChange<ChangeEvent>[]) => {
    if (refused.length === 0) return
    changes.dropChanges(new Set(refused.map((item) => item.change.id)))
  }

  /**
   * Rebuild the data from the baseline, take the refused changes back out of
   * the pending list, and publish the result. Every replay goes through here so
   * the drop is part of replaying rather than something each caller remembers.
   */
  const replayAndDrop = (
    baseline: TData,
    list: readonly ChangeEvent[],
  ): ReplayResult<TData, ChangeEvent> => {
    const replayed = replayChanges(baseline, list, config.applyChange)
    dropRefusedChanges(replayed.refused)
    setData(() => replayed.data)
    return replayed
  }

  const handleUndo = () => {
    const result = changes.undo()
    if (!result || !original) return
    const origData = original
    const { entry, remainingChanges } = result
    reconcileIdPoolForUndo(pool.release, pool.claim, entry, remainingChanges)
    // Same rule, one source: an id the undo moved carries no staged art any
    // more, and shows whatever the list holds for it on disk again.
    for (const cardId of artIdsResetByUndo(entry, remainingChanges)) {
      config.onCardArtReset?.(cardId)
    }
    // A change the replay could not take is no longer a pending edit: keeping it
    // would put an edit in the changelog that the saved file does not contain.
    replayAndDrop(origData, remainingChanges)
  }

  const handleSave = async () => {
    const s = slug()
    const d = data()
    if (!s || !d || !config.hasData(d) || changes.changes().length === 0) return
    const result = await config.commit({
      slug: s,
      data: d,
      changes: changes.changes(),
      contentHash: contentHash(),
      extra: extra(),
      sectionOrder: sectionOrder(),
      continueSession: hasSavedThisSession(),
      statusActions,
      discardAll: changes.discardAll,
    })
    if (result?.contentHash) {
      setContentHash(result.contentHash)
      setHasSavedThisSession(true)
      // Only on a save that actually landed: the effects say which `&N` each
      // line ended up with, which is what a staged art write has been waiting
      // for. A failed or conflicted save leaves the staging alone to be flushed
      // by the next attempt.
      void config.onSaved?.(result.effects ?? [])
    }
  }

  const importChanges = (imported: ChangeEvent[]): ImportResult => {
    const orig = original
    const d = data()
    if (!orig || !d) return { loaded: 0, conflicts: [] }
    // Re-target against the on-disk baseline, allocating fresh IDs for adds.
    pool.resetPool(config.getOriginalIds(orig))
    const { retargeted, conflicts } = retargetImportedChanges({
      changes: imported,
      currentIds: new Set(config.getOriginalIds(orig)),
      allocateId: () => pool.allocate(),
      findIdByName: (name) => config.findCardId(orig, name),
    })
    changes.loadChanges(retargeted)
    const replayed = replayAndDrop(orig, retargeted)

    // Load display data (image + price) for cards added by the import that the
    // list did not already contain. Reuses the same per-list hook as adding a card
    // from search; it pulls from the admin's local Scryfall cache. Fire-and-forget
    // — the tiles fill in reactively as each fetch resolves.
    for (const cardName of addedCardNamesFrom(retargeted, (name) => config.findCardId(orig, name)))
      void config.onCardAdded?.(cardName)

    return {
      loaded: retargeted.length - replayed.refused.length,
      conflicts: [...conflicts, ...refusedToConflicts(replayed.refused)],
    }
  }

  /**
   * Restore a change list verbatim, without re-targeting. Unlike {@link importChanges}
   * (which re-aims an externally-authored file at the current IDs, allocating fresh
   * IDs for adds), this resumes an in-memory edit session captured from the *same*
   * baseline this editor just loaded, so every card ID — including the increments
   * behind "add a copy" — is preserved exactly rather than split into new entries.
   */
  const restoreChanges = (restored: ChangeEvent[]): void => {
    const orig = original
    if (!orig || restored.length === 0) return
    changes.loadChanges(restored)
    replayAndDrop(orig, restored)
    // Mark every ID the restored changes reference as in use, so later adds in this
    // resumed session don't reallocate one of them.
    pool.resetPool(usedIdsAfterRestore(config.getOriginalIds(orig), restored))
  }

  /**
   * Card names added during this session — an `add` change for a card that wasn't
   * in the on-disk original. Cards moved in from another list are recorded as
   * `move-from` on the source (not `add` here), so they're correctly excluded.
   *
   * `original` is a plain variable, not a signal, but reading it here is safe: it's
   * reassigned only on load, which also calls `changes.discardAll()` — that writes
   * the `changes` signal this memo tracks, so a stale `original` is never observed.
   */
  const addedCardNames = createMemo((): string[] => {
    const orig = original
    return addedCardNamesFrom(changes.changes(), (name) =>
      orig ? config.findCardId(orig, name) : undefined,
    )
  })

  const handleDiscard = () => {
    changes.discardAll()
    if (original) {
      pool.resetPool(config.getOriginalIds(original))
    }
    dialogs.closeDiscard()
    const pending = pendingNav()
    if (pending) {
      // Discarding to leave: drop changes and run the deferred navigation. The
      // target load resets pool/data, so no local refresh is needed.
      setPendingNav(null)
      pending.run()
    } else {
      // Discarding in place: reload the current selection from disk.
      setRefreshKey((k) => k + 1)
    }
  }

  return {
    slug,
    list,
    showSelector: config.showSelector ?? true,
    data,
    setData,
    contentHash,
    setContentHash: (hash: string) => setContentHash(hash),
    extra,
    setExtra: (next: Record<string, unknown>) => setExtra(next),
    currency,
    getOriginal: () => original,
    isDataReady,

    status,
    statusActions,
    dialogs,
    contextMenuCard,
    setContextMenuCard: (state) => setContextMenuCard(state),

    changePrinting,
    startChangePrinting,
    startBulkChangePrinting,
    confirmChangePrintingCount,
    handleChangePrintingSelect,
    cancelChangePrinting,

    changes,
    addedCardNames,
    pool,

    handleSelect,
    handleCancelDiscard,
    handleSetFoil,
    handleSetFinishFor,
    handleSetLanguageFor,
    handleAddCardFromSearch,
    handleUndo,
    handleSave,
    handleDiscard,
    importChanges,
    restoreChanges,

    sectionOrder,
    sectionInfo,
    handleAddSection,
    handleRenameSection,
    handleRemoveSection,
    handleMoveCardToSection,
    handleMoveCardsToSection,
    moveTargets: () => config.moveTargets?.(slug()) ?? [],
    swapSources: () => config.swapSources,

    textPrompt,
    closeTextPrompt,
    promptNewSectionForCard,
    promptNewSectionForCards,
    promptRenameSection,
  }
}
