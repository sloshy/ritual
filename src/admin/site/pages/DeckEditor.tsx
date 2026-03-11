import { useState, useEffect, useCallback } from 'preact/hooks'
import type { DeckData, ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import type { ChangeEvent, CardPrintingOptions } from '../types/deck-changes'
import type { CardPriceResponse } from '../../api/card-price'
import { DeckPage } from '../../../site/DeckPage'
import { useDeckChanges } from '../hooks/useDeckChanges'
import { ChangesDialog } from '../components/ChangesDialog'
import { DiscardConfirmDialog } from '../components/DiscardConfirmDialog'
import { CardContextMenu } from '../components/CardContextMenu'
import { CardSearchModal } from '../components/CardSearchModal'

type DeckListItem = { slug: string; name: string }

type ContextMenuState = {
  cardName: string
  card: ScryfallCard | null
}

/** The subset of ChangeEvent fields that applyChangeToDeck actually needs. */
type ChangeInput = Omit<ChangeEvent, 'id' | 'timestamp'>

function applyChangeToDeck(deck: DeckData, change: ChangeInput): DeckData {
  const sections = deck.sections.map((s) => ({
    ...s,
    cards: s.cards.map((c) => ({ ...c })),
  }))

  const isCommander = (name: string) => name.toLowerCase().includes('commander')
  const isSideboard = (name: string) => name.toLowerCase().includes('sideboard')

  switch (change.action) {
    case 'add': {
      // Find existing card in any section and increment, or add to first main section
      for (const section of sections) {
        const existing = section.cards.find((c) => c.name === change.cardName)
        if (existing) {
          existing.quantity += 1
          return { ...deck, sections }
        }
      }

      // No existing entry — add to first non-commander, non-sideboard section
      let targetSection = sections.find((s) => !isCommander(s.name) && !isSideboard(s.name))
      if (!targetSection) {
        targetSection = { name: 'Main', cards: [] }
        sections.push(targetSection)
      }
      targetSection.cards.push({
        quantity: 1,
        name: change.cardName,
        set: change.set,
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        condition: change.condition,
      })
      return { ...deck, sections }
    }

    case 'remove': {
      for (const section of sections) {
        const idx = section.cards.findIndex((c) => c.name === change.cardName)
        if (idx !== -1) {
          const card = section.cards[idx]
          if (card) {
            card.quantity -= 1
            if (card.quantity <= 0) {
              section.cards.splice(idx, 1)
            }
          }
          return { ...deck, sections }
        }
      }
      return { ...deck, sections }
    }

    case 'set-commander': {
      // Find or create Commander section
      let commanderSection = sections.find((s) => isCommander(s.name))
      if (!commanderSection) {
        commanderSection = { name: 'Commander', cards: [] }
        sections.unshift(commanderSection)
      }

      // Remove card from its current section
      for (const section of sections) {
        const idx = section.cards.findIndex((c) => c.name === change.cardName)
        if (idx !== -1 && section !== commanderSection) {
          const [removed] = section.cards.splice(idx, 1)
          if (removed) {
            commanderSection.cards.push(removed)
          }
          return { ...deck, sections }
        }
      }

      // Card already in commander section or not found
      return { ...deck, sections }
    }

    case 'set-finish': {
      for (const section of sections) {
        const card = section.cards.find((c) => c.name === change.cardName)
        if (card) {
          card.finish = change.finish
          return { ...deck, sections }
        }
      }
      return { ...deck, sections }
    }
  }
}

export function DeckEditor() {
  const [deckSlug, setDeckSlug] = useState<string | null>(null)
  const [deckList, setDeckList] = useState<DeckListItem[]>([])
  const [deckData, setDeckData] = useState<DeckData | null>(null)
  const [frontMatter, setFrontMatter] = useState<Record<string, unknown>>({})
  const [cards, setCards] = useState<Record<string, ScryfallCard | null>>({})
  const [printings, setPrintings] = useState<Record<string, ScryfallCard[]>>({})
  const [lowestPriceCards, setLowestPriceCards] = useState<Record<string, ScryfallCard | null>>({})
  const [lowestPriceCardsEur, setLowestPriceCardsEur] = useState<
    Record<string, ScryfallCard | null>
  >({})
  const [lowestPriceCardsTix, setLowestPriceCardsTix] = useState<
    Record<string, ScryfallCard | null>
  >({})
  const [symbolMap, setSymbolMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalCardName, setModalCardName] = useState<string | null>(null)
  const [contextMenuCard, setContextMenuCard] = useState<ContextMenuState | null>(null)
  const [showChanges, setShowChanges] = useState(false)
  const [showDiscard, setShowDiscard] = useState(false)
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const currency: PriceCurrency = 'usd'

  const {
    changes,
    changeCount,
    addCard,
    incrementCard,
    decrementCard,
    setCommander,
    setFinish,
    discardAll,
  } = useDeckChanges()

  // Fetch deck list on mount
  useEffect(() => {
    fetch('/api/decks', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<{ decks: DeckListItem[] }>)
      .then((data) => {
        if (data.decks) setDeckList(data.decks)
      })
      .catch(() => setError('Failed to load deck list'))
  }, [])

  // Fetch full deck data when slug changes
  useEffect(() => {
    if (!deckSlug) return
    setLoading(true)
    setError(null)
    setSaveStatus(null)

    fetch(`/api/deck/${deckSlug}`, { credentials: 'same-origin' })
      .then(
        (r) =>
          r.json() as Promise<{
            success: boolean
            deck: DeckData
            cards: Record<string, ScryfallCard | null>
            printings: Record<string, ScryfallCard[]>
            lowestPriceCards: Record<string, ScryfallCard | null>
            lowestPriceCardsEur: Record<string, ScryfallCard | null>
            lowestPriceCardsTix: Record<string, ScryfallCard | null>
            symbolMap: Record<string, string>
            frontMatter: Record<string, unknown>
            slug: string
          }>,
      )
      .then((data) => {
        if (data.success) {
          setDeckData(data.deck)
          setCards(data.cards)
          setPrintings(data.printings)
          setLowestPriceCards(data.lowestPriceCards)
          setLowestPriceCardsEur(data.lowestPriceCardsEur)
          setLowestPriceCardsTix(data.lowestPriceCardsTix)
          setSymbolMap(data.symbolMap)
          setFrontMatter(data.frontMatter)
          discardAll()
        } else {
          setError('Failed to load deck')
        }
      })
      .catch(() => setError('Failed to load deck'))
      .finally(() => setLoading(false))
  }, [deckSlug, discardAll, refreshKey])

  const handleDeckSelect = useCallback((e: Event) => {
    const value = (e.target as HTMLSelectElement).value
    setDeckSlug(value || null)
  }, [])

  const handleIncrement = useCallback(
    (cardName: string) => {
      incrementCard(cardName)
      setDeckData((prev) => (prev ? applyChangeToDeck(prev, { action: 'add', cardName }) : prev))
    },
    [incrementCard],
  )

  const handleDecrement = useCallback(
    (cardName: string) => {
      decrementCard(cardName)
      setDeckData((prev) => (prev ? applyChangeToDeck(prev, { action: 'remove', cardName }) : prev))
    },
    [decrementCard],
  )

  const handleContextMenu = useCallback((cardName: string, card: ScryfallCard | null) => {
    setContextMenuCard({ cardName, card })
  }, [])

  const handleSetFoil = useCallback(() => {
    if (!contextMenuCard) return
    setFinish(contextMenuCard.cardName, 'foil')
    setDeckData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'set-finish',
            cardName: contextMenuCard.cardName,
            finish: 'foil',
          })
        : prev,
    )
    setContextMenuCard(null)
  }, [contextMenuCard, setFinish])

  const handleSetCommander = useCallback(() => {
    if (!contextMenuCard) return
    setCommander(contextMenuCard.cardName)
    setDeckData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'set-commander',
            cardName: contextMenuCard.cardName,
          })
        : prev,
    )
    setContextMenuCard(null)
  }, [contextMenuCard, setCommander])

  const handleAddCardFromSearch = useCallback(
    async (
      cardName: string,
      options?: CardPrintingOptions,
      scryfallCard?: ScryfallCard,
      allPrintings?: ScryfallCard[],
    ) => {
      addCard(cardName, options)
      setDeckData((prev) =>
        prev
          ? applyChangeToDeck(prev, {
              action: 'add',
              cardName,
              set: options?.set,
              collectorNumber: options?.collectorNumber,
              finish: options?.finish,
              condition: options?.condition,
            })
          : prev,
      )
      if (scryfallCard) {
        setCards((prev) => ({ ...prev, [cardName]: scryfallCard }))
        // Use selected printing as immediate fallback so the card is visible in lowest price view
        // before the server responds with the actual cheapest printing.
        setLowestPriceCards((prev) => ({ ...prev, [cardName]: scryfallCard }))
        setLowestPriceCardsEur((prev) => ({ ...prev, [cardName]: scryfallCard }))
        setLowestPriceCardsTix((prev) => ({ ...prev, [cardName]: scryfallCard }))
      }
      if (allPrintings && allPrintings.length > 0) {
        setPrintings((prev) => ({ ...prev, [cardName]: allPrintings }))
      }

      // Fetch price data from server: checks if cache is stale (>1 day), refreshes if needed,
      // and returns computed representative/cheapest printings for all currencies.
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
          }
          setLowestPriceCards((prev) => ({ ...prev, [cardName]: data.lowestPriceCard }))
          setLowestPriceCardsEur((prev) => ({ ...prev, [cardName]: data.lowestPriceCardEur }))
          setLowestPriceCardsTix((prev) => ({ ...prev, [cardName]: data.lowestPriceCardTix }))
        }
      } catch {
        // Price fetch failure doesn't block adding the card
      }
    },
    [addCard],
  )

  const handleSave = useCallback(async () => {
    if (!deckSlug || !deckData || changeCount === 0) return
    setSaving(true)
    setSaveStatus(null)
    try {
      const resp = await fetch(`/api/deck/${deckSlug}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        // `deckData` is the raw structural deck (sections, card names, quantities) and is never
        // mutated by the lowest price toggle, which is a view-only display concern inside DeckPage.
        body: JSON.stringify({ changes, deck: deckData, frontMatter }),
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
  }, [deckSlug, deckData, changeCount, changes, frontMatter, discardAll])

  const handleDiscard = useCallback(() => {
    discardAll()
    setShowDiscard(false)
    // Increment refreshKey to trigger a re-fetch of the deck data
    setRefreshKey((k) => k + 1)
  }, [discardAll])

  return (
    <div>
      <h2 class="section-heading">Deck Editor</h2>

      {/* Deck selector */}
      <div class="deck-selector-container">
        <label class="deck-selector-label">Select Deck</label>
        <select class="deck-selector" value={deckSlug ?? ''} onChange={handleDeckSelect}>
          <option value="">— Choose a deck —</option>
          {deckList.map(({ slug, name }) => (
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
      {loading && <p style="color: var(--text-muted);">Loading deck...</p>}

      {/* Deck content */}
      {deckData && deckSlug && !loading && (
        <DeckPage
          deck={deckData}
          cards={cards}
          printings={printings}
          lowestPriceCards={lowestPriceCards}
          lowestPriceCardsEur={lowestPriceCardsEur}
          lowestPriceCardsTix={lowestPriceCardsTix}
          symbolMap={symbolMap}
          useScryfallImgUrls={true}
          modalCardName={modalCardName}
          onOpenModal={setModalCardName}
          onCloseModal={() => setModalCardName(null)}
          currency={currency}
          slug={deckSlug}
          editMode={true}
          onAddCard={() => setShowSearchModal(true)}
          onCardIncrement={handleIncrement}
          onCardDecrement={handleDecrement}
          onCardContextMenu={handleContextMenu}
          unsavedChangeCount={changeCount}
        />
      )}

      {/* Context menu */}
      {contextMenuCard && (
        <CardContextMenu
          cardName={contextMenuCard.cardName}
          card={contextMenuCard.card}
          onSetFoil={handleSetFoil}
          onSetCommander={handleSetCommander}
          onClose={() => setContextMenuCard(null)}
        />
      )}

      {/* Card search modal */}
      <CardSearchModal
        open={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        onAddCard={handleAddCardFromSearch}
      />

      {/* Changes dialog */}
      <ChangesDialog
        open={showChanges}
        changes={changes}
        cards={cards}
        printings={printings}
        symbolMap={symbolMap}
        currency={currency}
        onClose={() => setShowChanges(false)}
      />

      {/* Discard confirm dialog */}
      <DiscardConfirmDialog
        open={showDiscard}
        changes={changes}
        onConfirm={handleDiscard}
        onCancel={() => setShowDiscard(false)}
      />

      {/* Sticky action bar */}
      {deckData && (
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
