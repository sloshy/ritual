import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import type { ScryfallCard } from '../../../types'
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
import { applyChangeToWantedList } from '../types/wanted-changes'
import { ChangesDialog } from '../components/ChangesDialog'
import { DiscardConfirmDialog } from '../components/DiscardConfirmDialog'
import { CardContextMenu } from '../components/CardContextMenu'
import { CardSearchModal } from '../components/CardSearchModal'
import { EditorActionBar } from '../components/EditorActionBar'
import { reconcileIdPoolForUndo } from '../hooks/reconcile-undo'
import { initializeEntriesWithIds } from '../../../card-id'

type WantedListItem = { slug: string; name: string }

type WantedListDataResponse = {
  success: boolean
  entries: WantedListCardEntry[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  slug: string
}

type SaveResponse = { success: boolean; error?: string }

export function WantedListEditor() {
  const [listSlug, setListSlug] = useState<string | null>(null)
  const [wantedLists, setWantedLists] = useState<WantedListItem[]>([])
  const [entries, setEntries] = useState<WantedListCardEntry[]>([])
  const [modalCardKey, setModalCardKey] = useState<string | null>(null)
  const [contextMenuCard, setContextMenuCard] = useState<ContextMenuState | null>(null)
  const [showChanges, setShowChanges] = useState(false)
  const [showDiscard, setShowDiscard] = useState(false)
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [status, statusDispatch] = useEditorStatus()
  const { loading, error, saving, saveStatus } = status

  const [cardData, cardDispatch] = useEntryCardData()
  const { cards, printings, symbolMap } = cardData

  const currency: PriceCurrency = 'usd'

  const { changes, changeCount, addCard, removeCard, setFinish, discardAll, canUndo, undo } =
    useCollectionChanges<WantedListCardEntry>()

  const { allocate, release, claim, resetPool } = useCardIdPool()
  const originalEntriesRef = useRef<WantedListCardEntry[]>([])
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const changesRef = useRef(changes)
  changesRef.current = changes

  useEffect(() => {
    fetch('/api/wanted', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<{ wantedLists: WantedListItem[] }>)
      .then((data) => {
        if (data.wantedLists) setWantedLists(data.wantedLists)
      })
      .catch(() => statusDispatch({ type: 'SET_ERROR', error: 'Failed to load wanted list list' }))
  }, [])

  useEffect(() => {
    if (!listSlug) return
    const controller = new AbortController()
    statusDispatch({ type: 'LOAD_START' })

    fetch(`/api/wanted/${listSlug}`, { credentials: 'same-origin', signal: controller.signal })
      .then((r) => r.json() as Promise<WantedListDataResponse>)
      .then((data) => {
        if (controller.signal.aborted) return
        if (data.success) {
          const { entries: entriesWithIds, pool } = initializeEntriesWithIds(data.entries)
          setEntries(entriesWithIds)
          originalEntriesRef.current = entriesWithIds
          resetPool([...pool.usedIds])
          cardDispatch({
            type: 'LOAD',
            data: { cards: data.cards, printings: data.printings, symbolMap: data.symbolMap },
          })
          discardAll()
          statusDispatch({ type: 'LOAD_SUCCESS' })
        } else {
          statusDispatch({ type: 'LOAD_ERROR', error: 'Failed to load wanted list' })
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return
        statusDispatch({ type: 'LOAD_ERROR', error: 'Failed to load wanted list' })
      })

    return () => controller.abort()
  }, [listSlug, discardAll, resetPool, refreshKey])

  const handleListSelect = useCallback((e: Event) => {
    const value = (e.target as HTMLSelectElement).value
    setListSlug(value || null)
  }, [])

  const handleIncrement = useCallback(
    (entry: WantedListCardEntry) => {
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
    },
    [addCard, allocate],
  )

  const handleDecrement = useCallback(
    (entry: WantedListCardEntry) => {
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
    },
    [removeCard, release],
  )

  const handleContextMenu = useCallback(
    (cardName: string, card: ScryfallCard | null, rect: DOMRect) => {
      setContextMenuCard({ cardName, card, anchorRect: rect })
    },
    [],
  )

  const handleSetFoil = useCallback(() => {
    if (!contextMenuCard) return
    const entry = entriesRef.current.find((e) => e.name === contextMenuCard.cardName)
    const cardId = entry?.cardId
    setFinish(contextMenuCard.cardName, 'foil', cardId)
    setEntries((prev) =>
      applyChangeToWantedList(prev, {
        action: 'set-finish',
        cardName: contextMenuCard.cardName,
        finish: 'foil',
        cardId,
      }),
    )
    setContextMenuCard(null)
  }, [contextMenuCard, setFinish])

  const handleAddCardFromSearch = useCallback(
    async (
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
      cardDispatch({
        type: 'ADD_CARD',
        cardName,
        card: scryfallCard,
        printings: allPrintings,
      })

      try {
        const resp = await fetch(`/api/card-price?name=${encodeURIComponent(cardName)}`, {
          credentials: 'same-origin',
        })
        const data = (await resp.json()) as CardPriceResponse
        if (data.success) {
          cardDispatch({
            type: 'SET_PRICES',
            cardName,
            representative: !scryfallCard ? (data.representative ?? undefined) : undefined,
            printings: data.printings.length > 0 ? data.printings : undefined,
          })
        }
      } catch {
        // Price fetch failure doesn't block adding the card
      }
    },
    [addCard, allocate],
  )

  const handleUndo = useCallback(() => {
    const result = undo()
    if (!result) return

    const { entry, remainingChanges } = result

    reconcileIdPoolForUndo(release, claim, entry)

    let rebuilt = originalEntriesRef.current
    for (const change of remainingChanges) {
      rebuilt = applyChangeToWantedList(rebuilt, change)
    }
    setEntries(rebuilt)
  }, [undo, release, claim])

  const handleSave = useCallback(async () => {
    if (!listSlug || entriesRef.current.length === 0 || changesRef.current.length === 0) return
    statusDispatch({ type: 'SAVE_START' })
    try {
      const resp = await fetch(`/api/wanted/${listSlug}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ changes: changesRef.current, entries: entriesRef.current }),
      })
      const data = (await resp.json()) as SaveResponse
      if (data.success) {
        statusDispatch({ type: 'SAVE_SUCCESS', message: 'Changes saved successfully' })
        discardAll()
      } else {
        statusDispatch({ type: 'SAVE_ERROR', error: data.error ?? 'Save failed' })
      }
    } catch {
      statusDispatch({ type: 'SAVE_ERROR', error: 'Failed to save changes' })
    }
  }, [listSlug, discardAll])

  const handleDiscard = useCallback(() => {
    discardAll()
    const ids = originalEntriesRef.current
      .map((e) => e.cardId)
      .filter((id): id is number => id !== undefined)
    resetPool(ids)
    setShowDiscard(false)
    setRefreshKey((k) => k + 1)
  }, [discardAll, resetPool])

  const closeModal = useCallback(() => setModalCardKey(null), [])
  const closeContextMenu = useCallback(() => setContextMenuCard(null), [])
  const openSearchModal = useCallback(() => setShowSearchModal(true), [])
  const closeSearchModal = useCallback(() => setShowSearchModal(false), [])
  const openChanges = useCallback(() => setShowChanges(true), [])
  const closeChanges = useCallback(() => setShowChanges(false), [])
  const openDiscard = useCallback(() => setShowDiscard(true), [])
  const closeDiscard = useCallback(() => setShowDiscard(false), [])

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
          value={listSlug ?? ''}
          onChange={handleListSelect}
        >
          <option value="">— Choose a wanted list —</option>
          {wantedLists.map(({ slug, name }) => (
            <option key={slug} value={slug}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div class="alert alert-error" style="margin-bottom: 1rem;">
          {error}
        </div>
      )}
      {saveStatus && (
        <div class="alert alert-success" style="margin-bottom: 1rem;">
          {saveStatus}
        </div>
      )}
      {loading && <p style="color: var(--text-muted);">Loading wanted list...</p>}

      {entries.length > 0 && listSlug && !loading && (
        <WantedListPage
          name={wantedLists.find((c) => c.slug === listSlug)?.name ?? listSlug}
          entries={entries}
          cards={cards}
          printings={printings}
          symbolMap={symbolMap}
          useScryfallImgUrls={true}
          totalPrice={0}
          modalCardKey={modalCardKey}
          onOpenModal={setModalCardKey}
          onCloseModal={closeModal}
          currency={currency}
          editMode={true}
          onAddCard={openSearchModal}
          onCardIncrement={handleIncrement}
          onCardDecrement={handleDecrement}
          onCardContextMenu={handleContextMenu}
          unsavedChangeCount={changeCount}
        />
      )}

      {contextMenuCard && (
        <CardContextMenu
          cardName={contextMenuCard.cardName}
          card={contextMenuCard.card}
          onSetFoil={handleSetFoil}
          onUnsetCommander={closeContextMenu}
          anchorRect={contextMenuCard.anchorRect}
          onClose={closeContextMenu}
          hideCommander={true}
        />
      )}

      <CardSearchModal
        open={showSearchModal}
        onClose={closeSearchModal}
        onAddCard={handleAddCardFromSearch}
        requirePrinting={false}
      />

      <ChangesDialog
        open={showChanges}
        changes={changes}
        cards={cards}
        printings={printings}
        symbolMap={symbolMap}
        currency={currency}
        onClose={closeChanges}
      />

      <DiscardConfirmDialog
        open={showDiscard}
        changes={changes}
        onConfirm={handleDiscard}
        onCancel={closeDiscard}
      />

      {entries.length > 0 && (
        <EditorActionBar
          changeCount={changeCount}
          canUndo={canUndo}
          saving={saving}
          onShowChanges={openChanges}
          onUndo={handleUndo}
          onSave={handleSave}
          onDiscard={openDiscard}
        />
      )}
    </div>
  )
}
