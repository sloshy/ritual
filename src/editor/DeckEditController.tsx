import { type Accessor, type JSX, Show, batch, createMemo, createSignal } from 'solid-js'
import type { SellModeProps } from '../site/sell-mode'
import type { DeckData, Card, Finish } from '../types'
import type { CardLabel } from '../card-labels'
import type { CardLanguage } from '../card-language'
import { DeckPage } from '../site/DeckPage'
import type { PriceCurrency } from '../price-currency'
import type { ListRef, PrintingTuple } from '../change-event'
import type { SelectedCard } from '../site/useCardSelection'
import type { CardContextInfo, ContextMenuState } from './context-menu'
import type { ListEditorConfig, UseEditorResult } from './useEditor'
import { contextInfoFromSelected } from './selected-to-context'
import { printingForMove } from '../site/printing-prompt'
import { promptListMove, promptSectionMove } from '../site/move-prompt'
import { promptCardLabels } from '../site/label-prompt'
import { promptCardLanguage } from './language-prompt'
import { useEditor } from './useEditor'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { useDeckCardData, type DeckCardData, type DeckCardDataActions } from './useDeckCardData'
import { applyChangeToDeck, findDeckAddMergeTargetId } from './deck-changes'
import {
  findDeckCardId,
  findDeckCardIdInSection,
  findDeckCardLabels,
  findDeckCardLanguage,
  findDeckCardSection,
} from './deck-config'
import { CardContextMenu } from './components/CardContextMenu'
import { EditorShell } from './components/EditorShell'
import { withDeckArt, type CardArtRefs } from './card-art-view'

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
  /** Set the language on each selected card (every copy of the entry). */
  setLanguage: (cards: SelectedCard[], language: CardLanguage) => void
  /**
   * Set (or clear, with `[]`) the label override on each selected card. Decks
   * carry `proxy` alone, so the picker offers that and the clear row.
   */
  setLabel: (cards: SelectedCard[], labels: CardLabel[]) => void
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
  /** Move every selected card out of this deck into another list. */
  moveToList: (cards: SelectedCard[], dest: ListRef) => void
  /** The other lists cards can be moved to, for the move-to-list submenu. */
  moveTargets: () => ListRef[]
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
  /**
   * Set (or clear, with `[]`) one card's label override — the body behind the
   * context menu's "Set Label…" and the multi-select bulk action.
   */
  handleSetLabelFor: (cardName: string, labels: CardLabel[], cardId?: number) => void
  handleSetCommander: () => void
  handleUnsetCommander: () => void
  /** Move the context-menu's card (every copy of the entry) into another list. */
  handleMoveCardToList: (target: CardContextInfo, dest: ListRef) => void
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
  buildConfig: (cardActions: DeckCardDataActions) => ListEditorConfig<DeckData>,
  initialSlug?: string | null,
): DeckEditController {
  const [cardData, cardActions] = useDeckCardData()
  const [modalCardName, setModalCardName] = createSignal<string | null>(null)
  const [deckContextMenu, setDeckContextMenu] = createSignal<DeckContextMenuState | null>(null)

  const editor = useEditor<DeckData, Card>(
    {
      // Deck entries carry their language directly, so the controller supplies the
      // set-language original resolver; a page config may still override it.
      findOriginalLanguage: findDeckCardLanguage,
      ...buildConfig(cardActions),
      copyModel: 'quantity',
      // Follows from the data shape, like the copy model: a deck folds a repeat
      // of the same printing into the existing entry, so per-line metadata an
      // add carries has to be aimed at that entry's `&N`.
      findAddMergeTargetId: findDeckAddMergeTargetId,
    },
    initialSlug,
  )

  const handleIncrement = (cardName: string) => {
    const d = editor.data()
    const cardId = d ? findDeckCardId(d, cardName) : undefined
    // The copy joins a line that already has an override, so the event carries
    // it: labels are part of a card's identity, and an add that claimed none
    // would no longer be the opposite of the matching decrement.
    const labels = findDeckCardLabels(d, cardName, cardId)
    editor.changes.addCard(cardName, { cardId, labels })
    editor.setData((prev) =>
      prev ? applyChangeToDeck(prev, { action: 'add', cardName, labels, cardId }) : prev,
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

    editor.changes.decrementCard(
      cardName,
      cardId,
      removedCardData,
      findDeckCardLabels(d, cardName, cardId),
    )
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

  /**
   * Set (or, with `[]`, clear) a deck line's label override. A deck entry holds
   * every copy under one `cardId`, so one event covers the whole tile. The
   * change consolidates against the on-disk override, so restoring a card's
   * original label cancels the pending change outright.
   */
  const handleSetLabelFor = (cardName: string, labels: CardLabel[], cardId?: number) => {
    const originalLabels = findDeckCardLabels(editor.getOriginal(), cardName, cardId)
    editor.changes.setLabel(cardName, labels, originalLabels, cardId)
    editor.setData((prev) =>
      prev ? applyChangeToDeck(prev, { action: 'set-label', cardName, labels, cardId }) : prev,
    )
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

  // Emit one move-from per copy. A deck entry holds all its copies under a single
  // cardId, so every event shares that id and it is freed to the pool once. The
  // moved copies keep the entry's language, resolved before the first move-from
  // collapses the entry.
  const emitMove = (
    cardName: string,
    dest: ListRef,
    printing: PrintingTuple,
    cardId: number | undefined,
    copies: number,
  ) => {
    const d = editor.data()
    const language = d ? findDeckCardLanguage(d, cardName, cardId) : undefined
    batch(() => {
      for (let i = 0; i < copies; i++) {
        editor.changes.moveCardToList(cardName, dest, { ...printing, language, cardId })
        editor.setData((prev) =>
          prev
            ? applyChangeToDeck(prev, {
                action: 'move-from',
                cardName,
                ...printing,
                language,
                cardId,
                to: dest,
              })
            : prev,
        )
      }
      if (cardId !== undefined) editor.pool.release(cardId)
    })
  }

  const moveCardToList = (target: CardContextInfo, dest: ListRef) => {
    void printingForMove(
      target.cardName,
      dest,
      {
        set: target.set,
        collectorNumber: target.collectorNumber,
        finish: target.finish,
        condition: target.condition,
      },
      cardData.printings[target.cardName] ?? [],
    ).then((printing) => {
      if (printing) emitMove(target.cardName, dest, printing, target.cardIds[0], target.quantity)
    })
  }

  const handleMoveCardToList = (target: CardContextInfo, dest: ListRef) => {
    closeContextMenu()
    moveCardToList(target, dest)
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
    setLanguage: (cards, language) => {
      batch(() => {
        for (const c of cards) editor.handleSetLanguageFor(c.name, language, c.cardIds[0])
      })
    },
    setLabel: (cards, labels) => {
      batch(() => {
        for (const c of cards) handleSetLabelFor(c.name, labels, c.cardIds[0])
      })
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
    moveToList: (cards, dest) => {
      void (async () => {
        for (const c of cards) {
          const printing = await printingForMove(
            c.name,
            dest,
            {
              set: c.set,
              collectorNumber: c.collectorNumber,
              finish: c.finish,
              condition: c.condition,
            },
            c.printings ?? [],
          )
          if (printing) emitMove(c.name, dest, printing, c.cardIds[0], c.groupSize)
        }
      })()
    },
    moveTargets: () => editor.moveTargets(),
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
    handleSetLabelFor,
    handleSetCommander,
    handleUnsetCommander,
    handleMoveCardToList,
    closeModal,
    closeContextMenu,
    bulkEdit,
  }
}

type DeckEditorBodyProps = SellModeProps & {
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
  /** The deck's default card labels (`proxy`), shown as badges on cards without an override. */
  listLabels?: CardLabel[]
  /** Open the list-default label editor (admin editor only — needs the authed metadata route). */
  onEditLabels?: () => void
  /** The deck's custom art, resolved onto the card lines the page renders. */
  customArt?: CardArtRefs
  /** Open the custom-art dialog for a card (admin editor only — needs the authed art route). */
  onSetCustomArt?: (target: CardContextInfo) => void
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
  // Memoized: the projection clones every section on a list that has art, and
  // the page prop is read on each of the editor's frequent re-renders. Null
  // while no deck is loaded — a memo runs as soon as either input changes, and
  // the art references land a beat before the data they decorate.
  const deckWithArt = createMemo(() => {
    const deck = editor.data()
    return deck === null ? null : withDeckArt(deck, props.customArt)
  })
  return (
    <EditorShell
      entityLabel="deck"
      selectorId="deck-select"
      editor={editor}
      cardData={ctrl.cardData}
      search={props.search}
      defaults={props.defaults}
      showSave={props.showSave}
      showDiscard={props.showDiscard}
      enableImport={props.enableImport}
      importKind="deck"
      onEditLabels={props.onEditLabels}
      enableAddArt={props.onSetCustomArt !== undefined}
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
              onSetLabel={() => {
                const target = menu()
                ctrl.closeContextMenu()
                // Deck-only choices: `proxy` and "use list default".
                promptCardLabels('deck', (labels) =>
                  ctrl.handleSetLabelFor(target.cardName, labels, target.cardIds[0]),
                )
              }}
              onSetLanguage={() => {
                const target = menu()
                const d = editor.data()
                const current = d
                  ? findDeckCardLanguage(d, target.cardName, target.cardIds[0])
                  : undefined
                ctrl.closeContextMenu()
                promptCardLanguage(current, (language) =>
                  editor.handleSetLanguageFor(target.cardName, language, target.cardIds[0]),
                )
              }}
              // Offered for a card added this session too: its art is held
              // with the pending changes and written by the save that gives the
              // line its `&N` (see `pending-art.ts`). Only a tile with no id at
              // all — nothing to key art by — hides the item.
              onSetCustomArt={
                props.onSetCustomArt && menu().cardIds[0] !== undefined
                  ? () => {
                      const apply = props.onSetCustomArt
                      if (!apply) return
                      const target = menu()
                      ctrl.closeContextMenu()
                      apply(target)
                    }
                  : undefined
              }
              onSetCommander={ctrl.handleSetCommander}
              onUnsetCommander={ctrl.handleUnsetCommander}
              isCommander={menu().isInCommanderSection}
              anchorRect={menu().anchorRect}
              onClose={ctrl.closeContextMenu}
              onMoveToSection={() => {
                const target = menu()
                const current = editor.data()
                  ? findDeckCardSection(editor.data()!, target)
                  : undefined
                ctrl.closeContextMenu()
                promptSectionMove(
                  editor.sectionOrder().filter((s) => s !== current),
                  (section) => editor.handleMoveCardToSection(target, section),
                  () => editor.promptNewSectionForCard(target),
                )
              }}
              moveTargets={editor.moveTargets()}
              onMoveToList={() => {
                const target = menu()
                ctrl.closeContextMenu()
                promptListMove(editor.moveTargets(), (dest) =>
                  ctrl.handleMoveCardToList(target, dest),
                )
              }}
            />
          )}
        </Show>
      }
    >
      <DeckPage
        deck={deckWithArt()!}
        listLabels={props.listLabels}
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
        enableSellMode={props.enableSellMode}
        bakedBuylist={props.bakedBuylist}
        onCardIncrement={ctrl.handleIncrement}
        onCardDecrement={ctrl.handleDecrement}
        onCardContextMenu={ctrl.handleContextMenu}
        bulkEdit={ctrl.bulkEdit}
        unsavedChangeCount={editor.changes.changeCount()}
        addedCardNames={editor.addedCardNames()}
      />
    </EditorShell>
  )
}
