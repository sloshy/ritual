import { createMemo, type JSX } from 'solid-js'
import type { CollectionCardEntry } from '../site/data-types'
import type { NamedListRef } from '../site/combined-list'
import type { SellModeProps } from '../site/sell-mode'
import type { PriceCurrency } from '../price-currency'
import type { CardLabel } from '../card-labels'
import type { CardContextInfo } from './context-menu'
import { withEntryArt, type CardArtRefs } from './card-art-view'
import { CollectionPage } from '../site/CollectionPage'
import { promptCardLabels } from '../site/label-prompt'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { setLabelsForCards } from './collection-labels'
import { contextInfoFromSelected } from './selected-to-context'
import type { SwapPrintingsWizardProps } from './components/SwapPrintingsWizard'
import {
  type FlatBulkEdit,
  type FlatListController,
  FlatListEditorShell,
} from './flat-list-controller'

type CollectionEditorBodyProps = SellModeProps & {
  ctrl: FlatListController<CollectionCardEntry>
  defaults: UseEditorDefaultsResult
  search: SearchProvider
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Display name for the list page header. */
  name: string
  /** Forwarded to the page: the list's front-matter blurb. */
  description?: string
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
  /** Open the list-default label editor (admin editor only — needs the authed metadata route). */
  onEditLabels?: () => void
  /** Open the cover-image editor (admin editor only — needs the authed metadata route). */
  onEditImage?: () => void
  /** The list's custom art, resolved onto the entries the page renders. */
  customArt?: CardArtRefs
  /** Open the custom-art dialog for a card (admin editor only — needs the authed art route). */
  onSetCustomArt?: (target: CardContextInfo) => void
  /** Every list, for the toolbar's share filters (the page drops itself). */
  shareLists?: readonly NamedListRef[]
  /** The "Swap Printings" wizard's props (see `FlatListController.swapWizardProps`). */
  swap?: SwapPrintingsWizardProps
  /** Offer the whole-list swap from the action bar (admin editor; the public one uses its edit row). */
  onSwapPrintings?: () => void
}

/**
 * Editor chrome shared by the admin and public collection editors: the flat-list
 * {@link FlatListEditorShell} wrapping a {@link CollectionPage} in edit mode.
 * Card labels are wired here — the one collection-specific layer both editors
 * share — so deck and wanted editors never see the "Set Label…" affordances.
 */
export function CollectionEditorBody(props: CollectionEditorBodyProps): JSX.Element {
  const ctrl = props.ctrl
  // Memoized: the projection clones every entry on a list that has art, and the
  // page prop is read on each of the editor's frequent re-renders. Null while
  // no list is loaded — a memo runs as soon as either input changes, and the
  // art references land a beat before the entries they decorate.
  const entriesWithArt = createMemo(() => {
    const entries = ctrl.editor.data()
    return entries === null ? null : withEntryArt(entries, props.customArt)
  })

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
      onEditImage={props.onEditImage}
      onSetCustomArt={props.onSetCustomArt}
      swap={props.swap}
      onSwapPrintings={props.onSwapPrintings}
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
    >
      <CollectionPage
        name={props.name}
        description={props.description}
        slug={ctrl.editor.slug() ?? undefined}
        entries={entriesWithArt()!}
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
        bakedBuylist={props.bakedBuylist}
        onCardIncrement={ctrl.handleIncrement}
        onCardDecrement={ctrl.handleDecrement}
        onCardContextMenu={ctrl.handleContextMenu}
        bulkEdit={bulkEdit}
        unsavedChangeCount={ctrl.editor.changes.changeCount()}
        addedCardNames={ctrl.editor.addedCardNames()}
        shareLists={props.shareLists}
      />
    </FlatListEditorShell>
  )
}
