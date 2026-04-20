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
import type { ChangeEvent, ChangeInput, CardPrintingOptions } from '../../../change-event'
import type { CardPriceResponse } from '../../api/card-price'
import type { ContextMenuState } from '../types/context-menu'
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

export type ListItem = { slug: string; name: string }

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

  changes: UseCardChangesResult<TCardEntry>
  pool: UseCardIdPoolResult

  handleSelect: (e: Event) => void
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
  const [refreshKey, setRefreshKey] = createSignal(0)

  const [status, statusActions] = useEditorStatus()
  const dialogs = useDialogState()
  const pool = useCardIdPool()
  const changes = useCardChanges<TCardEntry>()

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

  const handleSelect = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value
    setSlug(value || null)
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
    setRefreshKey((k) => k + 1)
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

    changes,
    pool,

    handleSelect,
    handleSetFoil,
    handleAddCardFromSearch,
    handleUndo,
    handleSave,
    handleDiscard,
  }
}
