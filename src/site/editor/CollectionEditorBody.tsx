import type { JSX } from 'solid-js'
import type { CollectionCardEntry } from '../../list/site-data'
import type { CardLabel } from '../../card/card-labels'
import { CollectionPage } from '../CollectionPage'
import { promptCardLabels } from '../../list-view/label-prompt'
import { setLabelsForCards } from '../../editor/collection-labels'
import { contextInfoFromSelected } from '../../list-view/selected-to-context'
import type { FlatBulkEdit } from '../../editor/flat-list-controller'
import { FlatEditorBody, type FlatEditorBodyProps } from './FlatEditorBody'

/**
 * `FlatEditorBody`'s props minus what this body decides for itself. Derived
 * rather than restated so the `{...props}` forwarding below is checked end to
 * end: the collection-only `onEditLabels`/`swap`/`onSwapPrintings` reach the
 * shell under the shell's own names, and adding a body prop cannot leave this
 * caller silently behind.
 */
type CollectionEditorBodyProps = Omit<
  FlatEditorBodyProps<CollectionCardEntry>,
  'shell' | 'page' | 'onSwapPrinting' | 'onSetLabel'
> & {
  /** The collection's default card labels; entries without an override inherit these. */
  listLabels?: CardLabel[]
}

/**
 * Editor chrome shared by the admin and public collection editors: the flat-list
 * {@link FlatEditorBody} wrapping a {@link CollectionPage} in edit mode. Card
 * labels are wired here — the one collection-specific layer both editors share —
 * so deck and wanted editors never see the "Set Label…" affordances.
 */
export function CollectionEditorBody(props: CollectionEditorBodyProps): JSX.Element {
  const ctrl = props.ctrl

  const bulkEdit: FlatBulkEdit = {
    ...ctrl.bulkEdit,
    setLabel: (cards, labels) =>
      setLabelsForCards(
        ctrl.editor,
        cards.map((c) => ({ cardName: c.name, cardIds: c.cardIds })),
        labels,
      ),
    swapPrintings: (cards) => ctrl.openSwapPrintings(cards.map(contextInfoFromSelected)),
  }

  return (
    <FlatEditorBody
      {...props}
      shell={{
        entityLabel: 'collection',
        selectorId: 'collection-select',
        requirePrinting: true,
        importKind: 'collection',
      }}
      onSwapPrinting={(target) => ctrl.openSwapPrintings([target])}
      onSetLabel={(target) =>
        promptCardLabels('collection', (labels) =>
          setLabelsForCards(
            ctrl.editor,
            [{ cardName: target.cardName, cardIds: target.cardIds }],
            labels,
          ),
        )
      }
      page={(entries) => (
        <CollectionPage
          name={props.name}
          description={props.description}
          slug={ctrl.editor.slug() ?? undefined}
          entries={entries()}
          sectionOrder={ctrl.editor.sectionOrder()}
          listLabels={props.listLabels}
          cards={ctrl.cardData.cards}
          printings={ctrl.cardData.printings}
          categories={ctrl.editor.categoriesJson()}
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
