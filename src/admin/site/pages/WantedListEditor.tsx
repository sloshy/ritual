import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from 'solid-js'
import type { Finish, ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import type { CardPrintingOptions } from '../types/deck-changes'
import type { WantedListCardEntry } from '../../../site/data-types'
import type { CardPriceResponse } from '../../api/card-price'
import type { ContextMenuState } from '../types/context-menu'
import { WantedListPage } from '../../../site/WantedListPage'
import { useCollectionChanges } from '../hooks/useCollectionChanges'
import { useCardIdPool } from '../hooks/useCardIdPool'
import { useEditorStatus } from '../hooks/useEditorStatus'
import { useEntryCardData } from '../hooks/useEntryCardData'
import { useDialogState } from '../hooks/useDialogState'
import { applyChangeToWantedList } from '../types/wanted-changes'
import { ChangesDialog } from '../components/ChangesDialog'
import { DiscardConfirmDialog } from '../components/DiscardConfirmDialog'
import { CardContextMenu } from '../components/CardContextMenu'
import { CardSearchModal } from '../components/CardSearchModal'
import { EditorActionBar } from '../components/EditorActionBar'
import { reconcileIdPoolForUndo, replayChanges } from '../hooks/reconcile-undo'
import { saveEditorChanges } from '../hooks/saveEditorChanges'
import { initializeEntriesWithIds } from '../../../card-id'

type WantedListItem = { slug: string; name: string }

type WantedListDataResponse = {
  success: boolean
  entries: WantedListCardEntry[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  slug: string
  contentHash: string
}

export function WantedListEditor() {
  const [listSlug, setListSlug] = createSignal<string | null>(null)
  const [wantedLists, setWantedLists] = createSignal<WantedListItem[]>([])
  const [entries, setEntries] = createSignal<WantedListCardEntry[]>([])
  const [contentHash, setContentHash] = createSignal<string>('')
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
    useCollectionChanges<WantedListCardEntry>()

  const { allocate, release, claim, resetPool } = useCardIdPool()
  let originalEntries: WantedListCardEntry[] = []

  onMount(() => {
    fetch('/api/wanted', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<{ wantedLists: WantedListItem[] }>)
      .then((data) => {
        if (data.wantedLists) setWantedLists(data.wantedLists)
      })
      .catch(() => statusActions.setError('Failed to load wanted list list'))
  })

  createEffect(
    on([listSlug, refreshKey], ([slug]) => {
      if (!slug) return
      const controller = new AbortController()
      statusActions.loadStart()

      fetch(`/api/wanted/${slug}`, { credentials: 'same-origin', signal: controller.signal })
        .then((r) => r.json() as Promise<WantedListDataResponse>)
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
            setContentHash(data.contentHash)
            discardAll()
            statusActions.loadSuccess()
          } else {
            statusActions.loadError('Failed to load wanted list')
          }
        })
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return
          statusActions.loadError('Failed to load wanted list')
        })

      onCleanup(() => controller.abort())
    }),
  )

  const handleListSelect = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value
    setListSlug(value || null)
  }

  const handleIncrement = (entry: WantedListCardEntry) => {
    const cardId = allocate()
    addCard(entry.name, {
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      cardId,
    })
    setEntries((prev) =>
      applyChangeToWantedList(prev, {
        action: 'add',
        cardName: entry.name,
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        cardId,
      }),
    )
  }

  const handleDecrement = (entry: WantedListCardEntry) => {
    if (entry.cardId !== undefined) {
      release(entry.cardId)
    }
    removeCard(
      entry.name,
      {
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        cardId: entry.cardId,
      },
      { ...entry },
    )
    setEntries((prev) =>
      applyChangeToWantedList(prev, {
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
    const currentFinish: Finish = entry?.finish ?? 'nonfoil'
    const newFinish: Finish =
      currentFinish === 'foil' || currentFinish === 'etched' ? 'nonfoil' : 'foil'
    setFinish(menu.cardName, newFinish, cardId)
    setEntries((prev) =>
      applyChangeToWantedList(prev, {
        action: 'set-finish',
        cardName: menu.cardName,
        finish: newFinish,
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
      applyChangeToWantedList(prev, {
        action: 'add',
        cardName,
        set: options?.set,
        collectorNumber: options?.collectorNumber,
        finish: options?.finish,
        cardId,
      }),
    )
    cardActions.addCard(cardName, scryfallCard, allPrintings)

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
    setEntries(replayChanges(originalEntries, remainingChanges, applyChangeToWantedList))
  }

  const handleSave = async () => {
    const slug = listSlug()
    if (!slug || entries().length === 0 || changes().length === 0) return
    const result = await saveEditorChanges(
      `/api/wanted/${slug}/save`,
      { changes: changes(), entries: entries(), contentHash: contentHash() },
      statusActions,
      discardAll,
    )
    if (result?.contentHash) {
      setContentHash(result.contentHash)
    }
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
      <h2 class="section-heading">Wanted List Editor</h2>

      <div class="deck-selector-container">
        <label class="deck-selector-label" for="wanted-list-select">
          Select Wanted List
        </label>
        <select
          id="wanted-list-select"
          class="deck-selector"
          value={listSlug() ?? ''}
          onChange={handleListSelect}
        >
          <option value="">— Choose a wanted list —</option>
          <For each={wantedLists()}>{(item) => <option value={item.slug}>{item.name}</option>}</For>
        </select>
      </div>

      <Show when={status.error}>
        <div class="alert alert-error">{status.error}</div>
      </Show>
      <Show when={status.saveStatus}>
        <div class="alert alert-success">{status.saveStatus}</div>
      </Show>
      <Show when={status.loading}>
        <p class="text-muted">Loading wanted list...</p>
      </Show>

      <Show when={entries().length > 0 && listSlug() && !status.loading}>
        <WantedListPage
          name={wantedLists().find((c) => c.slug === listSlug())?.name ?? listSlug()!}
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

      <Show when={contextMenuCard()}>
        {(menu) => (
          <CardContextMenu
            cardName={menu().cardName}
            card={menu().card}
            currentFinish={entries().find((e) => e.name === menu().cardName)?.finish}
            onSetFoil={handleSetFoil}
            onUnsetCommander={closeContextMenu}
            anchorRect={menu().anchorRect}
            onClose={closeContextMenu}
            hideCommander={true}
          />
        )}
      </Show>

      <CardSearchModal
        open={showSearchModal()}
        onClose={closeSearchModal}
        onAddCard={handleAddCardFromSearch}
        requirePrinting={false}
      />

      <ChangesDialog
        open={showChanges()}
        changes={changes()}
        cards={cardData.cards}
        printings={cardData.printings}
        symbolMap={cardData.symbolMap}
        currency={currency}
        onClose={closeChanges}
      />

      <DiscardConfirmDialog
        open={showDiscard()}
        changes={changes()}
        onConfirm={handleDiscard}
        onCancel={closeDiscard}
      />

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
