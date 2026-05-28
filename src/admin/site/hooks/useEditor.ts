import {
  type Accessor,
  type Setter,
  createSignal,
  createEffect,
  on,
  onMount,
  onCleanup,
} from 'solid-js'
import type { Finish, ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import { DEFAULT_CURRENCY } from '../../../price-currency'
import type {
  ChangeEvent,
  ChangeInput,
  CardPrintingOptions,
  PrintingTuple,
} from '../../../change-event'
import type { CardPriceResponse } from '../../api/card-price'
import type { ContextMenuState, CardContextInfo } from '../types/context-menu'
import type { EditorStatus, EditorStatusActions } from './useEditorStatus'
import type { DialogState } from './useDialogState'
import type { UseCardIdPoolResult } from './useCardIdPool'
import type { UseCardChangesResult } from './useCardChanges'
import { useEditorStatus } from './useEditorStatus'
import { useDialogState } from './useDialogState'
import { useCardIdPool } from './useCardIdPool'
import { useCardChanges } from './useCardChanges'
import { reconcileIdPoolForUndo, replayChanges } from './reconcile-undo'
import { saveEditorChanges } from './saveEditorChanges'
import { useNavigationGuard } from '../navigation-guard'

export type ListItem = { slug: string; name: string }

/** A navigation deferred until the user confirms discarding unsaved changes. */
type PendingNavigation = { run: () => void }

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

export type EditorConfig<TData> = {
  /** API endpoint to fetch the list of items (e.g. /api/decks) */
  listEndpoint: string
  /** Extract the list items from the API response */
  extractListItems: (response: unknown) => ListItem[]
  /** API endpoint for loading a single item's data */
  dataEndpoint: (slug: string) => string
  /** API endpoint for saving changes */
  saveEndpoint: (slug: string) => string
  /** Human-readable entity name for error messages */
  entityLabel: string

  /** Process the load API response into editor state. Return null on failure. */
  processLoadResponse: (response: unknown) => LoadResult<TData> | null

  /** Load card display data from the full API response */
  loadCardData: (response: unknown) => void
  /** Add a single card's display data after search selection */
  addCardData: (cardName: string, card?: ScryfallCard, printings?: ScryfallCard[]) => void
  /** Update card prices from a CardPriceResponse */
  handlePriceResponse: (cardName: string, priceData: CardPriceResponse, hadCard: boolean) => void

  /** Apply a change to the in-memory data, returning updated data */
  applyChange: (data: TData, change: ChangeInput) => TData
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
  /** Build the POST body for saving */
  buildSaveBody: (params: {
    data: TData
    changes: ChangeEvent[]
    contentHash: string
    extra: Record<string, unknown>
  }) => unknown
}

export type UseEditorResult<TData, TCardEntry> = {
  slug: Accessor<string | null>
  list: Accessor<ListItem[]>
  data: Accessor<TData | null>
  setData: Setter<TData | null>
  contentHash: Accessor<string>
  extra: Accessor<Record<string, unknown>>
  currency: PriceCurrency
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
  pool: UseCardIdPoolResult

  handleSelect: (e: Event) => void
  handleCancelDiscard: () => void
  handleSetFoil: () => void
  handleAddCardFromSearch: (
    cardName: string,
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
  ) => Promise<void>
  handleUndo: () => void
  handleSave: () => Promise<void>
  handleDiscard: () => void
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
  const [extra, setExtra] = createSignal<Record<string, unknown>>({})
  const [contextMenuCard, setContextMenuCard] = createSignal<ContextMenuState | null>(null)
  const [changePrinting, setChangePrinting] = createSignal<ChangePrintingFlow | null>(null)
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [pendingNav, setPendingNav] = createSignal<PendingNavigation | null>(null)

  const [status, statusActions] = useEditorStatus()
  const dialogs = useDialogState()
  const pool = useCardIdPool()
  const changes = useCardChanges<TCardEntry>()
  const navigationGuard = useNavigationGuard()

  const currency: PriceCurrency = DEFAULT_CURRENCY
  let original: TData | null = null

  const isDataReady = () => {
    const d = data()
    return d !== null && config.hasData(d) && slug() !== null && !status.loading
  }

  // Fetch list on mount
  onMount(() => {
    fetch(config.listEndpoint, { credentials: 'same-origin' })
      .then((r) => r.json())
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

      fetch(config.dataEndpoint(s), { credentials: 'same-origin', signal: controller.signal })
        .then((r) => r.json())
        .then((response: unknown) => {
          if (controller.signal.aborted) return
          const result = config.processLoadResponse(response)
          if (result) {
            setData(() => result.data)
            original = result.data
            pool.resetPool(result.poolIds)
            config.loadCardData(response)
            setContentHash(result.contentHash)
            setExtra(result.extra)
            changes.discardAll()
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
   * {@link handleDiscard}); otherwise it runs immediately. Returns true when it
   * ran synchronously.
   */
  const guardedNavigate = (proceed: () => void): boolean => {
    if (changes.changeCount() > 0) {
      setPendingNav({ run: proceed })
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
      attempt: (proceed) => void guardedNavigate(proceed),
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
    setPendingNav(null)
    dialogs.closeDiscard()
  }

  const handleSetFoil = () => {
    const menu = contextMenuCard()
    const d = data()
    if (!menu || !d) return
    const cardId = config.findCardId(d, menu.cardName)
    const currentFinish = config.findCurrentFinish(d, menu.cardName)
    const originalFinish = original
      ? config.findOriginalFinish(original, menu.cardName, cardId)
      : ('nonfoil' as Finish)
    const newFinish: Finish =
      currentFinish === 'foil' || currentFinish === 'etched' ? 'nonfoil' : 'foil'
    changes.setFinish(menu.cardName, newFinish, originalFinish, cardId)
    setData((prev) =>
      prev !== null
        ? config.applyChange(prev, {
            action: 'set-finish',
            cardName: menu.cardName,
            finish: newFinish,
            cardId,
          })
        : prev,
    )
    setContextMenuCard(null)
  }

  const handleAddCardFromSearch = async (
    cardName: string,
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
  ) => {
    const cardId = pool.allocate()
    changes.addCard(cardName, { ...options, cardId })
    setData((prev) =>
      prev !== null
        ? config.applyChange(prev, {
            action: 'add',
            cardName,
            set: options?.set,
            collectorNumber: options?.collectorNumber,
            finish: options?.finish,
            condition: options?.condition,
            cardId,
          })
        : prev,
    )
    config.addCardData(cardName, scryfallCard, allPrintings)

    try {
      const resp = await fetch(`/api/card-price?name=${encodeURIComponent(cardName)}`, {
        credentials: 'same-origin',
      })
      const priceData = (await resp.json()) as CardPriceResponse
      if (priceData.success) {
        config.handlePriceResponse(cardName, priceData, !!scryfallCard)
      }
    } catch {
      // Price fetch failure doesn't block adding the card
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

  const cancelChangePrinting = () => setChangePrinting(null)

  const handleChangePrintingSelect = (
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
  ) => {
    const flow = changePrinting()
    const d = data()
    if (!flow || !d || !config.applyChangePrinting) {
      setChangePrinting(null)
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
    setChangePrinting(null)
  }

  const handleUndo = () => {
    const result = changes.undo()
    if (!result || !original) return
    const origData = original
    const { entry, remainingChanges } = result
    reconcileIdPoolForUndo(pool.release, pool.claim, entry)
    setData(() => replayChanges(origData, remainingChanges, config.applyChange))
  }

  const handleSave = async () => {
    const s = slug()
    const d = data()
    if (!s || !d || !config.hasData(d) || changes.changes().length === 0) return
    const result = await saveEditorChanges(
      config.saveEndpoint(s),
      config.buildSaveBody({
        data: d,
        changes: changes.changes(),
        contentHash: contentHash(),
        extra: extra(),
      }),
      statusActions,
      changes.discardAll,
    )
    if (result?.contentHash) {
      setContentHash(result.contentHash)
    }
  }

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
    confirmChangePrintingCount,
    handleChangePrintingSelect,
    cancelChangePrinting,

    changes,
    pool,

    handleSelect,
    handleCancelDiscard,
    handleSetFoil,
    handleAddCardFromSearch,
    handleUndo,
    handleSave,
    handleDiscard,
  }
}
