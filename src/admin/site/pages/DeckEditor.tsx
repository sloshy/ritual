import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from 'solid-js'
import type { DeckData, Card, Finish, ScryfallCard } from '../../../types'
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
  contentHash: string
}

export function DeckEditor() {
  const [deckSlug, setDeckSlug] = createSignal<string | null>(null)
  const [deckList, setDeckList] = createSignal<DeckListItem[]>([])
  const [deckData, setDeckData] = createSignal<DeckData | null>(null)
  const [frontMatter, setFrontMatter] = createSignal<Record<string, unknown>>({})
  const [contentHash, setContentHash] = createSignal<string>('')
  const [modalCardName, setModalCardName] = createSignal<string | null>(null)
  const [contextMenuCard, setContextMenuCard] = createSignal<DeckContextMenuState | null>(null)
  const [refreshKey, setRefreshKey] = createSignal(0)

  const [status, statusActions] = useEditorStatus()
  const [cardData, cardActions] = useDeckCardData()

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
  let originalDeck: DeckData | null = null

  /** Find a card's ID from the current deck state by name and optional section hint. */
  const findCardId = (cardName: string, inCommanderSection?: boolean): number | undefined => {
    const current = deckData()
    if (!current) return undefined
    for (const section of current.sections) {
      if (inCommanderSection !== undefined) {
        const isCmd = section.name.toLowerCase().includes('commander')
        if (inCommanderSection !== isCmd) continue
      }
      const card = section.cards.find((c) => c.name === cardName)
      if (card?.cardId !== undefined) return card.cardId
    }
    return undefined
  }

  // Fetch deck list on mount
  onMount(() => {
    fetch('/api/decks', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<DeckListResponse>)
      .then((data) => {
        if (data.decks) setDeckList(data.decks)
      })
      .catch(() => statusActions.setError('Failed to load deck list'))
  })

  // Fetch full deck data when slug changes
  createEffect(
    on([deckSlug, refreshKey], ([slug]) => {
      if (!slug) return
      const controller = new AbortController()
      statusActions.loadStart()

      fetch(`/api/deck/${slug}`, { credentials: 'same-origin', signal: controller.signal })
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
            originalDeck = deckWithIds
            resetPool([...pool.usedIds])
            cardActions.load({
              cards: data.cards,
              printings: data.printings,
              lowestPriceCards: data.lowestPriceCards,
              lowestPriceCardsEur: data.lowestPriceCardsEur,
              lowestPriceCardsTix: data.lowestPriceCardsTix,
              symbolMap: data.symbolMap,
            })
            setFrontMatter(data.frontMatter)
            setContentHash(data.contentHash)
            discardAll()
            statusActions.loadSuccess()
          } else {
            statusActions.loadError('Failed to load deck')
          }
        })
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return
          statusActions.loadError('Failed to load deck')
        })

      onCleanup(() => controller.abort())
    }),
  )

  const handleDeckSelect = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value
    setDeckSlug(value || null)
  }

  const handleIncrement = (cardName: string) => {
    const cardId = findCardId(cardName)
    incrementCard(cardName, cardId)
    setDeckData((prev) =>
      prev ? applyChangeToDeck(prev, { action: 'add', cardName, cardId }) : prev,
    )
  }

  const handleDecrement = (cardName: string) => {
    const cardId = findCardId(cardName)
    const current = deckData()

    // Check if this removal will delete the line (quantity → 0)
    let removedCardData: Card | undefined
    if (current) {
      for (const section of current.sections) {
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
  }

  const handleContextMenu = (cardName: string, card: ScryfallCard | null, rect: DOMRect) => {
    const isInCommanderSection =
      deckData()?.sections.some(
        (s) =>
          s.name.toLowerCase().includes('commander') && s.cards.some((c) => c.name === cardName),
      ) ?? false
    setContextMenuCard({ cardName, card, isInCommanderSection, anchorRect: rect })
  }

  const handleSetFoil = () => {
    const menu = contextMenuCard()
    if (!menu) return
    const cardId = findCardId(menu.cardName)
    const current = deckData()
    let currentFinish: Finish = 'nonfoil'
    if (current) {
      for (const section of current.sections) {
        const card = section.cards.find((c) => c.name === menu.cardName)
        if (card?.finish) {
          currentFinish = card.finish
          break
        }
      }
    }
    const newFinish: Finish =
      currentFinish === 'foil' || currentFinish === 'etched' ? 'nonfoil' : 'foil'
    setFinish(menu.cardName, newFinish, cardId)
    setDeckData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'set-finish',
            cardName: menu.cardName,
            finish: newFinish,
            cardId,
          })
        : prev,
    )
    setContextMenuCard(null)
  }

  const handleSetCommander = () => {
    const menu = contextMenuCard()
    if (!menu) return
    const cardId = findCardId(menu.cardName, false)
    setCommander(menu.cardName, cardId)
    setDeckData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'set-commander',
            cardName: menu.cardName,
            cardId,
          })
        : prev,
    )
    setContextMenuCard(null)
  }

  const handleUnsetCommander = () => {
    const menu = contextMenuCard()
    if (!menu) return
    const cardId = findCardId(menu.cardName, true)
    unsetCommander(menu.cardName, cardId)
    setDeckData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'unset-commander',
            cardName: menu.cardName,
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
    cardActions.addCard(cardName, scryfallCard, allPrintings)

    // Fetch price data from server: checks if cache is stale (>1 day), refreshes if needed,
    // and returns computed representative/cheapest printings for all currencies.
    try {
      const resp = await fetch(`/api/card-price?name=${encodeURIComponent(cardName)}`, {
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as CardPriceResponse
      if (data.success) {
        cardActions.setPrices(
          cardName,
          data.lowestPriceCard,
          data.lowestPriceCardEur,
          data.lowestPriceCardTix,
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
    if (!result || !originalDeck) return

    const { entry, remainingChanges } = result
    reconcileIdPoolForUndo(release, claim, entry)
    setDeckData(replayChanges(originalDeck, remainingChanges, applyChangeToDeck))
  }

  const handleSave = async () => {
    const slug = deckSlug()
    if (!slug || !deckData() || changes().length === 0) return
    const result = await saveEditorChanges(
      `/api/deck/${slug}/save`,
      {
        changes: changes(),
        deck: deckData()!,
        frontMatter: frontMatter(),
        contentHash: contentHash(),
      },
      statusActions,
      discardAll,
    )
    if (result?.contentHash) {
      setContentHash(result.contentHash)
    }
  }

  const handleDiscard = () => {
    discardAll()
    if (originalDeck) {
      const ids: number[] = []
      for (const section of originalDeck.sections) {
        for (const card of section.cards) {
          if (card.cardId !== undefined) ids.push(card.cardId)
        }
      }
      resetPool(ids)
    }
    closeDiscard()
    // Increment refreshKey to trigger a re-fetch of the deck data
    setRefreshKey((k) => k + 1)
  }

  const closeModal = () => setModalCardName(null)
  const closeContextMenu = () => setContextMenuCard(null)

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
          value={deckSlug() ?? ''}
          onChange={handleDeckSelect}
        >
          <option value="">— Choose a deck —</option>
          <For each={deckList()}>{(item) => <option value={item.slug}>{item.name}</option>}</For>
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
        <p class="text-muted">Loading deck...</p>
      </Show>

      {/* Deck content */}
      <Show when={deckData() && deckSlug() && !status.loading}>
        <DeckPage
          deck={deckData()!}
          cards={cardData.cards}
          printings={cardData.printings}
          lowestPriceCards={cardData.lowestPriceCards}
          lowestPriceCardsEur={cardData.lowestPriceCardsEur}
          lowestPriceCardsTix={cardData.lowestPriceCardsTix}
          symbolMap={cardData.symbolMap}
          useScryfallImgUrls={true}
          modalCardName={modalCardName()}
          onOpenModal={setModalCardName}
          onCloseModal={closeModal}
          currency={currency}
          slug={deckSlug()!}
          editMode={true}
          onAddCard={openSearchModal}
          onCardIncrement={handleIncrement}
          onCardDecrement={handleDecrement}
          onCardContextMenu={handleContextMenu}
          unsavedChangeCount={changeCount()}
        />
      </Show>

      {/* Context menu */}
      <Show when={contextMenuCard()}>
        {(menu) => (
          <CardContextMenu
            cardName={menu().cardName}
            card={menu().card}
            currentFinish={
              deckData()
                ?.sections.flatMap((s) => s.cards)
                .find((c) => c.name === menu().cardName)?.finish
            }
            onSetFoil={handleSetFoil}
            onSetCommander={handleSetCommander}
            onUnsetCommander={handleUnsetCommander}
            isCommander={menu().isInCommanderSection}
            anchorRect={menu().anchorRect}
            onClose={closeContextMenu}
          />
        )}
      </Show>

      {/* Card search modal */}
      <CardSearchModal
        open={showSearchModal()}
        onClose={closeSearchModal}
        onAddCard={handleAddCardFromSearch}
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
      <Show when={deckData()}>
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
