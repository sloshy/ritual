import type { JSX } from 'solid-js'
import type { CollectionCardEntry } from '../site/data-types'
import type { PriceCurrency } from '../price-currency'
import type { CardLabel } from '../card-labels'
import { CollectionPage } from '../site/CollectionPage'
import { promptCardLabels } from '../site/label-prompt'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { setLabelsForCards } from './collection-labels'
import {
  type FlatBulkEdit,
  type FlatListController,
  FlatListEditorShell,
} from './flat-list-controller'

type CollectionEditorBodyProps = {
  ctrl: FlatListController<CollectionCardEntry>
  defaults: UseEditorDefaultsResult
  search: SearchProvider
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Display name for the list page header. */
  name: string
  /** The collection's default card labels; entries without an override inherit these. */
  listLabels?: CardLabel[]
  showSave?: boolean
  showDiscard?: boolean
  enableImport?: boolean
  /** Forwarded to the page: the public editor keeps the centered container width. */
  fullWidth?: boolean
  /** Forwarded to the page: show the public "Update Prices" toolbar button + staleness. */
  enablePriceRefresh?: boolean
  /** Forwarded to the page: offer "Add to Trade" in the multi-select menu (public site only). */
  enableTrade?: boolean
  /**
   * Offer sell mode inside the editor's list view. Always true on admin (the
   * operator's own tools are not gated by `site.sellMode`); the public editor
   * inherits the site's capability.
   */
  enableSellMode?: boolean
  /** Open the list-default label editor (admin editor only — needs the authed metadata route). */
  onEditLabels?: () => void
}

/**
 * Editor chrome shared by the admin and public collection editors: the flat-list
 * {@link FlatListEditorShell} wrapping a {@link CollectionPage} in edit mode.
 * Card labels are wired here — the one collection-specific layer both editors
 * share — so deck and wanted editors never see the "Set Label…" affordances.
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
  }

  return (
    <FlatListEditorShell
      ctrl={ctrl}
      entityLabel="collection"
      selectorId="collection-select"
      defaults={props.defaults}
      search={props.search}
      requirePrinting={true}
      showSave={props.showSave}
      showDiscard={props.showDiscard}
      enableImport={props.enableImport}
      importKind="collection"
      onEditLabels={props.onEditLabels}
      onSetLabel={(target) =>
        promptCardLabels((labels) =>
          setLabelsForCards(
            ctrl.editor,
            [{ cardName: target.cardName, cardIds: target.cardIds }],
            labels,
          ),
        )
      }
    >
      <CollectionPage
        name={props.name}
        slug={ctrl.editor.slug() ?? undefined}
        entries={ctrl.editor.data()!}
        sectionOrder={ctrl.editor.sectionOrder()}
        listLabels={props.listLabels}
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
        enableSellMode={props.enableSellMode}
        onCardIncrement={ctrl.handleIncrement}
        onCardDecrement={ctrl.handleDecrement}
        onCardContextMenu={ctrl.handleContextMenu}
        bulkEdit={bulkEdit}
        unsavedChangeCount={ctrl.editor.changes.changeCount()}
        addedCardNames={ctrl.editor.addedCardNames()}
      />
    </FlatListEditorShell>
  )
}
