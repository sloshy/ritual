import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import type { ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import type { CardPrintingOptions } from '../types/deck-changes'
import type { CollectionCardEntry } from '../../../site/data-types'
import type { CardPriceResponse } from '../../api/card-price'
import type { ContextMenuState } from '../types/context-menu'
import { CollectionPage } from '../../../site/CollectionPage'
import { useCollectionChanges } from '../hooks/useCollectionChanges'
import { useCardIdPool } from '../hooks/useCardIdPool'
import { applyChangeToCollection } from '../types/collection-changes'
import { ChangesDialog } from '../components/ChangesDialog'
import { DiscardConfirmDialog } from '../components/DiscardConfirmDialog'
import { CardContextMenu } from '../components/CardContextMenu'
import { CardSearchModal } from '../components/CardSearchModal'
import { EditorActionBar } from '../components/EditorActionBar'
import { reconcileIdPoolForUndo } from '../hooks/reconcile-undo'
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

type SaveResponse = { success: boolean; error?: string }

export function CollectionEditor() {
  const [collectionSlug, setCollectionSlug] = useState<string | null>(null)
  const [collectionList, setCollectionList] = useState<CollectionListItem[]>([])
  const [entries, setEntries] = useState<CollectionCardEntry[]>([])
  const [cards, setCards] = useState<Record<string, ScryfallCard | null>>({})
  const [printings, setPrintings] = useState<Record<string, ScryfallCard[]>>({})
  const [symbolMap, setSymbolMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalCardKey, setModalCardKey] = useState<string | null>(null)
  const [contextMenuCard, setContextMenuCard] = useState<ContextMenuState | null>(null)
  const [showChanges, setShowChanges] = useState(false)
  const [showDiscard, setShowDiscard] = useState(false)
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const currency: PriceCurrency = 'usd'

  const { changes, changeCount, addCard, removeCard, setFinish, discardAll, canUndo, undo } =
    useCollectionChanges<CollectionCardEntry>()

  const { allocate, release, claim, resetPool } = useCardIdPool()
  const originalEntriesRef = useRef<CollectionCardEntry[]>([])
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const changesRef = useRef(changes)
  changesRef.current = changes

  // Fetch collection list on mount
  useEffect(() => {
    fetch('/api/collections', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<{ collections: CollectionListItem[] }>)
      .then((data) => {
        if (data.collections) setCollectionList(data.collections)
      })
      .catch(() => setError('Failed to load collection list'))
  }, [])

  // Fetch full collection data when slug changes
  useEffect(() => {
    if (!collectionSlug) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setSaveStatus(null)

    fetch(`/api/collection/${collectionSlug}`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((r) => r.json() as Promise<CollectionDataResponse>)
      .then((data) => {
        if (controller.signal.aborted) return
        if (data.success) {
          const { entries: entriesWithIds, pool } = initializeEntriesWithIds(data.entries)
          setEntries(entriesWithIds)
          originalEntriesRef.current = entriesWithIds
          resetPool([...pool.usedIds])
          setCards(data.cards)
          setPrintings(data.printings)
          setSymbolMap(data.symbolMap)
          discardAll()
        } else {
          setError('Failed to load collection')
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return
        setError('Failed to load collection')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [collectionSlug, discardAll, resetPool, refreshKey])

  const handleCollectionSelect = useCallback((e: Event) => {
    const value = (e.target as HTMLSelectElement).value
    setCollectionSlug(value || null)
  }, [])

  const handleIncrement = useCallback(
    (entry: CollectionCardEntry) => {
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
    },
    [addCard, allocate],
  )

  const handleDecrement = useCallback(
    (entry: CollectionCardEntry) => {
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
      applyChangeToCollection(prev, {
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
      if (scryfallCard) {
        const key = `${scryfallCard.set}:${scryfallCard.collector_number}`
        setCards((prev) => ({ ...prev, [cardName]: scryfallCard, [key]: scryfallCard }))
      }
      if (allPrintings && allPrintings.length > 0) {
        setPrintings((prev) => ({ ...prev, [cardName]: allPrintings }))
        // Also key each printing by set:collectorNumber
        const cardUpdates: Record<string, ScryfallCard> = {}
        for (const p of allPrintings) {
          cardUpdates[`${p.set}:${p.collector_number}`] = p
        }
        setCards((prev) => ({ ...prev, ...cardUpdates }))
      }

      // Fetch price data from server
      try {
        const resp = await fetch(`/api/card-price?name=${encodeURIComponent(cardName)}`, {
          credentials: 'same-origin',
        })
        const data = (await resp.json()) as CardPriceResponse
        if (data.success) {
          if (!scryfallCard && data.representative) {
            setCards((prev) => ({ ...prev, [cardName]: data.representative }))
          }
          if (data.printings.length > 0) {
            setPrintings((prev) => ({ ...prev, [cardName]: data.printings }))
            const cardUpdates: Record<string, ScryfallCard> = {}
            for (const p of data.printings) {
              cardUpdates[`${p.set}:${p.collector_number}`] = p
            }
            setCards((prev) => ({ ...prev, ...cardUpdates }))
          }
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

    // Handle ID pool updates
    reconcileIdPoolForUndo(release, claim, entry)

    // Rebuild entries from original by replaying remaining changes
    let rebuilt = originalEntriesRef.current
    for (const change of remainingChanges) {
      rebuilt = applyChangeToCollection(rebuilt, change)
    }
    setEntries(rebuilt)
  }, [undo, release, claim])

  const handleSave = useCallback(async () => {
    if (!collectionSlug || entriesRef.current.length === 0 || changesRef.current.length === 0)
      return
    setSaving(true)
    setSaveStatus(null)
    try {
      const resp = await fetch(`/api/collection/${collectionSlug}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ changes: changesRef.current, entries: entriesRef.current }),
      })
      const data = (await resp.json()) as SaveResponse
      if (data.success) {
        setSaveStatus('Changes saved successfully')
        discardAll()
      } else {
        setError(data.error ?? 'Save failed')
      }
    } catch {
      setError('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }, [collectionSlug, discardAll])

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
      <h2 class="section-heading">Collection Editor</h2>

      {/* Collection selector */}
      <div class="deck-selector-container">
        <label class="deck-selector-label" for="collection-select">
          Select Collection
        </label>
        <select
          id="collection-select"
          class="deck-selector"
          value={collectionSlug ?? ''}
          onChange={handleCollectionSelect}
        >
          <option value="">— Choose a collection —</option>
          {collectionList.map(({ slug, name }) => (
            <option key={slug} value={slug}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Status messages */}
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
      {loading && <p style="color: var(--text-muted);">Loading collection...</p>}

      {/* Collection content */}
      {entries.length > 0 && collectionSlug && !loading && (
        <CollectionPage
          name={collectionList.find((c) => c.slug === collectionSlug)?.name ?? collectionSlug}
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

      {/* Context menu — no commander option for collections */}
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

      {/* Card search modal — requirePrinting forces printing/finish/condition selection */}
      <CardSearchModal
        open={showSearchModal}
        onClose={closeSearchModal}
        onAddCard={handleAddCardFromSearch}
        requirePrinting={true}
      />

      {/* Changes dialog */}
      <ChangesDialog
        open={showChanges}
        changes={changes}
        cards={cards}
        printings={printings}
        symbolMap={symbolMap}
        currency={currency}
        onClose={closeChanges}
      />

      {/* Discard confirm dialog */}
      <DiscardConfirmDialog
        open={showDiscard}
        changes={changes}
        onConfirm={handleDiscard}
        onCancel={closeDiscard}
      />

      {/* Sticky action bar */}
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
