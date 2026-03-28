import { useState, useEffect, useCallback } from 'preact/hooks'
import type { ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import type { CardPrintingOptions } from '../types/deck-changes'
import type { WantedListCardEntry } from '../../../site/data-types'
import type { CardPriceResponse } from '../../api/card-price'
import type { ContextMenuState } from '../types/context-menu'
import { WantedListPage } from '../../../site/WantedListPage'
import { useCollectionChanges } from '../hooks/useCollectionChanges'
import { applyChangeToWantedList } from '../types/wanted-changes'
import { ChangesDialog } from '../components/ChangesDialog'
import { DiscardConfirmDialog } from '../components/DiscardConfirmDialog'
import { CardContextMenu } from '../components/CardContextMenu'
import { CardSearchModal } from '../components/CardSearchModal'

type WantedListItem = { slug: string; name: string }

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

  const { changes, changeCount, addCard, removeCard, setFinish, discardAll } =
    useCollectionChanges()

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
      .then(
        (r) =>
          r.json() as Promise<{
            success: boolean
            entries: WantedListCardEntry[]
            cards: Record<string, ScryfallCard | null>
            printings: Record<string, ScryfallCard[]>
            symbolMap: Record<string, string>
            slug: string
          }>,
      )
      .then((data) => {
        if (data.success) {
          setEntries(data.entries.map((e, i) => ({ ...e, fileOrder: i })))
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
      addCard(entry.name, {
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
      })
      setEntries((prev) =>
        applyChangeToWantedList(prev, {
          action: 'add',
          cardName: entry.name,
          set: entry.set,
          collectorNumber: entry.collectorNumber,
          finish: entry.finish,
        }),
      )
    },
    [addCard],
  )

  const handleDecrement = useCallback(
    (entry: WantedListCardEntry) => {
      removeCard(entry.name, {
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
      })
      setEntries((prev) =>
        applyChangeToWantedList(prev, {
          action: 'remove',
          cardName: entry.name,
          set: entry.set,
          collectorNumber: entry.collectorNumber,
          fileOrder: entry.fileOrder,
        }),
      )
    },
    [removeCard],
  )

  const handleContextMenu = useCallback(
    (cardName: string, card: ScryfallCard | null, rect: DOMRect) => {
      setContextMenuCard({ cardName, card, anchorRect: rect })
    },
    [],
  )

  const handleSetFoil = useCallback(() => {
    if (!contextMenuCard) return
    setFinish(contextMenuCard.cardName, 'foil')
    setEntries((prev) =>
      applyChangeToWantedList(prev, {
        action: 'set-finish',
        cardName: contextMenuCard.cardName,
        finish: 'foil',
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
      addCard(cardName, options)
      setEntries((prev) =>
        applyChangeToWantedList(prev, {
          action: 'add',
          cardName,
          set: options?.set,
          collectorNumber: options?.collectorNumber,
          finish: options?.finish,
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
    [addCard],
  )

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
      const data = (await resp.json()) as { success: boolean; error?: string }
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
    setShowDiscard(false)
    setRefreshKey((k) => k + 1)
  }, [discardAll])

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
        <div class="editor-action-bar">
          <button class="btn-changes" onClick={() => setShowChanges(true)}>
            Changes
            {changeCount > 0 && <span class="changes-badge">{changeCount}</span>}
          </button>
          <button class="btn-save" disabled={changeCount === 0 || saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            class="btn-discard"
            disabled={changeCount === 0}
            onClick={() => setShowDiscard(true)}
          >
            Discard Changes
          </button>
        </div>
      )}
    </div>
  )
}
