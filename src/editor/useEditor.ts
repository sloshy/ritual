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
import { replaySectionOrder } from '../change-event'
import { DEFAULT_SECTION, type Finish, type ScryfallCard } from '../types'
import type { PriceCurrency } from '../price-currency'
import { DEFAULT_CURRENCY } from '../price-currency'
import type {
  ChangeEvent,
  ChangeInput,
  CardPrintingOptions,
  PrintingTuple,
  ListRef,
} from '../change-event'
import { retargetImportedChanges, type ImportConflict } from './import-changes'
import type { ContextMenuState, CardContextInfo } from './context-menu'
import type { EditorStatus, EditorStatusActions } from './useEditorStatus'
import type { DialogState } from './useDialogState'
import type { UseCardIdPoolResult } from './useCardIdPool'
import type { UseCardChangesResult } from './useCardChanges'
import type { CommitSink } from './commit'
import { useEditorStatus } from './useEditorStatus'
import { useDialogState } from './useDialogState'
import { useCardIdPool } from './useCardIdPool'
import { useCardChanges } from './useCardChanges'
import { reconcileIdPoolForUndo, replayChanges } from './reconcile-undo'
import { useNavigationGuard } from './navigation-guard'
import { clampQuantity } from '../ui/quantity'
import type { ApplyChange } from './apply-batch'

export type ListItem = { slug: string; name: string }

/** A navigation deferred until the user confirms discarding unsaved changes. */
type PendingNavigation = { run: () => void; cancel?: () => void }

/**
 * Narrow set of change/pool operations the "change printing" flow needs, built
 * by {@link useEditor} from the card-changes and card-id-pool hooks. Kept free of
 * the editor's card-entry generic so the per-list `applyChangePrinting`
 * implementations stay simple.
 */
export type ChangePrintingTools = {
  setPrinting: (
    cardName: string,
    target: PrintingTuple,
    original: PrintingTuple,
    cardId?: number,
  ) => void
  addCard: (cardName: string, options?: CardPrintingOptions) => void
  decrementCard: (cardName: string, cardId?: number) => void
  allocateId: () => number
}

/** Everything a list-specific `applyChangePrinting` needs to apply the change. */
export type ChangePrintingContext<TData> = {
  data: TData
  original: TData | null
  /** Identity + current printing of the targeted tile. */
  target: CardContextInfo
  /** How many copies to retarget (1..target.quantity). */
  count: number
  /** The chosen printing (set/collectorNumber/finish/condition); empty = no specific printing. */
  options: CardPrintingOptions
  tools: ChangePrintingTools
  setData: Setter<TData | null>
}

/** UI state for the multi-step change-printing flow. */
export type ChangePrintingFlow = {
  target: CardContextInfo
  step: 'quantity' | 'printing'
  count: number
}

type LoadResult<TData> = {
  data: TData
  poolIds: number[]
  contentHash: string
  extra: Record<string, unknown>
}

/**
 * Commit a card chosen in the search dialog. Every argument past the name is
 * optional, so the dialog, the shell, and the editor share one type rather than
 * three hand-written copies that can silently drop a trailing argument.
 */
export type AddCardFromSearch = (
  cardName: string,
  options?: CardPrintingOptions,
  scryfallCard?: ScryfallCard,
  allPrintings?: ScryfallCard[],
  /** Copies to add. Defaults to 1. */
  quantity?: number,
) => void

/**
 * How a list models multiple copies of the same printing. Decks keep one entry
 * carrying a quantity, so every copy shares a single card ID; collections and
 * wanted lists store one entry per copy, so each copy needs its own ID.
 */
export type CopyModel = 'quantity' | 'per-entry'

/** Upper bound on copies a single add-from-search may commit. */
const MAX_ADD_COPIES = 999

/**
 * The editor config a list page supplies. The copy model is not part of it: it
 * follows from the data shape, so the deck / flat-list controller fills it in.
 */
export type ListEditorConfig<TData> = Omit<EditorConfig<TData>, 'copyModel'>

