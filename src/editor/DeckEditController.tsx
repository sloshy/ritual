import { type Accessor, type JSX, Show, createSignal } from 'solid-js'
import type { DeckData, Card, Finish } from '../types'
import { DeckPage } from '../site/DeckPage'
import type { PriceCurrency } from '../price-currency'
import type { SelectedCard } from '../site/useCardSelection'
import type { CardContextInfo, ContextMenuState } from './context-menu'
import type { EditorConfig, UseEditorResult } from './useEditor'
import { contextInfoFromSelected } from './selected-to-context'
import { useEditor } from './useEditor'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { useDeckCardData, type DeckCardData, type DeckCardDataActions } from './useDeckCardData'
import { applyChangeToDeck } from './deck-changes'
import { findDeckCardId, findDeckCardIdInSection, findDeckCardSection } from './deck-config'
import { CardContextMenu } from './components/CardContextMenu'
import { EditorShell } from './components/EditorShell'

/** Deck context-menu state plus whether the targeted card is currently a commander. */
export type DeckContextMenuState = ContextMenuState & { isInCommanderSection: boolean }

/**
 * Bulk edit operations over a multi-select of deck cards. Each maps the selection
 * onto the controller's existing single-card primitives (quantity steppers,
 * foil/section/commander, change printing), iterating copies where needed. Decks
 * operate by card name; copies are applied as repeated single-step changes.
 */
export type DeckBulkEdit = {
  /** Add one more copy of each selected card. */
  addCopy: (cards: SelectedCard[]) => void
  /** Remove one copy of each selected card. */
  removeCopy: (cards: SelectedCard[]) => void
  /** Remove every copy of each selected card (full removal). */
  removeAll: (cards: SelectedCard[]) => void
  /** Set the finish on each selected card that supports it; others are skipped. */
  setFinish: (cards: SelectedCard[], finish: Finish) => void
  /** Run the change-printing flow over the selection one card at a time. */
  changePrinting: (cards: SelectedCard[]) => void
  /** Mark each selected card as a commander. */
  setCommander: (cards: SelectedCard[]) => void
  /** Move every selected card into an existing section. */
  moveToSection: (cards: SelectedCard[], section: string) => void
  /** Prompt for a new section name and move every selected card into it. */
  promptNewSection: (cards: SelectedCard[]) => void
  /** Current section names, for the move submenu. */
  sections: () => string[]
}

/**
 * Shared controller for the deck editor: owns the card-data store, the
 * {@link useEditor} instance, and every deck interaction handler (quantity steppers,
 * context menu, change-printing, commander toggles). Both the admin deck editor and
 * the public deck editor build a config and drive their UI from this, so the two
 * stay behaviorally identical.
 */
export type DeckEditController = {
  editor: UseEditorResult<DeckData, Card>
  cardData: DeckCardData
  cardActions: DeckCardDataActions
  modalCardName: Accessor<string | null>
  setModalCardName: (value: string | null) => void
  deckContextMenu: Accessor<DeckContextMenuState | null>
  handleIncrement: (cardName: string) => void
  handleDecrement: (cardName: string) => void
  handleContextMenu: (info: CardContextInfo, rect: DOMRect) => void
  handleChangePrinting: () => void
  handleSetCommander: () => void
  handleUnsetCommander: () => void
  closeModal: () => void
  closeContextMenu: () => void
  /** Bulk edit operations over a multi-select of deck cards. */
  bulkEdit: DeckBulkEdit
}

/**
 * Create a {@link DeckEditController}. `buildConfig` receives the freshly created
 * card-data actions so each caller can wire its own load/commit/search/price
 * strategies while sharing the store and interaction logic.
 */
