import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import type { DeckData, Card, ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import type { CardPrintingOptions } from '../types/deck-changes'
import type { CardPriceResponse } from '../../api/card-price'
import type { ContextMenuState } from '../types/context-menu'
import { DeckPage } from '../../../site/DeckPage'
import { useEditorStatus } from '../hooks/useEditorStatus'
import { useDeckCardData } from '../hooks/useDeckCardData'
import { useDialogState } from '../hooks/useDialogState'
import { useDeckChanges } from '../hooks/useDeckChanges'
import { useCardIdPool } from '../hooks/useCardIdPool'
import { applyChangeToDeck } from '../types/deck-changes'
import { ChangesDialog } from '../components/ChangesDialog'
import { DiscardConfirmDialog } from '../components/DiscardConfirmDialog'
import { CardContextMenu } from '../components/CardContextMenu'
import { CardSearchModal } from '../components/CardSearchModal'
import { EditorActionBar } from '../components/EditorActionBar'
import { reconcileIdPoolForUndo, replayChanges } from '../hooks/reconcile-undo'
import { saveEditorChanges } from '../hooks/saveEditorChanges'
import { initializePoolFromEntries } from '../../../card-id'

type DeckListItem = { slug: string; name: string }

type DeckContextMenuState = ContextMenuState & {
  isInCommanderSection: boolean
}

type DeckListResponse = { decks: DeckListItem[] }

type DeckDataResponse = {
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
}

export function DeckEditor() {
  const [deckSlug, setDeckSlug] = useState<string | null>(null)
  const [deckList, setDeckList] = useState<DeckListItem[]>([])
  const [deckData, setDeckData] = useState<DeckData | null>(null)
  const [frontMatter, setFrontMatter] = useState<Record<string, unknown>>({})
  const [modalCardName, setModalCardName] = useState<string | null>(null)
  const [contextMenuCard, setContextMenuCard] = useState<DeckContextMenuState | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [status, statusDispatch] = useEditorStatus()
  const { loading, error, saving, saveStatus } = status

  const [cardData, cardDispatch] = useDeckCardData()
  const {
    cards,
    printings,
    lowestPriceCards,
    lowestPriceCardsEur,
    lowestPriceCardsTix,
    symbolMap,
  } = cardData

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

  const {
    changes,
    changeCount,
    addCard,
    incrementCard,
    decrementCard,
    setCommander,
    unsetCommander,
    setFinish,
    discardAll,
    canUndo,
    undo,
  } = useDeckChanges<Card>()

  const { allocate, release, resetPool, claim } = useCardIdPool()
  const originalDeckRef = useRef<DeckData | null>(null)

  const deckDataRef = useRef(deckData)
  deckDataRef.current = deckData

  const changesRef = useRef(changes)
  changesRef.current = changes
  const frontMatterRef = useRef(frontMatter)
  frontMatterRef.current = frontMatter

  /** Find a card's ID from the current deck state by name and optional section hint. */
  const findCardId = useCallback(
    (cardName: string, inCommanderSection?: boolean): number | undefined => {
      if (!deckDataRef.current) return undefined
      for (const section of deckDataRef.current.sections) {
        if (inCommanderSection !== undefined) {
          const isCmd = section.name.toLowerCase().includes('commander')
          if (inCommanderSection !== isCmd) continue
        }
        const card = section.cards.find((c) => c.name === cardName)
        if (card?.cardId !== undefined) return card.cardId
      }
      return undefined
    },
    [],
  )

  // Fetch deck list on mount
  useEffect(() => {
    fetch('/api/decks', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<DeckListResponse>)
      .then((data) => {
        if (data.decks) setDeckList(data.decks)
      })
      .catch(() => statusDispatch({ type: 'SET_ERROR', error: 'Failed to load deck list' }))
  }, [])

  // Fetch full deck data when slug changes
  useEffect(() => {
    if (!deckSlug) return
    const controller = new AbortController()
    statusDispatch({ type: 'LOAD_START' })

    fetch(`/api/deck/${deckSlug}`, { credentials: 'same-origin', signal: controller.signal })
      .then((r) => r.json() as Promise<DeckDataResponse>)
      .then((data) => {
        if (controller.signal.aborted) return
        if (data.success) {
          // Initialize card ID pool from loaded deck data
          const allCards: Card[] = []
          for (const section of data.deck.sections) {
            for (const card of section.cards) {
              allCards.push(card)
            }
          }
          const existingIds = allCards.map((c) => c.cardId)
          const { pool, assignedIds } = initializePoolFromEntries(allCards.length, existingIds)

          // Assign IDs back to cards
          let idx = 0
          const deckWithIds: DeckData = {
            ...data.deck,
            sections: data.deck.sections.map((s) => ({
              ...s,
              cards: s.cards.map((c) => {
                const cardId = assignedIds[idx++]!
                return { ...c, cardId }
              }),
            })),
          }

          setDeckData(deckWithIds)
          originalDeckRef.current = deckWithIds
          resetPool([...pool.usedIds])
          cardDispatch({
            type: 'LOAD',
            data: {
              cards: data.cards,
              printings: data.printings,
              lowestPriceCards: data.lowestPriceCards,
              lowestPriceCardsEur: data.lowestPriceCardsEur,
              lowestPriceCardsTix: data.lowestPriceCardsTix,
              symbolMap: data.symbolMap,
            },
          })
          setFrontMatter(data.frontMatter)
          discardAll()
          statusDispatch({ type: 'LOAD_SUCCESS' })
        } else {
          statusDispatch({ type: 'LOAD_ERROR', error: 'Failed to load deck' })
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return
        statusDispatch({ type: 'LOAD_ERROR', error: 'Failed to load deck' })
      })

    return () => controller.abort()
  }, [deckSlug, discardAll, resetPool, refreshKey, statusDispatch, cardDispatch])

  const handleDeckSelect = useCallback((e: Event) => {
    const value = (e.target as HTMLSelectElement).value
    setDeckSlug(value || null)
  }, [])

  const handleIncrement = useCallback(
    (cardName: string) => {
      const cardId = findCardId(cardName)
      incrementCard(cardName, cardId)
      setDeckData((prev) =>
        prev ? applyChangeToDeck(prev, { action: 'add', cardName, cardId }) : prev,
      )
    },
    [incrementCard, findCardId],
  )

  const handleDecrement = useCallback(
    (cardName: string) => {
      const cardId = findCardId(cardName)

      // Check if this removal will delete the line (quantity → 0)
      let removedCardData: Card | undefined
      if (deckDataRef.current) {
        for (const section of deckDataRef.current.sections) {
          const card = section.cards.find((c) => c.name === cardName)
          if (card && card.quantity <= 1 && card.cardId !== undefined) {
            removedCardData = { ...card }
            release(card.cardId)
            break
          }
        }
      }

      decrementCard(cardName, cardId, removedCardData)
      setDeckData((prev) =>
        prev ? applyChangeToDeck(prev, { action: 'remove', cardName, cardId }) : prev,
      )
    },
    [decrementCard, findCardId, release],
  )

  const handleContextMenu = useCallback(
    (cardName: string, card: ScryfallCard | null, rect: DOMRect) => {
      const isInCommanderSection =
        deckDataRef.current?.sections.some(
          (s) =>
            s.name.toLowerCase().includes('commander') && s.cards.some((c) => c.name === cardName),
        ) ?? false
      setContextMenuCard({ cardName, card, isInCommanderSection, anchorRect: rect })
    },
    [],
  )

  const handleSetFoil = useCallback(() => {
    if (!contextMenuCard) return
    const cardId = findCardId(contextMenuCard.cardName)
    setFinish(contextMenuCard.cardName, 'foil', cardId)
    setDeckData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'set-finish',
            cardName: contextMenuCard.cardName,
            finish: 'foil',
            cardId,
          })
        : prev,
    )
    setContextMenuCard(null)
  }, [contextMenuCard, setFinish, findCardId])

  const handleSetCommander = useCallback(() => {
    if (!contextMenuCard) return
    const cardId = findCardId(contextMenuCard.cardName, false)
    setCommander(contextMenuCard.cardName, cardId)
    setDeckData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'set-commander',
            cardName: contextMenuCard.cardName,
            cardId,
          })
        : prev,
    )
    setContextMenuCard(null)
  }, [contextMenuCard, setCommander, findCardId])

  const handleUnsetCommander = useCallback(() => {
    if (!contextMenuCard) return
    const cardId = findCardId(contextMenuCard.cardName, true)
    unsetCommander(contextMenuCard.cardName, cardId)
    setDeckData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'unset-commander',
            cardName: contextMenuCard.cardName,
            cardId,
          })
        : prev,
    )
    setContextMenuCard(null)
  }, [contextMenuCard, unsetCommander, findCardId])

  const handleAddCardFromSearch = useCallback(
    async (
      cardName: string,
      options?: CardPrintingOptions,
      scryfallCard?: ScryfallCard,
      allPrintings?: ScryfallCard[],
    ) => {
      const cardId = allocate()
      addCard(cardName, { ...options, cardId })
      setDeckData((prev) =>
        prev
          ? applyChangeToDeck(prev, {
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
      cardDispatch({
        type: 'ADD_CARD',
        cardName,
        card: scryfallCard,
        printings: allPrintings,
      })

      // Fetch price data from server: checks if cache is stale (>1 day), refreshes if needed,
      // and returns computed representative/cheapest printings for all currencies.
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
            lowestPriceCard: data.lowestPriceCard,
            lowestPriceCardEur: data.lowestPriceCardEur,
            lowestPriceCardTix: data.lowestPriceCardTix,
          })
        }
      } catch {
        // Price fetch failure doesn't block adding the card
      }
    },
    [addCard, allocate, cardDispatch],
  )

  const handleUndo = useCallback(() => {
    const result = undo()
    if (!result || !originalDeckRef.current) return

    const { entry, remainingChanges } = result
    reconcileIdPoolForUndo(release, claim, entry)
    setDeckData(replayChanges(originalDeckRef.current, remainingChanges, applyChangeToDeck))
  }, [undo, release, claim])

  const handleSave = useCallback(async () => {
    if (!deckSlug || !deckDataRef.current || changesRef.current.length === 0) return
    await saveEditorChanges(
      `/api/deck/${deckSlug}/save`,
      {
        changes: changesRef.current,
        deck: deckDataRef.current,
        frontMatter: frontMatterRef.current,
      },
      statusDispatch,
      discardAll,
    )
  }, [deckSlug, discardAll, statusDispatch])

  const handleDiscard = useCallback(() => {
    discardAll()
    if (originalDeckRef.current) {
      const ids: number[] = []
      for (const section of originalDeckRef.current.sections) {
        for (const card of section.cards) {
          if (card.cardId !== undefined) ids.push(card.cardId)
        }
      }
      resetPool(ids)
    }
    closeDiscard()
    // Increment refreshKey to trigger a re-fetch of the deck data
    setRefreshKey((k) => k + 1)
  }, [discardAll, resetPool, closeDiscard])

  const closeModal = useCallback(() => setModalCardName(null), [])
  const closeContextMenu = useCallback(() => setContextMenuCard(null), [])

  return (
    <div>
      <h2 class="section-heading">Deck Editor</h2>

      {/* Deck selector */}
      <div class="deck-selector-container">
        <label class="deck-selector-label" for="deck-select">
          Select Deck
        </label>
        <select
          id="deck-select"
          class="deck-selector"
          value={deckSlug ?? ''}
          onChange={handleDeckSelect}
        >
          <option value="">— Choose a deck —</option>
          {deckList.map(({ slug, name }) => (
            <option key={slug} value={slug}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Status messages */}
      {error && <div class="alert alert-error">{error}</div>}
      {saveStatus && <div class="alert alert-success">{saveStatus}</div>}
      {loading && <p class="text-muted">Loading deck...</p>}

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
          onCloseModal={closeModal}
          currency={currency}
          slug={deckSlug}
          editMode={true}
          onAddCard={openSearchModal}
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
          onUnsetCommander={handleUnsetCommander}
          isCommander={contextMenuCard.isInCommanderSection}
          anchorRect={contextMenuCard.anchorRect}
          onClose={closeContextMenu}
        />
      )}

      {/* Card search modal */}
      <CardSearchModal
        open={showSearchModal}
        onClose={closeSearchModal}
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
      {deckData && (
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
