import { createSignal, Show } from 'solid-js'
import type { DeckData, Card, Finish, ScryfallCard } from '../../../types'
import type { ContextMenuState } from '../types/context-menu'
import type { CardPriceResponse } from '../../api/card-price'
import type { EditorConfig } from '../hooks/useEditor'
import { DeckPage } from '../../../site/DeckPage'
import { useDeckCardData } from '../hooks/useDeckCardData'
import { useEditor } from '../hooks/useEditor'
import { applyChangeToDeck } from '../types/deck-changes'
import { CardContextMenu } from '../components/CardContextMenu'
import { EditorShell } from '../components/EditorShell'
import { initializePoolFromEntries } from '../../../card-id'

type DeckListResponse = { decks?: { slug: string; name: string }[] }

type DeckContextMenuState = ContextMenuState & {
  isInCommanderSection: boolean
}

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

/** Find a card's finish by iterating deck sections. */
function findDeckFinish(deck: DeckData, cardName: string): Finish {
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.name === cardName)
    if (card?.finish) return card.finish
  }
  return 'nonfoil'
}

/** Find the original finish for a card, falling back to 'nonfoil'. */
function findOriginalDeckFinish(deck: DeckData, cardName: string): Finish {
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.name === cardName)
    if (card !== undefined) return card.finish ?? 'nonfoil'
  }
  return 'nonfoil'
}

/** Find a card's ID from deck sections by name. */
function findDeckCardId(deck: DeckData, cardName: string): number | undefined {
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.name === cardName)
    if (card?.cardId !== undefined) return card.cardId
  }
  return undefined
}

/** Find a card's ID with an optional section filter (commander vs non-commander). */
function findDeckCardIdInSection(
  deck: DeckData,
  cardName: string,
  inCommanderSection: boolean,
): number | undefined {
  for (const section of deck.sections) {
    const isCmd = section.name.toLowerCase().includes('commander')
    if (inCommanderSection !== isCmd) continue
    const card = section.cards.find((c) => c.name === cardName)
    if (card?.cardId !== undefined) return card.cardId
  }
  return undefined
}

/** Extract all card IDs from a deck. */
function getDeckCardIds(deck: DeckData): number[] {
  const ids: number[] = []
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (card.cardId !== undefined) ids.push(card.cardId)
    }
  }
  return ids
}

