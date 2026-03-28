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
  const [listList, setListList] = useState<WantedListItem[]>([])
  const [entries, setEntries] = useState<WantedListCardEntry[]>([])
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
    useCollectionChanges<WantedListCardEntry>()

  const idPool = useCardIdPool()
  const originalEntriesRef = useRef<WantedListCardEntry[]>([])

  useEffect(() => {
    fetch('/api/wanted', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<{ wantedLists: WantedListItem[] }>)
      .then((data) => {
        if (data.wantedLists) setListList(data.wantedLists)
      })
      .catch(() => setError('Failed to load wanted list list'))
  }, [])

  useEffect(() => {
    if (!listSlug) return
    setLoading(true)
    setError(null)
    setSaveStatus(null)

    fetch(`/api/wanted/${listSlug}`, { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<WantedListDataResponse>)
      .then((data) => {
        if (data.success) {
          const { entries: entriesWithIds, pool } = initializeEntriesWithIds(data.entries)

          setEntries(entriesWithIds)
          originalEntriesRef.current = entriesWithIds
          idPool.resetPool([...pool.usedIds])
          setCards(data.cards)
          setPrintings(data.printings)
          setSymbolMap(data.symbolMap)
          discardAll()
        } else {
          setError('Failed to load wanted list')
        }
      })
      .catch(() => setError('Failed to load wanted list'))
      .finally(() => setLoading(false))
  }, [listSlug, discardAll, refreshKey])

  const handleListSelect = useCallback((e: Event) => {
    const value = (e.target as HTMLSelectElement).value
    setListSlug(value || null)
  }, [])

  const handleIncrement = useCallback(
    (entry: WantedListCardEntry) => {
      const cardId = idPool.allocate()
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
    [addCard, idPool],
  )

  const handleDecrement = useCallback(
    (entry: WantedListCardEntry) => {
      if (entry.cardId !== undefined) {
        idPool.release(entry.cardId)
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
    [removeCard, idPool],
  )

  const handleContextMenu = useCallback(
    (cardName: string, card: ScryfallCard | null, rect: DOMRect) => {
      setContextMenuCard({ cardName, card, anchorRect: rect })
    },
    [],
  )

  const handleSetFoil = useCallback(() => {
    if (!contextMenuCard) return
    const entry = entries.find((e) => e.name === contextMenuCard.cardName)
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
  }, [contextMenuCard, setFinish, entries])

  const handleAddCardFromSearch = useCallback(
    async (
      cardName: string,
      options?: CardPrintingOptions,
      scryfallCard?: ScryfallCard,
      allPrintings?: ScryfallCard[],
    ) => {
      const cardId = idPool.allocate()
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
      if (scryfallCard) {
        const key = `${scryfallCard.set}:${scryfallCard.collector_number}`
        setCards((prev) => ({ ...prev, [cardName]: scryfallCard, [key]: scryfallCard }))
      }
      if (allPrintings && allPrintings.length > 0) {
        setPrintings((prev) => ({ ...prev, [cardName]: allPrintings }))
        const cardUpdates: Record<string, ScryfallCard> = {}
        for (const p of allPrintings) {
          cardUpdates[`${p.set}:${p.collector_number}`] = p
        }
        setCards((prev) => ({ ...prev, ...cardUpdates }))
      }

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
    [addCard, idPool],
  )

  const handleUndo = useCallback(() => {
    const result = undo()
    if (!result) return

    const { entry, remainingChanges } = result

    reconcileIdPoolForUndo(idPool, entry)

    let rebuilt = originalEntriesRef.current
    for (const change of remainingChanges) {
      rebuilt = applyChangeToWantedList(rebuilt, change)
    }
    setEntries(rebuilt)
  }, [undo, idPool])

  const handleSave = useCallback(async () => {
    if (!listSlug || entries.length === 0 || changeCount === 0) return
    setSaving(true)
    setSaveStatus(null)
    try {
      const resp = await fetch(`/api/wanted/${listSlug}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ changes, entries }),
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
  }, [listSlug, entries, changeCount, changes, discardAll])

  const handleDiscard = useCallback(() => {
    discardAll()
    const ids = originalEntriesRef.current
      .map((e) => e.cardId)
      .filter((id): id is number => id !== undefined)
    idPool.resetPool(ids)
    setShowDiscard(false)
    setRefreshKey((k) => k + 1)
  }, [discardAll, idPool])

  return (
    <div>
      <h2 class="section-heading">Wanted List Editor</h2>

      <div class="deck-selector-container">
        <label class="deck-selector-label">Select Wanted List</label>
        <select class="deck-selector" value={listSlug ?? ''} onChange={handleListSelect}>
          <option value="">— Choose a wanted list —</option>
          {listList.map(({ slug, name }) => (
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
          name={listList.find((c) => c.slug === listSlug)?.name ?? listSlug}
          entries={entries}
          cards={cards}
          printings={printings}
          symbolMap={symbolMap}
          useScryfallImgUrls={true}
          totalPrice={0}
          modalCardKey={modalCardKey}
          onOpenModal={setModalCardKey}
          onCloseModal={() => setModalCardKey(null)}
          currency={currency}
          editMode={true}
          onAddCard={() => setShowSearchModal(true)}
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
          onUnsetCommander={() => setContextMenuCard(null)}
          anchorRect={contextMenuCard.anchorRect}
          onClose={() => setContextMenuCard(null)}
          hideCommander={true}
        />
      )}

      <CardSearchModal
        open={showSearchModal}
        onClose={() => setShowSearchModal(false)}
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
        onClose={() => setShowChanges(false)}
      />

      <DiscardConfirmDialog
        open={showDiscard}
        changes={changes}
        onConfirm={handleDiscard}
        onCancel={() => setShowDiscard(false)}
      />

      {entries.length > 0 && (
        <EditorActionBar
          changeCount={changeCount}
          canUndo={canUndo}
          saving={saving}
          onShowChanges={() => setShowChanges(true)}
          onUndo={handleUndo}
          onSave={handleSave}
          onDiscard={() => setShowDiscard(true)}
        />
      )}
    </div>
  )
}
