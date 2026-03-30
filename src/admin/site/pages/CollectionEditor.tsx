import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from 'solid-js'
import type { ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import type { CardPrintingOptions } from '../types/deck-changes'
import type { CollectionCardEntry } from '../../../site/data-types'
import type { CardPriceResponse } from '../../api/card-price'
import type { ContextMenuState } from '../types/context-menu'
import { CollectionPage } from '../../../site/CollectionPage'
import { useEditorStatus } from '../hooks/useEditorStatus'
import { useEntryCardData } from '../hooks/useEntryCardData'
import { useDialogState } from '../hooks/useDialogState'
import { useCollectionChanges } from '../hooks/useCollectionChanges'
import { useCardIdPool } from '../hooks/useCardIdPool'
import { applyChangeToCollection } from '../types/collection-changes'
import { ChangesDialog } from '../components/ChangesDialog'
import { DiscardConfirmDialog } from '../components/DiscardConfirmDialog'
import { CardContextMenu } from '../components/CardContextMenu'
import { CardSearchModal } from '../components/CardSearchModal'
import { EditorActionBar } from '../components/EditorActionBar'
import { reconcileIdPoolForUndo, replayChanges } from '../hooks/reconcile-undo'
import { saveEditorChanges } from '../hooks/saveEditorChanges'
import { initializeEntriesWithIds } from '../../../card-id'

type CollectionListItem = { slug: string; name: string }

type CollectionDataResponse = {
  success: boolean
  entries: CollectionCardEntry[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  slug: string
}

export function CollectionEditor() {
  const [collectionSlug, setCollectionSlug] = createSignal<string | null>(null)
  const [collectionList, setCollectionList] = createSignal<CollectionListItem[]>([])
  const [entries, setEntries] = createSignal<CollectionCardEntry[]>([])
  const [modalCardKey, setModalCardKey] = createSignal<string | null>(null)
  const [contextMenuCard, setContextMenuCard] = createSignal<ContextMenuState | null>(null)
  const [refreshKey, setRefreshKey] = createSignal(0)

  const [status, statusActions] = useEditorStatus()
  const [cardData, cardActions] = useEntryCardData()

  const currency: PriceCurrency = 'usd'

  const {
    showChanges,
    showDiscard,
    showSearchModal,
    openChanges,
    closeChanges,
    openDiscard,
    closeDiscard,
    openSearchModal,
    closeSearchModal,
  } = useDialogState()

  const { changes, changeCount, addCard, removeCard, setFinish, discardAll, canUndo, undo } =
    useCollectionChanges<CollectionCardEntry>()

  const { allocate, release, claim, resetPool } = useCardIdPool()
  let originalEntries: CollectionCardEntry[] = []

  // Fetch collection list on mount
  onMount(() => {
    fetch('/api/collections', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<{ collections: CollectionListItem[] }>)
      .then((data) => {
        if (data.collections) setCollectionList(data.collections)
      })
      .catch(() => statusActions.setError('Failed to load collection list'))
  })

  // Fetch full collection data when slug changes
  createEffect(
    on([collectionSlug, refreshKey], ([slug]) => {
      if (!slug) return
      const controller = new AbortController()
      statusActions.loadStart()

      fetch(`/api/collection/${slug}`, {
        credentials: 'same-origin',
        signal: controller.signal,
      })
        .then((r) => r.json() as Promise<CollectionDataResponse>)
        .then((data) => {
          if (controller.signal.aborted) return
          if (data.success) {
            const { entries: entriesWithIds, pool } = initializeEntriesWithIds(data.entries)
            setEntries(entriesWithIds)
            originalEntries = entriesWithIds
            resetPool([...pool.usedIds])
            cardActions.load({
              cards: data.cards,
              printings: data.printings,
              symbolMap: data.symbolMap,
            })
            discardAll()
            statusActions.loadSuccess()
          } else {
            statusActions.loadError('Failed to load collection')
          }
        })
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return
          statusActions.loadError('Failed to load collection')
        })

      onCleanup(() => controller.abort())
    }),
  )

  const handleCollectionSelect = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value
    setCollectionSlug(value || null)
  }

  const handleIncrement = (entry: CollectionCardEntry) => {
    const cardId = allocate()
    addCard(entry.name, {
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      cardId,
    })
    setEntries((prev) =>
      applyChangeToCollection(prev, {
        action: 'add',
        cardName: entry.name,
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        condition: entry.condition,
        cardId,
      }),
    )
  }

  const handleDecrement = (entry: CollectionCardEntry) => {
    // In collections, each entry is a single card — removal always releases the ID
    if (entry.cardId !== undefined) {
      release(entry.cardId)
    }
    removeCard(
      entry.name,
      {
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        condition: entry.condition,
        cardId: entry.cardId,
      },
      { ...entry },
    )
    setEntries((prev) =>
      applyChangeToCollection(prev, {
        action: 'remove',
        cardName: entry.name,
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        cardId: entry.cardId,
        fileOrder: entry.fileOrder,
      }),
    )
  }

  const handleContextMenu = (cardName: string, card: ScryfallCard | null, rect: DOMRect) => {
    setContextMenuCard({ cardName, card, anchorRect: rect })
  }

  const handleSetFoil = () => {
    const menu = contextMenuCard()
    if (!menu) return
    const entry = entries().find((e) => e.name === menu.cardName)
    const cardId = entry?.cardId
    setFinish(menu.cardName, 'foil', cardId)
    setEntries((prev) =>
      applyChangeToCollection(prev, {
        action: 'set-finish',
        cardName: menu.cardName,
        finish: 'foil',
        cardId,
      }),
    )
    setContextMenuCard(null)
  }

  const handleAddCardFromSearch = async (
    cardName: string,
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
  ) => {
    const cardId = allocate()
    addCard(cardName, { ...options, cardId })
    setEntries((prev) =>
      applyChangeToCollection(prev, {
        action: 'add',
        cardName,
        set: options?.set,
        collectorNumber: options?.collectorNumber,
        finish: options?.finish,
        condition: options?.condition,
        cardId,
      }),
    )
    cardActions.addCard(cardName, scryfallCard, allPrintings)

    // Fetch price data from server
    try {
      const resp = await fetch(`/api/card-price?name=${encodeURIComponent(cardName)}`, {
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as CardPriceResponse
      if (data.success) {
        cardActions.setPrices(
          cardName,
          !scryfallCard ? (data.representative ?? undefined) : undefined,
          data.printings.length > 0 ? data.printings : undefined,
        )
      }
    } catch {
      // Price fetch failure doesn't block adding the card
    }
  }

  const handleUndo = () => {
    const result = undo()
    if (!result) return

    const { entry, remainingChanges } = result
    reconcileIdPoolForUndo(release, claim, entry)
    setEntries(replayChanges(originalEntries, remainingChanges, applyChangeToCollection))
  }

  const handleSave = async () => {
    const slug = collectionSlug()
    if (!slug || entries().length === 0 || changes().length === 0) return
    await saveEditorChanges(
      `/api/collection/${slug}/save`,
      { changes: changes(), entries: entries() },
      statusActions,
      discardAll,
    )
  }

  const handleDiscard = () => {
    discardAll()
    const ids = originalEntries.map((e) => e.cardId).filter((id): id is number => id !== undefined)
    resetPool(ids)
    closeDiscard()
    setRefreshKey((k) => k + 1)
  }

  const closeModal = () => setModalCardKey(null)
  const closeContextMenu = () => setContextMenuCard(null)

  return (
    <div>
      <h2 class="section-heading">Collection Editor</h2>

      {/* Collection selector */}
      <div class="deck-selector-container">
        <label class="deck-selector-label" for="collection-select">
          Select Collection
        </label>
        <select
          id="collection-select"
          class="deck-selector"
          value={collectionSlug() ?? ''}
          onChange={handleCollectionSelect}
        >
          <option value="">— Choose a collection —</option>
          <For each={collectionList()}>
            {(item) => <option value={item.slug}>{item.name}</option>}
          </For>
        </select>
      </div>

      {/* Status messages */}
      <Show when={status.error}>
        <div class="alert alert-error">{status.error}</div>
      </Show>
      <Show when={status.saveStatus}>
        <div class="alert alert-success">{status.saveStatus}</div>
      </Show>
      <Show when={status.loading}>
        <p class="text-muted">Loading collection...</p>
      </Show>

      {/* Collection content */}
      <Show when={entries().length > 0 && collectionSlug() && !status.loading}>
        <CollectionPage
          name={
            collectionList().find((c) => c.slug === collectionSlug())?.name ?? collectionSlug()!
          }
          entries={entries()}
          cards={cardData.cards}
          printings={cardData.printings}
          symbolMap={cardData.symbolMap}
          useScryfallImgUrls={true}
          totalPrice={0}
          modalCardKey={modalCardKey()}
          onOpenModal={setModalCardKey}
          onCloseModal={closeModal}
          currency={currency}
          editMode={true}
          onAddCard={openSearchModal}
          onCardIncrement={handleIncrement}
          onCardDecrement={handleDecrement}
          onCardContextMenu={handleContextMenu}
          unsavedChangeCount={changeCount()}
        />
      </Show>

      {/* Context menu — no commander option for collections */}
      <Show when={contextMenuCard()}>
        {(menu) => (
          <CardContextMenu
            cardName={menu().cardName}
            card={menu().card}
            onSetFoil={handleSetFoil}
            onUnsetCommander={closeContextMenu}
            anchorRect={menu().anchorRect}
            onClose={closeContextMenu}
            hideCommander={true}
          />
        )}
      </Show>

      {/* Card search modal — requirePrinting forces printing/finish/condition selection */}
      <CardSearchModal
        open={showSearchModal()}
        onClose={closeSearchModal}
        onAddCard={handleAddCardFromSearch}
        requirePrinting={true}
      />

      {/* Changes dialog */}
      <ChangesDialog
        open={showChanges()}
        changes={changes()}
        cards={cardData.cards}
        printings={cardData.printings}
        symbolMap={cardData.symbolMap}
        currency={currency}
        onClose={closeChanges}
      />

      {/* Discard confirm dialog */}
      <DiscardConfirmDialog
        open={showDiscard()}
        changes={changes()}
        onConfirm={handleDiscard}
        onCancel={closeDiscard}
      />

      {/* Sticky action bar */}
      <Show when={entries().length > 0}>
        <EditorActionBar
          changeCount={changeCount()}
          canUndo={canUndo()}
          saving={status.saving}
          onShowChanges={openChanges}
          onUndo={handleUndo}
          onSave={handleSave}
          onDiscard={openDiscard}
        />
      </Show>
    </div>
  )
}
