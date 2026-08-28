/**
 * The setup half of the shared list-page frame: everything the deck, collection
 * and wanted-list pages do between building their cards and rendering a tile.
 * The chrome it feeds is `ListPageShell`.
 *
 * Reactivity contract: every config field that is read repeatedly is an
 * accessor, and every accessor is read where the original page read it. In
 * particular `cards` stays a thunk — {@link useSellMode} takes it deferred — and
 * `useListViewUrlSync` is called at the same setup position it always was, since
 * it reads its vocabulary once and returns early when disabled.
 *
 * One ordering constraint on callers: the memos behind `cards`, `filterSource`
 * and `valued` must be declared *above* the `useListPage` call. `createMemo`
 * evaluates eagerly, and the sell summary this hook builds reads through them
 * immediately — a memo declared after the call is in its temporal dead zone.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onMount,
  type Accessor,
  type Setter,
} from 'solid-js'
import { buyerName } from '../buylist'
import type { CardLabelSelection } from '../card/card-labels'
import {
  CARD_SIZE_WIDTHS,
  groupAndSortCards,
  groupTotalPrice,
  sortByOptions,
  sortByValuesFor,
  type CardData,
  type CardGroup,
  type GroupBy,
  type SelectOption,
  type SortBy,
  type SortByMessageKey,
} from '../list-view/card-sorting'
import type { CombinedListRef, NamedListRef } from '../list-view/combined-list'
import { cartBuyer } from '../list-view/sell-mode'
import {
  buildSelectionEditActions,
  type BulkEditBundle,
  type SelectionEditActions,
} from '../list-view/selection-edit-actions'
import {
  useCardSelection,
  type CardSelectionControl,
  type SelectionListId,
} from '../list-view/useCardSelection'
import type { BakedBuylist } from '../list/site-data'
import type { PriceCurrency } from '../pricing/price-currency'
import { useT } from '../ui/i18n'
import { useTooltip, type UseTooltipResult } from '../ui/useTooltip'
import { useCardNavScroll } from './card-nav'
import {
  collectArtTags,
  collectCardTypes,
  collectOracleTags,
  collectSetCodes,
  filterCards,
  isTagFilterActive,
  untaggedAddedCardNames,
} from './card-filters'
import type { ExtraExportFormat } from './ExportMenu'
import type { GroupByOption } from './list-page-options'
import {
  pruneOwnShareSelections,
  shareListsExcluding,
  useShareFilterContext,
  type ShareListsForPage,
} from './list-shares'
import { usePublicPriceControls } from './PriceControls'
import {
  sellableFromCardData,
  selectionToCartCsv,
  type SellableCard,
  type SellValueSummary,
} from './sell-value'
import { useCardFilters, type CardFiltersControl } from './useCardFilters'
import { useListViewUrlSync } from './useListViewUrlSync'
import { useReadCardMenu, type UseReadCardMenuResult } from './useReadCardMenu'
import {
  createSellSummary,
  useSellMode,
  type QuoteSource,
  type SellModeDefaults,
  type UseSellModeResult,
} from './useSellMode'
import { useToolbarState, type UseToolbarStateResult } from './useToolbarState'
import type { PriceRefresh } from './usePriceRefresh'

/**
 * Which list the page is showing — the {@link SelectionListId} the selection
 * store keys on, plus the slug the share filters and card-nav need.
 *
 * `name` is plain and read once, as {@link useCardSelection} has always read it:
 * a page kept mounted while the list is *renamed* keeps selecting under the old
 * name (rewriting the store's keys mid-session is worse). Only `slug` follows a
 * switch, which is why it alone is an accessor.
 */
export type ListPageIdentity = SelectionListId & {
  /** The page's slug, when it has one. Reactive: admin surfaces switch it in place. */
  slug: Accessor<string | undefined>
}

/**
 * The page's effective default grouping and sort — the same type
 * {@link useSellMode} reverts to, not a structural twin, so the two cannot drift.
 */
export type ListPageDefaults<G extends GroupBy> = SellModeDefaults<G>

