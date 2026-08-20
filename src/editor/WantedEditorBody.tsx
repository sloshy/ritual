import { createMemo, type JSX } from 'solid-js'
import type { CardKingdomCards, WantedListCardEntry } from '../site/data-types'
import type { NamedListRef } from '../site/combined-list'
import type { SellModeProps } from '../site/sell-mode'
import type { PriceCurrency } from '../price-currency'
import { WantedListPage } from '../site/WantedListPage'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { type FlatListController, FlatListEditorShell } from './flat-list-controller'
import type { CardContextInfo } from './context-menu'
import { withEntryArt, type CardArtRefs } from './card-art-view'

type WantedEditorBodyProps = SellModeProps & {
  ctrl: FlatListController<WantedListCardEntry>
  defaults: UseEditorDefaultsResult
  search: SearchProvider
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /**
   * Card Kingdom's baked printing picks for this list, forwarded to the page so
   * the editing pane swaps printings on a source switch exactly as the read
   * pane beside it does. Static for the session — an entry added while editing
   * simply has no CK pick and falls back to its Scryfall one.
   */
  cardsCardKingdom?: CardKingdomCards
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
  /** The list's custom art, resolved onto the entries the page renders. */
  customArt?: CardArtRefs
  /** Open the custom-art dialog for a card (admin editor only — needs the authed art route). */
  onSetCustomArt?: (target: CardContextInfo) => void
  /** Every list, for the toolbar's share filters (the page drops itself). */
  shareLists?: readonly NamedListRef[]
}

/**
 * Editor chrome shared by the admin and public wanted-list editors: the flat-list
 * {@link FlatListEditorShell} wrapping a {@link WantedListPage} in edit mode.
 */
export function WantedEditorBody(props: WantedEditorBodyProps): JSX.Element {
  const ctrl = props.ctrl
  // Memoized: the projection clones every entry on a list that has art, and the
  // page prop is read on each of the editor's frequent re-renders. Null while
  // no list is loaded — a memo runs as soon as either input changes, and the
  // art references land a beat before the entries they decorate.
  const entriesWithArt = createMemo(() => {
    const entries = ctrl.editor.data()
    return entries === null ? null : withEntryArt(entries, props.customArt)
  })
  return (
    <FlatListEditorShell
      ctrl={ctrl}
      entityLabel="wanted list"
      selectorId="wanted-list-select"
      defaults={props.defaults}
      search={props.search}
      requirePrinting={false}
      showSave={props.showSave}
      showDiscard={props.showDiscard}
      enableImport={props.enableImport}
      importKind="wanted"
      onSetCustomArt={props.onSetCustomArt}
    >
      <WantedListPage
        name={props.name}
        slug={ctrl.editor.slug() ?? undefined}
        entries={entriesWithArt()!}
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
        bulkEdit={ctrl.bulkEdit}
        unsavedChangeCount={ctrl.editor.changes.changeCount()}
        addedCardNames={ctrl.editor.addedCardNames()}
        shareLists={props.shareLists}
      />
    </FlatListEditorShell>
  )
}