export function useDeckEditController(
  buildConfig: (cardActions: DeckCardDataActions) => EditorConfig<DeckData>,
  initialSlug?: string | null,
): DeckEditController {
  const [cardData, cardActions] = useDeckCardData()
  const [modalCardName, setModalCardName] = createSignal<string | null>(null)
  const [deckContextMenu, setDeckContextMenu] = createSignal<DeckContextMenuState | null>(null)

  const editor = useEditor<DeckData, Card>(buildConfig(cardActions), initialSlug)

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

  const closeContextMenu = () => {
    setDeckContextMenu(null)
    editor.setContextMenuCard(null)
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

  const setCommanderFor = (cardName: string) => {
    const d = editor.data()
    if (!d) return
    const cardId = findDeckCardIdInSection(d, cardName, false)
    editor.changes.addChange({ action: 'set-commander', cardName, cardId })
    editor.setData((prev) =>
      prev ? applyChangeToDeck(prev, { action: 'set-commander', cardName, cardId }) : prev,
    )
  }

  const handleSetCommander = () => {
    const menu = deckContextMenu()
    if (!menu) return
    setCommanderFor(menu.cardName)
    closeContextMenu()
  }

  const handleUnsetCommander = () => {
    const menu = deckContextMenu()
    const d = editor.data()
    if (!menu || !d) return
    const cardId = findDeckCardIdInSection(d, menu.cardName, true)
    editor.changes.addChange({ action: 'unset-commander', cardName: menu.cardName, cardId })
    editor.setData((prev) =>
      prev
        ? applyChangeToDeck(prev, { action: 'unset-commander', cardName: menu.cardName, cardId })
        : prev,
    )
    closeContextMenu()
  }

  const closeModal = () => setModalCardName(null)

  const bulkEdit: DeckBulkEdit = {
    addCopy: (cards) => {
      for (const c of cards) handleIncrement(c.name)
    },
    removeCopy: (cards) => {
      for (const c of cards) handleDecrement(c.name)
    },
    removeAll: (cards) => {
      // groupSize is the tile's full copy count; decrement that many times so a
      // partial selection still removes the whole card. handleDecrement re-reads
      // the data each call and collapses the line at 0 — self-terminating.
      for (const c of cards) for (let i = 0; i < c.groupSize; i++) handleDecrement(c.name)
    },
    setFinish: (cards, finish) => {
      for (const c of cards) {
        if (!c.scryfallCard?.finishes?.includes(finish)) continue
        editor.handleSetFinishFor(c.name, finish, c.cardIds[0])
      }
    },
    changePrinting: (cards) => editor.startBulkChangePrinting(cards.map(contextInfoFromSelected)),
    setCommander: (cards) => {
      for (const c of cards) setCommanderFor(c.name)
    },
    moveToSection: (cards, section) =>
      editor.handleMoveCardsToSection(cards.map(contextInfoFromSelected), section),
    promptNewSection: (cards) =>
      editor.promptNewSectionForCards(cards.map(contextInfoFromSelected)),
    sections: () => editor.sectionOrder(),
  }

  return {
    editor,
    cardData,
    cardActions,
    modalCardName,
    setModalCardName,
    deckContextMenu,
    handleIncrement,
    handleDecrement,
    handleContextMenu,
    handleChangePrinting,
    handleSetCommander,
    handleUnsetCommander,
    closeModal,
    closeContextMenu,
    bulkEdit,
  }
}

type DeckEditorBodyProps = {
  ctrl: DeckEditController
  defaults: UseEditorDefaultsResult
  search: SearchProvider
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Hide the action bar's Save button (public editor exports via its banner). */
  showSave?: boolean
  /** Hide the action bar's Discard button (public editor discards via its banner). */
  showDiscard?: boolean
  /** Enable the admin-only import-changes button + dialog. */
  enableImport?: boolean
  /** Forwarded to the page: the public editor keeps the centered container width. */
  fullWidth?: boolean
  /** Forwarded to the page: show the public "Update Prices" toolbar button + staleness. */
  enablePriceRefresh?: boolean
  /** Forwarded to the page: offer "Add to Trade" in the multi-select menu (public site only). */
  enableTrade?: boolean
}

/**
 * The editor chrome shared by both deck editors: the {@link EditorShell} (selector,
 * search modal, dialogs, action bar) wrapping a {@link DeckPage} in edit mode, plus
 * the deck context menu. Callers add their own surrounding chrome (admin: nothing;
 * public: the edit banner + export panel + original/edited toggle).
 */
export function DeckEditorBody(props: DeckEditorBodyProps): JSX.Element {
  const ctrl = props.ctrl
  const editor = ctrl.editor
  return (
    <EditorShell
      entityLabel="deck"
      selectorId="deck-select"
      selectorLabel="Select Deck"
      selectorPlaceholder="Choose a deck"
      editor={editor}
      cardData={ctrl.cardData}
      search={props.search}
      defaults={props.defaults}
      showSave={props.showSave}
      showDiscard={props.showDiscard}
      enableImport={props.enableImport}
      importKind="deck"
      contextMenu={
        <Show when={ctrl.deckContextMenu()}>
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
              onChangePrinting={ctrl.handleChangePrinting}
              onSetCommander={ctrl.handleSetCommander}
              onUnsetCommander={ctrl.handleUnsetCommander}
              isCommander={menu().isInCommanderSection}
              anchorRect={menu().anchorRect}
              onClose={ctrl.closeContextMenu}
              sections={editor.sectionOrder()}
              currentSection={
                editor.data() ? findDeckCardSection(editor.data()!, menu()) : undefined
              }
              onMoveToSection={(section) => {
                editor.handleMoveCardToSection(menu(), section)
                ctrl.closeContextMenu()
              }}
              onCreateSection={() => {
                editor.promptNewSectionForCard(menu())
                ctrl.closeContextMenu()
              }}
            />
          )}
        </Show>
      }
    >
      <DeckPage
        deck={editor.data()!}
        cards={ctrl.cardData.cards}
        printings={ctrl.cardData.printings}
        lowestPriceCards={ctrl.cardData.lowestPriceCards}
        lowestPriceCardsEur={ctrl.cardData.lowestPriceCardsEur}
        lowestPriceCardsTix={ctrl.cardData.lowestPriceCardsTix}
        symbolMap={ctrl.cardData.symbolMap}
        useScryfallImgUrls={props.useScryfallImgUrls}
        modalCardName={ctrl.modalCardName()}
        onOpenModal={ctrl.setModalCardName}
        onCloseModal={ctrl.closeModal}
        currency={props.currency}
        slug={editor.slug() ?? ''}
        editMode={true}
        fullWidth={props.fullWidth}
        enablePriceRefresh={props.enablePriceRefresh}
        enableTrade={props.enableTrade}
        onCardIncrement={ctrl.handleIncrement}
        onCardDecrement={ctrl.handleDecrement}
        onCardContextMenu={ctrl.handleContextMenu}
        bulkEdit={ctrl.bulkEdit}
        unsavedChangeCount={editor.changes.changeCount()}
      />
    </EditorShell>
  )
}
