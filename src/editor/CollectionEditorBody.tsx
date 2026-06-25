import type { JSX } from 'solid-js'
import type { CollectionCardEntry } from '../site/data-types'
import type { PriceCurrency } from '../price-currency'
import { CollectionPage } from '../site/CollectionPage'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { type FlatListController, FlatListEditorShell } from './flat-list-controller'

type CollectionEditorBodyProps = {
  ctrl: FlatListController<CollectionCardEntry>
  defaults: UseEditorDefaultsResult
  search: SearchProvider
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Display name for the list page header. */
  name: string
  showSave?: boolean
  showDiscard?: boolean
  enableImport?: boolean
  /** Forwarded to the page: the public editor keeps the centered container width. */
  fullWidth?: boolean
  /** Forwarded to the page: show the public "Update Prices" toolbar button + staleness. */
  enablePriceRefresh?: boolean
  /** Forwarded to the page: offer "Add to Trade" in the multi-select menu (public site only). */
  enableTrade?: boolean
}

/**
 * Editor chrome shared by the admin and public collection editors: the flat-list
 * {@link FlatListEditorShell} wrapping a {@link CollectionPage} in edit mode.
 */
export function CollectionEditorBody(props: CollectionEditorBodyProps): JSX.Element {
  const ctrl = props.ctrl
  return (
    <FlatListEditorShell
      ctrl={ctrl}
      entityLabel="collection"
      selectorId="collection-select"
      selectorLabel="Select Collection"
      selectorPlaceholder="Choose a collection"
      defaults={props.defaults}
      search={props.search}
      requirePrinting={true}
      showSave={props.showSave}
      showDiscard={props.showDiscard}
      enableImport={props.enableImport}
      importKind="collection"
    >
      <CollectionPage
        name={props.name}
        slug={ctrl.editor.slug() ?? undefined}
        entries={ctrl.editor.data()!}
        sectionOrder={ctrl.editor.sectionOrder()}
        cards={ctrl.cardData.cards}
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
        onCardIncrement={ctrl.handleIncrement}
        onCardDecrement={ctrl.handleDecrement}
        onCardContextMenu={ctrl.handleContextMenu}
        bulkEdit={ctrl.bulkEdit}
        unsavedChangeCount={ctrl.editor.changes.changeCount()}
        addedCardNames={ctrl.editor.addedCardNames()}
      />
    </FlatListEditorShell>
  )
}
