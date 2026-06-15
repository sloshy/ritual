import { type Accessor, type JSX, Show, createSignal } from 'solid-js'
import type { DeckData, Card } from '../types'
import { DeckPage } from '../site/DeckPage'
import type { PriceCurrency } from '../price-currency'
import type { CardContextInfo, ContextMenuState } from './context-menu'
import type { EditorConfig, UseEditorResult } from './useEditor'
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
        unsavedChangeCount={editor.changes.changeCount()}
      />
    </EditorShell>
  )
}