/**
 * The vocabulary this page's toolbar offers. `sortBys` and `defaults` are read
 * **once at setup** — the URL sync takes them plain and returns early when
 * disabled — so each must follow from the page's *kind*, not from data arriving
 * later, as must the first read of `availableLabels`. `groupByOptionsFor` is the
 * exception: a function, called at setup for the URL whitelist and live on every
 * dropdown read, which lets the flat pages close over a reactive `hasSections()`.
 */
export type ListPageOptions<G extends GroupBy> = {
  /**
   * The group-by choices, given whether sell mode is on. A parameter rather than
   * a read of the live toggle: the URL sync validates a shared link against the
   * *full* set, while the dropdown offers only what is on.
   */
  groupByOptionsFor: (sellMode: boolean) => readonly GroupByOption<G>[]
  /** The sort fields this page offers, in order, before sell mode's are folded in. */
  sortBys: readonly SortBy[]
  /** Relabels a sort field in this page's context (the combined view's `file-order`). */
  sortByOverrides?: Partial<Record<SortBy, SortByMessageKey>>
  /**
   * The label chips the filter row offers, and the `labels=` values a link may
   * name. An accessor: the combined view's chips follow its list *set*, which
   * changes without a remount. The URL sync still reads it once, at setup.
   */
  availableLabels: Accessor<readonly CardLabelSelection[]>
  /** The page's effective default group/sort, so default values stay out of the URL. */
  defaults: ListPageDefaults<G>
}

/**
 * Cards counting toward the page's money figures that are not in
 * {@link ListPageConfig.filterSource} — a deck's commander (pinned; the filters
 * never touch the deck's identity) and its sideboard (filtered, rendered apart).
 */
export type ListPageValuedCards<C extends CardData> = {
  /** Cards the filters never touch. */
  pinned?: Accessor<C[]>
  /** Cards filtered like the main view, exposed back as `filteredAlso`. */
  alsoFiltered?: Accessor<C[]>
}

/**
 * What the page is a view *of*, and therefore what its tiles select: either one
 * list — whose {@link useCardSelection} the frame then builds itself, so the two
 * can never name different lists — or a synthetic multi-list surface, which
 * brings its own selection and has no slug for the share filters, their
 * slug-switch prune, or card-nav to key on.
 */
export type ListPageScope =
  | { identity: ListPageIdentity; selection?: undefined }
  | { identity?: undefined; selection: CardSelectionControl }

export type ListPageConfig<G extends GroupBy, C extends CardData> = ListPageScope & {
  options: ListPageOptions<G>
  /**
   * The page's whole card list. A thunk, never a pre-computed array: sell mode
   * takes it deferred, and it is re-read after an in-session price update.
   */
  cards: Accessor<C[]>
  /** What the filters and the grouping narrow; defaults to {@link cards}. */
  filterSource?: Accessor<C[]>
  /** Cards outside `filterSource` that still count toward the page's totals. */
  valued?: ListPageValuedCards<C>
  /** Section names in display order, for section grouping. */
  sectionOrder: Accessor<string[]>
  /** The onMount seed of the session card cache from this page's baked data. */
  seed?: () => void
  currency: Accessor<PriceCurrency>
  /**
   * The build's price date. A plain value, not an accessor:
   * {@link usePublicPriceControls} takes it once at setup and always has, so an
   * accessor would promise a re-read that never happens.
   */
  pricesDate?: string
  /** Whether the site was built with sell mode on. */
  enableSellMode: Accessor<boolean>
  /** Quotes baked into the list detail; absent means quote live. */
  bakedBuylist?: Accessor<BakedBuylist | undefined>
  /** Mirror toolbar/filter state into the URL (public read view only). */
  enableUrlState: Accessor<boolean | undefined>
  /** Every list on the site, for the share filters; the page drops itself. */
  shareLists: Accessor<readonly NamedListRef[] | undefined>
  /** Names added in this session, for the tag-filter warning. */
  addedCardNames?: Accessor<string[] | undefined>
  /** The open editor's bulk-edit bundle, when the page is in edit mode. */
  bulkEdit?: Accessor<BulkEditBundle | undefined>
}

