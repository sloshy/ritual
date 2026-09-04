import type { CardCategoriesJson } from '../list/card-categories-record'
/**
 * The props the three public list pages share. Restated per page they drifted —
 * one page's `pricesDate` doc said what the others' did not, and a caller that
 * forgot `shareLists` on one of them was invisible. Declared once, adding an
 * input is a compile error at every page that has not taken it.
 */
import type { CardLabel } from '../card/card-labels'
import type { ChangelogPage } from '../changes/changelog-parser'
import type { CardContextInfo } from '../list-view/card-context'
import type { NamedListRef } from '../list-view/combined-list'
import type { SellModeProps } from '../list-view/sell-mode'
import type { ListImageRef } from '../list/list-image'
import type { CardKingdomCards } from '../list/site-data'
import type { PriceCurrency } from '../pricing/price-currency'
import type { ScryfallCard } from '../scryfall/types'

/** Everything a list page takes that does not depend on which list type it is. */
export type ListPageCommonProps = {
  /**
   * The list's category vocabulary and per-name assignments, as its detail bakes
   * them. Drives the two category groupings' heading order and the filter row's
   * options; absent on a list with no categories.
   */
  categories?: CardCategoriesJson
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  /** Show the page-header Copy/Download export menu (public read view only). */
  enableExport?: boolean
  onCloseModal: () => void
  editMode?: boolean
  /** Card names added during the current edit session (edit mode only). */
  addedCardNames?: string[]
  onCardContextMenu?: (info: CardContextInfo, rect: DOMRect) => void
  /**
   * When provided, each card shows a single "Move To…" button (instead of the edit
   * or trade controls) reporting the card and the button's rect. Used by the admin
   * Move Cards page.
   */
  onCardMove?: (info: CardContextInfo, rect: DOMRect) => void
  unsavedChangeCount?: number
  changelog?: ChangelogPage[]
  /** Force page width; defaults to full width in edit/move mode. The public editor sets `false`. */
  fullWidth?: boolean
  /** Build-time price date (ISO), shipped with the list JSON; drives staleness after a refresh. */
  pricesDate?: string
  /** Show the public "Update Prices" toolbar button + staleness notice (public site only). */
  enablePriceRefresh?: boolean
  /** Offer "Add to Trade" in the multi-select menu (public site only; the trade page is unreachable on admin). */
  enableTrade?: boolean
  /** When provided (public read view), shows a "Combine with list…" header button. */
  onCombine?: () => void
  /** Mirror the toolbar/filter state into the URL query so the view is shareable (public read view only). */
  enableUrlState?: boolean
  /** Every list on the site, for the share filters; the page drops itself. */
  shareLists?: readonly NamedListRef[]
}

/**
 * A flat list page — a collection or a wanted list. The two took a
 * field-for-field identical block apart from their entry type `E`, their
 * bulk-edit bundle `B`, and one extra prop each. Tiles are keyed by modal keys
 * rather than names, since a flat list may hold several printings of one card.
 */
export type FlatListPageProps<E, B> = ListPageCommonProps &
  SellModeProps & {
    name: string
    /** Slug of this list, threaded into selected cards so cross-list edits can target it. */
    slug?: string
    entries: E[]
    /** Section names in display order, including empty sections. Falls back to entry order. */
    sectionOrder?: string[]
    /** The list's front-matter blurb, printed above the cards. */
    description?: string
    /** The list's cover image override, re-emitted by the `.md` download. */
    listImage?: ListImageRef
    /** The list's default card labels; entries without an override inherit these. */
    listLabels?: CardLabel[]
    /** Card Kingdom's own printing picks, read while the USD source is Card Kingdom. */
    cardsCardKingdom?: CardKingdomCards
    totalPrice: number
    modalCardKey: string | null
    onOpenModal: (cardKey: string) => void
    onCardIncrement?: (entry: E) => void
    onCardDecrement?: (entry: E) => void
    /** When provided (edit mode), enables bulk edit actions in the multi-select menu. */
    bulkEdit?: B
  }
