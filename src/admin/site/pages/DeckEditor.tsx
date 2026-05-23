import { type JSX, batch, createSignal, Show } from 'solid-js'
import type { DeckData, Card, Finish, ScryfallCard } from '../../../types'
import type { ContextMenuState, CardContextInfo } from '../types/context-menu'
import type { CardPriceResponse } from '../../api/card-price'
import type { EditorConfig, ChangePrintingContext } from '../hooks/useEditor'
import { type PrintingTuple, isSamePrinting } from '../../../change-event'
import { collectDeckCardIds } from '../../../card-id'
import { DeckPage } from '../../../site/DeckPage'
import { useDeckCardData } from '../hooks/useDeckCardData'
import { useEditor } from '../hooks/useEditor'
import { useEditorDefaults } from '../hooks/useEditorDefaults'
import { applyChangeToDeck } from '../types/deck-changes'
import { CardContextMenu } from '../components/CardContextMenu'
import { EditorShell } from '../components/EditorShell'

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

/** Find a card's on-disk printing by card ID, for change-printing revert detection. */
function findOriginalDeckPrinting(
  deck: DeckData | null,
  cardId: number,
): PrintingTuple | undefined {
  if (!deck) return undefined
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.cardId === cardId)
    if (card) {
      return {
        set: card.set,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        condition: card.condition,
      }
    }
  }
  return undefined
}

/**
 * Apply a "change printing" action to a deck. When every copy changes, the entry
 * is retargeted in place (a single set-printing change). When only some copies
 * change, the entry's quantity is decreased and that many copies of the new
 * printing are added under a fresh card ID — logged as a quantity decrease plus
 * a new add, per the deck's quantity semantics.
 */
function applyDeckChangePrinting(ctx: ChangePrintingContext<DeckData>): void {
  const { target, count, options, tools, setData, original } = ctx
  const cardId = target.cardIds[0]
  if (cardId === undefined) return

  const newPrinting: PrintingTuple = {
    set: options.set,
    collectorNumber: options.collectorNumber,
    finish: options.finish,
    condition: options.condition,
  }
  const currentPrinting: PrintingTuple = {
    set: target.set,
    collectorNumber: target.collectorNumber,
    finish: target.finish,
    condition: target.condition,
  }
  if (isSamePrinting(newPrinting, currentPrinting)) return

  const total = target.quantity
  const n = Math.min(Math.max(count, 1), total)

  if (n >= total) {
    const origPrinting = findOriginalDeckPrinting(original, cardId) ?? currentPrinting
    tools.setPrinting(target.cardName, newPrinting, origPrinting, cardId)
    setData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'set-printing',
            cardName: target.cardName,
            set: newPrinting.set,
            collectorNumber: newPrinting.collectorNumber,
            finish: newPrinting.finish,
            condition: newPrinting.condition,
            cardId,
          })
        : prev,
    )
    return
  }

  // Decrement the original entry by n, then add n copies of the new printing
  // under a fresh card ID. Batched so the deck view repaints once, not 2n times.
  batch(() => {
    for (let i = 0; i < n; i++) {
      tools.decrementCard(target.cardName, cardId)
      setData((prev) =>
        prev
          ? applyChangeToDeck(prev, { action: 'remove', cardName: target.cardName, cardId })
          : prev,
      )
    }
    const newId = tools.allocateId()
    for (let i = 0; i < n; i++) {
      tools.addCard(target.cardName, { ...options, cardId: newId })
      setData((prev) =>
        prev
          ? applyChangeToDeck(prev, {
              action: 'add',
              cardName: target.cardName,
              set: options.set,
              collectorNumber: options.collectorNumber,
              finish: options.finish,
              condition: options.condition,
              cardId: newId,
            })
          : prev,
      )
    }
  })
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

type DeckEditorProps = { initialSlug?: string | null }

export function DeckEditor(props: DeckEditorProps): JSX.Element {
  const [cardData, cardActions] = useDeckCardData()
  const [modalCardName, setModalCardName] = createSignal<string | null>(null)
  const [deckContextMenu, setDeckContextMenu] = createSignal<DeckContextMenuState | null>(null)
  const defaults = useEditorDefaults('deck')

  const config: EditorConfig<DeckData> = {
    listEndpoint: '/api/decks',
    extractListItems: (r) => (r as DeckListResponse).decks ?? [],
    dataEndpoint: (slug) => `/api/deck/${slug}`,
    saveEndpoint: (slug) => `/api/deck/${slug}/save`,
    entityLabel: 'deck',

    processLoadResponse: (response) => {
      const r = response as DeckDataResponse
      if (!r.success) return null
      const poolIds = collectDeckCardIds(r.deck)
      return {
        data: r.deck,
        poolIds,
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
    applyChangePrinting: applyDeckChangePrinting,
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

  const editor = useEditor<DeckData, Card>(config, props.initialSlug)

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

  const handleContextMenu = (info: CardContextInfo, rect: DOMRect) => {
    const isInCommanderSection =
      editor
        .data()
        ?.sections.some(
          (s) =>
            s.name.toLowerCase().includes('commander') &&
            s.cards.some((c) => c.name === info.cardName),
        ) ?? false
    setDeckContextMenu({ ...info, isInCommanderSection, anchorRect: rect })
    editor.setContextMenuCard({ ...info, anchorRect: rect })
  }

  const handleChangePrinting = () => {
    const menu = deckContextMenu()
    closeContextMenu()
    if (menu) editor.startChangePrinting(menu)
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
      defaults={defaults}
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
              onChangePrinting={handleChangePrinting}
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
        onCardIncrement={handleIncrement}
        onCardDecrement={handleDecrement}
        onCardContextMenu={handleContextMenu}
        unsavedChangeCount={editor.changes.changeCount()}
      />
    </EditorShell>
  )
}