export type EditorConfig<TData> = {
  /** See {@link CopyModel}. Supplied by the deck / flat-list controller. */
  copyModel: CopyModel
  /**
   * Fetch the raw list-of-items payload (passed to {@link extractListItems}).
   * Admin hits `/api/decks` etc.; the public site resolves a single preloaded
   * item without a network call.
   */
  fetchList: () => Promise<unknown>
  /** Extract the list items from the {@link fetchList} payload. */
  extractListItems: (response: unknown) => ListItem[]
  /**
   * Fetch the raw payload for one item (passed to {@link processLoadResponse}).
   * Admin hits `/api/deck/{slug}`; the public site resolves its preloaded data.
   */
  fetchData: (slug: string, signal: AbortSignal) => Promise<unknown>
  /** Commit (or export) the pending edits. See {@link CommitSink}. */
  commit: CommitSink<TData>
  /** Whether to render the list selector dropdown. Defaults to true (admin); the public single-item editor hides it. */
  showSelector?: boolean
  /** Human-readable entity name for error messages */
  entityLabel: string

  /** Process the load payload into editor state. Return null on failure. */
  processLoadResponse: (response: unknown) => LoadResult<TData> | null

  /** Load card display data from the full load payload */
  loadCardData: (response: unknown) => void
  /** Add a single card's display data after search selection */
  addCardData: (cardName: string, card?: ScryfallCard, printings?: ScryfallCard[]) => void
  /**
   * Hook run after a card is added from search, to load and apply its prices.
   * Admin fetches `/api/card-price`; the public site uses the printing already in
   * hand or its session cache. Optional — adding still works without prices.
   */
  onCardAdded?: (cardName: string, scryfallCard?: ScryfallCard) => Promise<void> | void

  /** Apply a change to the in-memory data, returning updated data */
  applyChange: ApplyChange<TData, ChangeInput>
  /**
   * Apply a "change printing" action: emit the appropriate change events (via
   * `ctx.tools`) and update the in-memory data (via `ctx.setData`). List types
   * differ — decks split a multi-copy entry into decrement + new-printing add,
   * while collections/wanted retarget individual entries — so each editor
   * provides its own implementation. Omitted to disable the feature for a list.
   */
  applyChangePrinting?: (ctx: ChangePrintingContext<TData>) => void
  /** Whether the loaded data is non-empty (e.g. entries.length > 0) */
  hasData: (data: TData) => boolean

  /** Resolve the current finish for a card in the data */
  findCurrentFinish: (data: TData, cardName: string) => Finish
  /** Resolve the original finish for foil toggle comparison */
  findOriginalFinish: (original: TData, cardName: string, cardId?: number) => Finish
  /** Find the card ID for a card by name */
  findCardId: (data: TData, cardName: string) => number | undefined

  /** Extract all card IDs from data (for pool reset on discard) */
  getOriginalIds: (original: TData) => number[]

  /**
   * Derive the section order directly from the data, when sections live in the data itself
   * (decks: `deck.sections`). Flat lists (collections/wanted) omit this and instead seed the
   * order from `extra.sectionOrder` on load, after which it is derived by replaying the
   * section-structural changes.
   */
  sectionsOf?: (data: TData) => string[]
  /** Count cards per section, used to disable deletion of non-empty sections. */
  cardCountsBySection?: (data: TData) => Record<string, number>
  /** Resolve the section a targeted card currently belongs to (for move consolidation). */
  cardSectionOf?: (data: TData, target: CardContextInfo) => string | undefined

  /**
   * The other lists a card in this editor can be moved to. Drives the "Move to
   * list" menus; omit to disable cross-list moves. Receives the slug of the list
   * currently open — which changes as the user picks another one — so the
   * implementation can exclude it without tracking the selection itself.
   */
  moveTargets?: (currentSlug: string | null) => ListRef[]

  /**
   * The currency price displays should use, as a reactive accessor. The admin
   * editors pass the configured default currency (from `/api/config`); the
   * public editors pass the site's active currency. Defaults to USD.
   */
  currency?: Accessor<PriceCurrency>
}

/** A section plus how many cards it currently holds. */
export type SectionInfo = { name: string; count: number }

/** An in-app text-input prompt (replaces native `window.prompt` for section naming). */
export type TextPromptState = {
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  /** Returns an error message for an invalid value, or null when acceptable. */
  validate?: (value: string) => string | null
  onConfirm: (value: string) => void
}