/**
 * The toolbar reads and writes `ListPageShell` wires up, with the page's
 * group-by union erased so the shell needs no type parameter. The plain state
 * passes through from {@link useToolbarState}; the derived parts are added here.
 */
export type ListPageToolbarView = Pick<
  UseToolbarStateResult<string>,
  | 'viewMode'
  | 'setViewMode'
  | 'cardSize'
  | 'setCardSize'
  | 'groupBy'
  | 'sortLayers'
  | 'setSortLayers'
  | 'reverseGroups'
  | 'setReverseGroups'
  | 'priceGroupStrategy'
  | 'setPriceGroupStrategy'
> & {
  /** Narrower than the toolbar's own setter: the shell only ever names a value. */
  setGroupBy: (value: string) => void
  /** The dropdown's options with their labels rendered in the active locale. */
  groupByOptions: Accessor<SelectOption[]>
  sortByOptions: Accessor<SelectOption<SortBy>[]>
  /** Lowercase set codes present in the list, for the set filter autocomplete. */
  setCodeOptions: Accessor<string[]>
  cardTypeOptions: Accessor<string[]>
  oracleTagOptions: Accessor<string[]>
  artTagOptions: Accessor<string[]>
  availableLabels: Accessor<readonly CardLabelSelection[]>
  /** The share filters' other lists — never this page's own. */
  shareLists: Accessor<readonly NamedListRef[]>
  /** `--card-width` for the card-sections grid. */
  cardWidth: Accessor<number>
}

/**
 * The card-type-independent state `ListPageShell` renders. Split out of
 * {@link ListPageState} so the shell needs no type parameters — a generic Solid
 * component buys nothing here and costs a render-callback contract.
 */
export type ListPageChrome = {
  selection: CardSelectionControl
  editActions: Accessor<SelectionEditActions | undefined>
  filters: CardFiltersControl
  sell: UseSellModeResult
  prices: PriceRefresh
  tooltip: UseTooltipResult
  readMenu: UseReadCardMenuResult
  toolbar: ListPageToolbarView
  /** The visible cards' total, plus `pinned` and `alsoFiltered`. */
  filteredTotalPrice: Accessor<number>
  filteredSellSummary: Accessor<SellValueSummary>
  /** The buyer's cart export, offered beside the ordinary formats in sell mode. */
  cartExportFormats: Accessor<ExtraExportFormat[]>
  /** Session-added cards carrying no tags, for the tag-filter warning. */
  untaggedAddedNames: Accessor<string[]>
  showChangelog: Accessor<boolean>
  setShowChangelog: Setter<boolean>
}

/**
 * What a page reads back. The group-by union survives inside the hook (the
 * toolbar and URL sync need it) and is erased here, so a page needs no argument.
 */
export type ListPageState<C extends CardData> = ListPageChrome & {
  /** The filtered main view — what the grouped sections render. */
  filteredCards: Accessor<C[]>
  /** {@link ListPageValuedCards.alsoFiltered}, filtered the same way. */
  filteredAlso: Accessor<C[]>
  cardGroups: Accessor<CardGroup<C>[]>
  /** Apply the page's live filters (and share context) to any card list. */
  filterVisible: <T extends CardData>(cards: T[]) => T[]
}

