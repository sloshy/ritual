import type { JSX } from 'solid-js'
import type { CardKingdomCards, WantedListCardEntry } from '../../list/site-data'
import { WantedListPage } from '../WantedListPage'
import { FlatEditorBody, type FlatEditorBodyCommonProps } from './FlatEditorBody'

type WantedEditorBodyProps = FlatEditorBodyCommonProps<WantedListCardEntry> & {
  /**
   * Card Kingdom's baked printing picks for this list, forwarded to the page so
   * the editing pane swaps printings on a source switch exactly as the read
   * pane beside it does. Static for the session — an entry added while editing
   * simply has no CK pick and falls back to its Scryfall one.
   */
  cardsCardKingdom?: CardKingdomCards
}

/**
 * Editor chrome shared by the admin and public wanted-list editors: the flat-list
 * {@link FlatEditorBody} wrapping a {@link WantedListPage} in edit mode.
 */
export function WantedEditorBody(props: WantedEditorBodyProps): JSX.Element {
  const ctrl = props.ctrl
  // A wanted list holds no physical cards, so the flat controller's optional
  // label and swap actions are dropped here rather than forwarded — the page's
  // `WantedBulkEditBundle` declares them absent, which is what makes this
  // explicit instead of silent.
  const { setLabel: _setLabel, swapPrintings: _swapPrintings, ...bulkEdit } = ctrl.bulkEdit
  return (
    <FlatEditorBody
      {...props}
      shell={{
        entityLabel: 'wanted list',
        selectorId: 'wanted-list-select',
        requirePrinting: false,
        importKind: 'wanted',
      }}
      page={(entries) => (
        <WantedListPage
          name={props.name}
          description={props.description}
          slug={ctrl.editor.slug() ?? undefined}
          entries={entries()}
          sectionOrder={ctrl.editor.sectionOrder()}
          cards={ctrl.cardData.cards}
          cardsCardKingdom={props.cardsCardKingdom}
          printings={ctrl.cardData.printings}
          symbolMap={ctrl.cardData.symbolMap}
          useScryfallImgUrls={props.useScryfallImgUrls}
          totalPrice={0}
          modalCardKey={ctrl.modalCardKey()}
          onOpenModal={ctrl.setModalCardKey}
          onCloseModal={ctrl.closeModal}
          currency={props.currency}
          editMode={true}
          fullWidth={props.fullWidth}
          enablePriceRefresh={props.enablePriceRefresh}
          enableTrade={props.enableTrade}
          enableSellMode={props.enableSellMode}
          bakedBuylist={props.bakedBuylist}
          onCardIncrement={ctrl.handleIncrement}
          onCardDecrement={ctrl.handleDecrement}
          onCardContextMenu={ctrl.handleContextMenu}
          bulkEdit={bulkEdit}
          unsavedChangeCount={ctrl.editor.changes.changeCount()}
          addedCardNames={ctrl.editor.addedCardNames()}
          shareLists={props.shareLists}
        />
      )}
    />
  )
}