/** Outcome of importing a change file's events into the editor. */
export type ImportResult = {
  /** Number of changes loaded as pending edits after re-targeting. */
  loaded: number
  /** Changes that could not be re-targeted to a current card and were skipped. */
  conflicts: ImportConflict[]
}

export type UseEditorResult<TData, TCardEntry> = {
  slug: Accessor<string | null>
  list: Accessor<ListItem[]>
  /** Whether the list selector dropdown should be shown (false for the public single-item editor). */
  showSelector: boolean
  data: Accessor<TData | null>
  setData: Setter<TData | null>
  contentHash: Accessor<string>
  extra: Accessor<Record<string, unknown>>
  /** The currency price displays use (the config's accessor, or a USD constant). */
  currency: Accessor<PriceCurrency>
  getOriginal: () => TData | null
  isDataReady: () => boolean

  status: EditorStatus
  statusActions: EditorStatusActions
  dialogs: DialogState
  contextMenuCard: Accessor<ContextMenuState | null>
  setContextMenuCard: (state: ContextMenuState | null) => void

  /** Current change-printing flow state (null when inactive). */
  changePrinting: Accessor<ChangePrintingFlow | null>
  /** Open the change-printing flow for a targeted tile. */
  startChangePrinting: (target: CardContextInfo) => void
  /** Begin a sequential change-printing run over many targets (bulk multi-select). */
  startBulkChangePrinting: (targets: CardContextInfo[]) => void
  /** Advance from the quantity prompt to the printing picker. */
  confirmChangePrintingCount: (count: number) => void
  /** Apply the chosen printing to the targeted copies. */
  handleChangePrintingSelect: (
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
  ) => void
  /** Abandon the change-printing flow. */
  cancelChangePrinting: () => void

  changes: UseCardChangesResult<TCardEntry>
  /** Card names added this session (not pre-existing, not moved from another list). */
  addedCardNames: () => string[]
  pool: UseCardIdPoolResult

  handleSelect: (e: Event) => void
  handleCancelDiscard: () => void
  handleSetFoil: () => void
  /** Set an explicit finish on one targeted card/copy (backs the bulk foil actions). */
  handleSetFinishFor: (cardName: string, finish: Finish, cardId?: number) => void
  handleAddCardFromSearch: (...args: Parameters<AddCardFromSearch>) => Promise<void>
  handleUndo: () => void
  handleSave: () => Promise<void>
  handleDiscard: () => void
  /** Load an imported change file's events as pending edits, re-targeted to current card IDs. */
  importChanges: (changes: ChangeEvent[]) => ImportResult
  /** Resume an in-memory edit session verbatim (no re-targeting), preserving exact card IDs. */
  restoreChanges: (changes: ChangeEvent[]) => void

  /** Current section names in display order, including empty sections. */
  sectionOrder: Accessor<string[]>
  /** Sections with their current card counts, in display order. */
  sectionInfo: Accessor<SectionInfo[]>
  /** Create a new, empty section. No-op if a section with that name already exists. */
  handleAddSection: (name: string) => void
  /** Rename an existing section, moving all its cards along with it. */
  handleRenameSection: (oldName: string, newName: string) => void
  /** Delete a section. Only takes effect when the section is empty. */
  handleRemoveSection: (name: string) => void
  /** Move a card (identified by the context menu target) into a section, creating it if needed. */
  handleMoveCardToSection: (target: CardContextInfo, section: string) => void
  /** Move many targeted cards into a section in one pass (creating it once if needed). */
  handleMoveCardsToSection: (targets: CardContextInfo[], section: string) => void

  /** The other lists a card here can be moved to (excludes the current list). */
  moveTargets: () => ListRef[]

  /** The active in-app text prompt (section naming), or null when none is open. */
  textPrompt: Accessor<TextPromptState | null>
  /** Dismiss the active text prompt without confirming. */
  closeTextPrompt: () => void
  /** Open a styled prompt to name a new section and move the targeted card into it. */
  promptNewSectionForCard: (target: CardContextInfo) => void
  /** Open a styled prompt to name a new section and move many targeted cards into it. */
  promptNewSectionForCards: (targets: CardContextInfo[]) => void
  /** Open a styled prompt to rename an existing section. */
  promptRenameSection: (oldName: string) => void
}

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
  const [changePrinting, setChangePrinting] = createSignal<ChangePrintingFlow | null>(null)
  // Remaining cards awaiting their turn in a bulk change-printing run. Each card's
  // flow (quantity → printing) is driven one at a time; completing or skipping one
  // advances to the next. Empty for the single-card menu flow.
  const [printingQueue, setPrintingQueue] = createSignal<CardContextInfo[]>([])
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [pendingNav, setPendingNav] = createSignal<PendingNavigation | null>(null)

  const [status, statusActions] = useEditorStatus()
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

  const isDataReady = () => {
    const d = data()
    return d !== null && config.hasData(d) && slug() !== null && !status.loading
  }

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
      .catch(() => statusActions.setError(`Failed to load ${config.entityLabel} list`))
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
            setOriginalSectionOrder(Array.isArray(loadedOrder) ? (loadedOrder as string[]) : [])
            pool.resetPool(result.poolIds)
            config.loadCardData(response)
            setContentHash(result.contentHash)
            setExtra(result.extra)
            changes.discardAll()
            setHasSavedThisSession(false)
            statusActions.loadSuccess()
          } else {
            statusActions.loadError(`Failed to load ${config.entityLabel}`)
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return
          statusActions.loadError(`Failed to load ${config.entityLabel}`)
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
    const originalFinish: Finish = original
      ? config.findOriginalFinish(original, cardName, id)
      : 'nonfoil'
    changes.setFinish(cardName, finish, originalFinish, id)
    setData((prev) =>
      prev !== null
        ? config.applyChange(prev, { action: 'set-finish', cardName, finish, cardId: id })
        : prev,
    )
  }

  const handleSetFoil = () => {
    const menu = contextMenuCard()
    const d = data()
    if (!menu || !d) return
    const cardId = config.findCardId(d, menu.cardName)
    const currentFinish = config.findCurrentFinish(d, menu.cardName)
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
    batch(() => {
      for (let i = 0; i < copies; i++) {
        const cardId = sharedId ?? pool.allocate()
        changes.addCard(cardName, { ...normalized, cardId })
        setData((prev) =>
          prev !== null
            ? config.applyChange(prev, {
                action: 'add',
                cardName,
                set: normalized.set,
                collectorNumber: normalized.collectorNumber,
                finish: normalized.finish,
                condition: normalized.condition,
                cardId,
              })
            : prev,
        )
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
    setChangePrinting({
      target,
      step: target.quantity > 1 ? 'quantity' : 'printing',
      count: target.quantity > 1 ? target.quantity : 1,
    })
  }

  const confirmChangePrintingCount = (count: number) => {
    setChangePrinting((prev) => (prev ? { ...prev, step: 'printing', count } : prev))
  }

  /** Begin a sequential change-printing run over many targets (bulk multi-select). */
  const startBulkChangePrinting = (targets: CardContextInfo[]) => {
    const [first, ...rest] = targets
    if (!config.applyChangePrinting || !first) return
    setPrintingQueue(rest)
    startChangePrinting(first)
  }

  /** Advance a bulk change-printing run to the next queued card, if any. No-op otherwise. */
  const advancePrintingQueue = () => {
    const [next, ...rest] = printingQueue()
    if (!next) return
    setPrintingQueue(rest)
    startChangePrinting(next)
  }

  // Cancelling means "skip this card and continue" while a bulk run is active
  // (mirrors the per-card skip in the bulk Add-to-Trade flow); for the single-card
  // menu flow the queue is empty so this just closes the flow.
  const cancelChangePrinting = () =>
    batch(() => {
      setChangePrinting(null)
      advancePrintingQueue()
    })

  const handleChangePrintingSelect = (
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
  ) => {
    const flow = changePrinting()
    const d = data()
    if (!flow || !d || !config.applyChangePrinting) {
      batch(() => {
        setChangePrinting(null)
        advancePrintingQueue()
      })
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
    batch(() => {
      setChangePrinting(null)
      advancePrintingQueue()
    })
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
    return sectionOrder().map((name) => ({ name, count: counts[name] ?? 0 }))
  })

  // Section names are unique case-insensitively. Returns the existing section whose name
  // matches `name` ignoring case, if any, so callers can reject duplicates and resolve a typed
  // name back to its canonical casing.
  const canonicalSection = (name: string): string | undefined =>
    sectionOrder().find((s) => s.toLowerCase() === name.toLowerCase())

  const handleAddSection = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || canonicalSection(trimmed)) return
    changes.addChange({ action: 'add-section', section: trimmed })
    setData((prev) =>
      prev !== null ? config.applyChange(prev, { action: 'add-section', section: trimmed }) : prev,
    )
  }

  const handleRenameSection = (oldName: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    // A pure case change of the same section is allowed; clashing with a *different* existing
    // section (case-insensitively) is not.
    const clash = canonicalSection(trimmed)
    if (clash && clash !== oldName) return
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
      // The original section drives "latest wins" consolidation: moving a card back to where it
      // started cancels the pending move outright. A card not present in the on-disk original
      // (e.g. added this session) baselines to DEFAULT_SECTION — never the destination, which
      // would make the very first move look like a no-op revert and silently drop it.
      const originalSection =
        (original ? config.cardSectionOf?.(original, target) : undefined) ?? DEFAULT_SECTION
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

  // Validation shared by the new-section and rename prompts: non-empty and unique
  // case-insensitively (a rename may keep its own name via `allowExisting`).
  const sectionNameError = (value: string, allowExisting?: string): string | null => {
    const trimmed = value.trim()
    if (!trimmed) return 'Enter a section name.'
    const clash = sectionOrder().find((s) => s.toLowerCase() === trimmed.toLowerCase())
    if (clash && clash !== allowExisting) return `A section named “${clash}” already exists.`
    return null
  }

  const promptNewSectionForCards = (targets: CardContextInfo[]) => {
    // Close the editor-level menu; the deck editor's parallel menu state is cleared by its wrapper.
    setContextMenuCard(null)
    setTextPrompt({
      title: 'Move to new section',
      label: 'New section name',
      initialValue: '',
      confirmLabel: 'Move',
      validate: (v) => sectionNameError(v),
      onConfirm: (v) => {
        handleMoveCardsToSection(targets, v.trim())
        closeTextPrompt()
      },
    })
  }

  const promptNewSectionForCard = (target: CardContextInfo) => promptNewSectionForCards([target])

  const promptRenameSection = (oldName: string) => {
    setTextPrompt({
      title: 'Rename section',
      label: 'Section name',
      initialValue: oldName,
      confirmLabel: 'Rename',
      validate: (v) => sectionNameError(v, oldName),
      onConfirm: (v) => {
        handleRenameSection(oldName, v.trim())
        closeTextPrompt()
      },
    })
  }

  const handleUndo = () => {
    const result = changes.undo()
    if (!result || !original) return
    const origData = original
    const { entry, remainingChanges } = result
    reconcileIdPoolForUndo(pool.release, pool.claim, entry, remainingChanges)
    setData(() => replayChanges(origData, remainingChanges, config.applyChange))
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
    setData(() => replayChanges(orig, retargeted, config.applyChange))

    // Load display data (image + price) for cards added by the import that the
    // list did not already contain. Reuses the same per-list hook as adding a card
    // from search; it pulls from the admin's local Scryfall cache. Fire-and-forget
    // — the tiles fill in reactively as each fetch resolves.
    const newlyAdded = new Set<string>()
    for (const change of retargeted) {
      if (change.action === 'add' && config.findCardId(orig, change.cardName) === undefined) {
        newlyAdded.add(change.cardName)
      }
    }
    for (const cardName of newlyAdded) void config.onCardAdded?.(cardName)

    return { loaded: retargeted.length, conflicts }
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
    setData(() => replayChanges(orig, restored, config.applyChange))
    // Mark every ID the restored changes reference as in use, so later adds in this
    // resumed session don't reallocate one of them.
    const used = new Set<number>(config.getOriginalIds(orig))
    for (const change of restored) {
      if ('cardId' in change && typeof change.cardId === 'number') used.add(change.cardId)
    }
    pool.resetPool([...used])
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
    const names = new Set<string>()
    for (const change of changes.changes()) {
      if (
        change.action === 'add' &&
        (!orig || config.findCardId(orig, change.cardName) === undefined)
      ) {
        names.add(change.cardName)
      }
    }
    return [...names]
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
    extra,
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

    textPrompt,
    closeTextPrompt,
    promptNewSectionForCard,
    promptNewSectionForCards,
    promptRenameSection,
  }
}