export function useListPage<G extends GroupBy, C extends CardData>(
  config: ListPageConfig<G, C>,
): ListPageState<C> {
  const t = useT()
  const selection = config.identity ? useCardSelection(config.identity) : config.selection
  const editActions = createMemo(() => {
    const bulk = config.bulkEdit?.()
    return bulk ? buildSelectionEditActions(bulk, selection) : undefined
  })
  const toolbar = useToolbarState<G>({
    groupBy: config.options.defaults.groupBy,
    sortBy: config.options.defaults.sortBy,
  })
  const cardFilters = useCardFilters()
  const shareContext = useShareFilterContext(cardFilters)
  // This page's own list, or null where it has no identity (the combined view).
  const listRef = (): CombinedListRef | null => {
    const identity = config.identity
    const slug = identity?.slug()
    return identity && slug ? { type: identity.kind, slug } : null
  }
  // The share filters never offer the page's own list — a card trivially
  // "shares" with the list it is on. One memo feeds the toolbar's options, the
  // URL sync's self-stripping, and the slug-switch prune below.
  const shareRefs = createMemo<ShareListsForPage | undefined>(() => {
    const ref = listRef()
    return ref ? shareListsExcluding(config.shareLists(), ref) : undefined
  })
  const otherShareLists = (): readonly NamedListRef[] =>
    shareRefs()?.others ?? config.shareLists() ?? []
  // Admin surfaces (the editors, Move Cards) keep this page mounted across slug
  // switches with URL state off, so `currentShareList` stripping never runs
  // there — a chip naming the newly opened list would survive and filter the
  // list against itself. `on` has no equality check, so the prune itself bails
  // without a store write when no chip names this list.
  createEffect(
    on(
      () => config.identity?.slug(),
      () => {
        const refs = shareRefs()
        if (refs) pruneOwnShareSelections(cardFilters, refs.selfKey)
      },
      { defer: true },
    ),
  )
  // A parameter, not a read of the live mode, for the same reason as the
  // group-by options above.
  const sortValuesFor = (sellMode: boolean): readonly SortBy[] =>
    sortByValuesFor(config.options.sortBys, sellMode)
  // A plain accessor, not a memo: `createMemo` evaluates eagerly, and `sell` is
  // declared below. Rebuilding a short array on read costs nothing.
  const groupByOptions = (): SelectOption[] =>
    config.options
      .groupByOptionsFor(sell.active())
      .map((o) => ({ value: o.value, label: t(o.label) }))
  useListViewUrlSync({
    toolbar,
    filters: cardFilters,
    defaults: config.options.defaults,
    groupByValues: config.options.groupByOptionsFor(config.enableSellMode()).map((o) => o.value),
    sortByValues: sortValuesFor(config.enableSellMode()),
    enabled: config.enableUrlState(),
    // The same chips the toolbar draws, so a `labels=` param can only ask for
    // something this page can also show and clear.
    availableLabels: config.options.availableLabels(),
    supportsSellMode: config.enableSellMode(),
    // A shared URL's share-filter params naming this page itself are stripped
    // — the page never offers its own list as an option.
    currentShareList: shareRefs()?.selfKey,
  })

  // Declared once, at setup: a page handed a baked payload never calls the quote
  // API (public site, public editor); one without it quotes live (admin editors).
  const quoteSource: QuoteSource = config.bakedBuylist
    ? { kind: 'baked', quotes: config.bakedBuylist }
    : { kind: 'live' }
  const sell = useSellMode({
    toolbar,
    supported: config.enableSellMode,
    quotes: quoteSource,
    // Deferred: the page's own card memo may read state declared below this call.
    cards: () => config.cards(),
    selected: selection.selected,
    filters: cardFilters,
    defaults: config.options.defaults,
  })
  const [showChangelog, setShowChangelog] = createSignal(false)

  const tooltip = useTooltip()
  // Read-mode ⋯ menu (cross-list lookups only); edit mode uses the editor's own menu.
  const readMenu = useReadCardMenu()

  // Seed the session cache so the card search and trade page reuse this list's
  // baked data instead of re-fetching from Scryfall.
  onMount(() => config.seed?.())

  // Wired for every render, shown only when the page opts in via
  // `enablePriceRefresh` (the public site, read-only or editing).
  const prices = usePublicPriceControls({ cards: config.cards, pricesDate: config.pricesDate })

  // Scroll to a cross-list nav target ("Find Other Printings") once cards render.
  useCardNavScroll(listRef, () => config.cards().length > 0)

  const setCodeOptions = createMemo(() => collectSetCodes(config.cards()))
  const cardTypeOptions = createMemo(() => collectCardTypes(config.cards()))
  const oracleTagOptions = createMemo(() => collectOracleTags(config.cards()))
  const artTagOptions = createMemo(() => collectArtTags(config.cards()))
  const untaggedAddedNames = createMemo(() =>
    isTagFilterActive(cardFilters.filters)
      ? untaggedAddedCardNames(config.cards(), config.addedCardNames?.() ?? [])
      : [],
  )

  const filterVisible = <T extends CardData>(cards: T[]): T[] =>
    filterCards(cards, cardFilters.filters, shareContext())

  const filterSource = (): C[] => (config.filterSource ?? config.cards)()
  const filteredCards = createMemo(() => filterVisible(filterSource()))
  const filteredAlso = createMemo(() => {
    const also = config.valued?.alsoFiltered
    return also ? filterVisible(also()) : []
  })
  // Everything the page's money figures cover, in display order. A page pinning
  // and valuing nothing extra — every flat list — gets `filteredCards()` back by
  // identity, so a keystroke in the name filter does not rebuild the list twice.
  const valuedCards = createMemo((): C[] => {
    const pinned = config.valued?.pinned?.() ?? []
    const also = filteredAlso()
    if (pinned.length === 0 && also.length === 0) return filteredCards()
    return [...pinned, ...filteredCards(), ...also]
  })
  const filteredTotalPrice = createMemo(() => groupTotalPrice(valuedCards()))

  // A plain function, not a memo: the summary below skips it entirely while sell
  // mode is off, where a memo would map the whole list on every filter change.
  // The header's buylist total and the cart export both read it, so the figure
  // always covers exactly the cards the export ships.
  const filteredSellables = (): SellableCard[] => valuedCards().map(sellableFromCardData)
  const filteredSellSummary = createSellSummary(sell.active, filteredSellables)

  // The buyer's cart for the *visible* list: the filter is part of what the user
  // is looking at, so a filtered view exports the filtered cards.
  const cartExportFormats = createMemo((): ExtraExportFormat[] => {
    const buyer = cartBuyer()
    if (!buyer) return []
    return [
      {
        label: t('site.export.buyerCart', { buyer: buyerName(buyer) }),
        extension: 'csv',
        mime: 'text/csv',
        serialize: () => {
          const cart = selectionToCartCsv(filteredSellables())
          return { content: cart.csv, warnings: cart.warnings }
        },
      },
    ]
  })

  const cardGroups = createMemo((): CardGroup<C>[] =>
    groupAndSortCards(
      filteredCards(),
      toolbar.groupBy(),
      toolbar.sortLayers(),
      config.sectionOrder(),
      toolbar.priceGroupStrategy(),
      config.currency(),
      toolbar.reverseGroups(),
    ),
  )

  // Spread, not field-by-field: the toolbar's object is accessors and setters,
  // safe to pass through unchanged; the type above is what the shell may read.
  const toolbarView: ListPageToolbarView = {
    ...toolbar,
    // Looked up rather than cast: the shell hands the toolbar a plain string, and
    // a value this page does not offer must not become its group-by.
    setGroupBy: (value) => {
      const option = config.options.groupByOptionsFor(sell.active()).find((o) => o.value === value)
      if (option) toolbar.setGroupBy(() => option.value)
    },
    groupByOptions,
    sortByOptions: () =>
      sortByOptions(sortValuesFor(sell.active()), config.options.sortByOverrides),
    setCodeOptions,
    cardTypeOptions,
    oracleTagOptions,
    artTagOptions,
    availableLabels: config.options.availableLabels,
    shareLists: otherShareLists,
    cardWidth: () => CARD_SIZE_WIDTHS[toolbar.cardSize()],
  }

  return {
    selection,
    editActions,
    filters: cardFilters,
    sell,
    prices,
    tooltip,
    readMenu,
    toolbar: toolbarView,
    filteredTotalPrice,
    filteredSellSummary,
    cartExportFormats,
    untaggedAddedNames,
    showChangelog,
    setShowChangelog,
    filteredCards,
    filteredAlso,
    cardGroups,
    filterVisible,
  }
}
