import type { JSX } from 'solid-js'
import type { WantedListCardEntry } from '../site/data-types'
import type { PriceCurrency } from '../price-currency'
import { WantedListPage } from '../site/WantedListPage'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { type FlatListController, FlatListEditorShell } from './flat-list-controller'

type WantedEditorBodyProps = {
  ctrl: FlatListController<WantedListCardEntry>
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
}

/**
 * Editor chrome shared by the admin and public wanted-list editors: the flat-list
 * {@link FlatListEditorShell} wrapping a {@link WantedListPage} in edit mode.
 */
export function WantedEditorBody(props: WantedEditorBodyProps): JSX.Element {
  const ctrl = props.ctrl
  return (
    <FlatListEditorShell
      ctrl={ctrl}
      entityLabel="wanted list"
      selectorId="wanted-list-select"
      selectorLabel="Select Wanted List"
      selectorPlaceholder="Choose a wanted list"
      defaults={props.defaults}
      search={props.search}
      requirePrinting={false}
      showSave={props.showSave}
      showDiscard={props.showDiscard}
      enableImport={props.enableImport}
      importKind="wanted"
    >
      <WantedListPage
        name={props.name}
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
        onCardIncrement={ctrl.handleIncrement}
        onCardDecrement={ctrl.handleDecrement}
        onCardContextMenu={ctrl.handleContextMenu}
        unsavedChangeCount={ctrl.editor.changes.changeCount()}
      />
    </FlatListEditorShell>
  )
}