export function DeckEditor() {
  const [cardData, cardActions] = useDeckCardData()
  const [modalCardName, setModalCardName] = createSignal<string | null>(null)
  const [deckContextMenu, setDeckContextMenu] = createSignal<DeckContextMenuState | null>(null)

  const config: EditorConfig<DeckData> = {
    listEndpoint: '/api/decks',
    extractListItems: (r) => (r as DeckListResponse).decks ?? [],
    dataEndpoint: (slug) => `/api/deck/${slug}`,
    saveEndpoint: (slug) => `/api/deck/${slug}/save`,
    entityLabel: 'deck',

    processLoadResponse: (response) => {
      const r = response as DeckDataResponse
      if (!r.success) return null
      const allCards: Card[] = []
      for (const section of r.deck.sections) {
        for (const card of section.cards) {
          allCards.push(card)
        }
      }
      const existingIds = allCards.map((c) => c.cardId)
      const { pool, assignedIds } = initializePoolFromEntries(allCards.length, existingIds)
      let idx = 0
      const deckWithIds: DeckData = {
        ...r.deck,
        sections: r.deck.sections.map((s) => ({
          ...s,
          cards: s.cards.map((c) => {
            const cardId = assignedIds[idx++]!
            return { ...c, cardId }
          }),
        })),
      }
      return {
        data: deckWithIds,
        poolIds: [...pool.usedIds],
        contentHash: r.contentHash,
        extra: { frontMatter: r.frontMatter },
      }
    },

    loadCardData: (response) => {
      const r = response as DeckDataResponse
      cardActions.load({
        cards: r.cards,
        printings: r.printings,
        lowestPriceCards: r.lowestPriceCards,
        lowestPriceCardsEur: r.lowestPriceCardsEur,
        lowestPriceCardsTix: r.lowestPriceCardsTix,
        symbolMap: r.symbolMap,
      })
    },
    addCardData: (cardName, card, printings) => cardActions.addCard(cardName, card, printings),
    handlePriceResponse: (cardName, data: CardPriceResponse, hadCard) => {
      cardActions.setPrices(
        cardName,
        data.lowestPriceCard,
        data.lowestPriceCardEur,
        data.lowestPriceCardTix,
        !hadCard ? (data.representative ?? undefined) : undefined,
        data.printings.length > 0 ? data.printings : undefined,
      )
    },

    applyChange: applyChangeToDeck,
    hasData: () => true,
    findCurrentFinish: findDeckFinish,
    findOriginalFinish: findOriginalDeckFinish,
    findCardId: findDeckCardId,
    getOriginalIds: getDeckCardIds,

    buildSaveBody: ({ data, changes, contentHash, extra }) => ({
      changes,
      deck: data,
      frontMatter: extra.frontMatter,
      contentHash,
    }),
  }

  const editor = useEditor<DeckData, Card>(config)

  const handleIncrement = (cardName: string) => {
    const d = editor.data()
    const cardId = d ? findDeckCardId(d, cardName) : undefined
    editor.changes.incrementCard(cardName, cardId)
    editor.setData((prev) =>
      prev ? applyChangeToDeck(prev, { action: 'add', cardName, cardId }) : prev,
    )
  }

  const handleDecrement = (cardName: string) => {
    const d = editor.data()
    const cardId = d ? findDeckCardId(d, cardName) : undefined

    let removedCardData: Card | undefined
    if (d) {
      for (const section of d.sections) {
        const card = section.cards.find((c) => c.name === cardName)
        if (card && card.quantity <= 1 && card.cardId !== undefined) {
          removedCardData = { ...card }
          editor.pool.release(card.cardId)
          break
        }
      }
    }

    editor.changes.decrementCard(cardName, cardId, removedCardData)
    editor.setData((prev) =>
      prev ? applyChangeToDeck(prev, { action: 'remove', cardName, cardId }) : prev,
    )
  }

  const handleContextMenu = (cardName: string, card: ScryfallCard | null, rect: DOMRect) => {
    const isInCommanderSection =
      editor
        .data()
        ?.sections.some(
          (s) =>
            s.name.toLowerCase().includes('commander') && s.cards.some((c) => c.name === cardName),
        ) ?? false
    setDeckContextMenu({ cardName, card, isInCommanderSection, anchorRect: rect })
    editor.setContextMenuCard({ cardName, card, anchorRect: rect })
  }

  const handleSetCommander = () => {
    const menu = deckContextMenu()
    const d = editor.data()
    if (!menu || !d) return
    const cardId = findDeckCardIdInSection(d, menu.cardName, false)
    editor.changes.addChange({ action: 'set-commander', cardName: menu.cardName, cardId })
    editor.setData((prev) =>
      prev
        ? applyChangeToDeck(prev, { action: 'set-commander', cardName: menu.cardName, cardId })
        : prev,
    )
    setDeckContextMenu(null)
    editor.setContextMenuCard(null)
  }

  const handleUnsetCommander = () => {
    const menu = deckContextMenu()
    const d = editor.data()
    if (!menu || !d) return
    const cardId = findDeckCardIdInSection(d, menu.cardName, true)
    editor.changes.addChange({ action: 'unset-commander', cardName: menu.cardName, cardId })
    editor.setData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'unset-commander',
            cardName: menu.cardName,
            cardId,
          })
        : prev,
    )
    setDeckContextMenu(null)
    editor.setContextMenuCard(null)
  }

  const closeModal = () => setModalCardName(null)
  const closeContextMenu = () => {
    setDeckContextMenu(null)
    editor.setContextMenuCard(null)
  }

  return (
    <EditorShell
      heading="Deck Editor"
      selectorId="deck-select"
      selectorLabel="Select Deck"
      selectorPlaceholder="Choose a deck"
      editor={editor}
      cardData={cardData}
      contextMenu={
        <Show when={deckContextMenu()}>
          {(menu) => (
            <CardContextMenu
              cardName={menu().cardName}
              card={menu().card}
              currentFinish={
                editor
                  .data()
                  ?.sections.flatMap((s) => s.cards)
                  .find((c) => c.name === menu().cardName)?.finish
              }
              onSetFoil={editor.handleSetFoil}
              onSetCommander={handleSetCommander}
              onUnsetCommander={handleUnsetCommander}
              isCommander={menu().isInCommanderSection}
              anchorRect={menu().anchorRect}
              onClose={closeContextMenu}
            />
          )}
        </Show>
      }
    >
      <DeckPage
        deck={editor.data()!}
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
        currency={editor.currency}
        slug={editor.slug()!}
        editMode={true}
        onAddCard={editor.dialogs.openSearchModal}
        onCardIncrement={handleIncrement}
        onCardDecrement={handleDecrement}
        onCardContextMenu={handleContextMenu}
        unsavedChangeCount={editor.changes.changeCount()}
      />
    </EditorShell>
  )
}
