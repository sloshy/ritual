import { buylistFieldsFor } from './buylist-quotes'
import { createSellSummary, useSellMode, type QuoteSource } from './useSellMode'
import { sellableFromCardData, selectionToCartCsv, type SellableCard } from './sell-value'
import { buyerName } from '../buylist'
import { cartBuyer, type SellModeProps } from './sell-mode'
import type { Component } from 'solid-js'
import { createSignal, createMemo, onMount, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import { seedCards, seedPrintings, overlayCard, sessionCacheVersion } from './session-cache'
import { normalizeCardName } from '../term-match'
import { useT } from '../ui/i18n'
import type { MessageKey } from '../i18n/messages/en'
import { usePublicPriceControls, UpdatePricesButton } from './PriceControls'
import { PriceStalenessNotice } from './PriceStalenessNotice'
import { TagFilterWarning } from './TagFilterWarning'
import { ListPageStats, SellModeNotice } from './PageStats'
import type { ScryfallCard } from '../types'
import type { CardContextInfo } from './card-context'
import type { CollectionCardEntry } from './data-types'
import type { MetaEntry } from './meta-entry'
import {
  cardLabelName,
  effectiveLabels,
  formatCardLabels,
  labelFiltersFor,
  type CardLabel,
  type CardLabelSelection,
  type PricelessReason,
} from '../card-labels'
import { cardPriceText, cardPricelessReason, pricelessFacts } from './priceless'
import type { ChangelogPage } from '../changelog-parser'
import type { PriceCurrency } from '../price-currency'
import { getCardPriceForFinish, formatPrice } from '../price-currency'
import {
  type CardData,
  type CardGroup,
  type GroupBy,
  type SortBy,
  groupAndSortCards,
  groupTotalPrice,
  sortByOptions,
  CARD_SIZE_WIDTHS,
  SELL_GROUP_BY_OPTIONS,
  sortByValuesFor,
  type SelectOption,
} from './card-sorting'
import { collectionTradeMaxQty, collectionTradeQtyMap } from './trade-qty'
import { CardModal } from './CardModal'
import { ChangelogModal } from './ChangelogModal'
import { useCardNavScroll } from './card-nav'
import { TooltipOverlay } from './TooltipOverlay'
import { useReadCardMenu } from './useReadCardMenu'
import { finishName, rarityName } from './printing-display'
import { useTooltip } from './useTooltip'
import { Toolbar } from './Toolbar'
import { CardSection } from './CardSection'
import { useToolbarState } from './useToolbarState'
import { useListViewUrlSync } from './useListViewUrlSync'
import { useCardFilters } from './useCardFilters'
import {
  collectArtTags,
  collectCardTypes,
  collectOracleTags,
  collectSetCodes,
  filterCards,
  isTagFilterActive,
  untaggedAddedCardNames,
} from './card-filters'
import { deriveSectionOrder, sectionDefaultGroupBy } from '../section-format'
import { addEntryToLeftGuarded, canAddMoreToLeft, showTradeToast } from './useTradeState'
import type { TradeSearchEntry } from './useTradeData'
import { resolveCardThumbnailUrl, resolveCardPreview } from './image-sources'
import { useCardSelection, type SelectedCard } from './useCardSelection'
import { SelectionMenu } from './SelectionMenu'
import { buildSelectionEditActions } from './selection-edit-actions'
import type { FlatBulkEdit } from '../editor/flat-list-controller'
import { ExportMenu, type ExportFormat, type ExtraExportFormat } from './ExportMenu'
import {
  collectionToText,
  collectionToMarkdown,
  collectionToCsv,
  frontMatterFromLabels,
} from '../editor/list-export'
import { lookupPrintingCard, printingKey } from '../printing-key'
import {
  displayLanguage,
  languageDisplayName,
  storedLanguage,
  type CardLanguage,
} from '../card-language'

// Collections always have a specific printing, so 'printing' grouping does not apply.
type CollectionGroupBy = Exclude<GroupBy, 'printing'>

/**
 * Every key a group-by dropdown label may name. Narrower than `MessageKey` so
 * `t()` can render one without params, and `Extract` turns a key that no longer
 * exists in the catalog into `never` — a compile error at the table below.
 */
type GroupByMessageKey = Extract<MessageKey, `site.groupBy.${string}` | `domain.groupBy.${string}`>

/**
 * A group-by choice before its label is rendered. The `value` half is a
 * persisted URL token and stays locale-independent.
 */
type CollectionGroupByOption = { value: CollectionGroupBy; label: GroupByMessageKey }

// The sort fields this page offers, in order — shared by the toolbar's dropdown
// options and the URL sync's validation of incoming sort layers.
const COLLECTION_SORT_BYS: readonly SortBy[] = [
  'file-order',
  'name',
  'cmc',
  'price',
  'color-identity',
  'set-code',
  'edhrec',
]

/**
 * The label chips this page offers, and the `labels=` values a shared URL may
 * name here — a collection takes the whole vocabulary. Derived rather than
 * listed, and known synchronously, as {@link useListViewUrlSync} requires.
 */
const COLLECTION_LABEL_FILTERS: readonly CardLabelSelection[] = labelFiltersFor('collection')

type GroupedEntry = { entry: CollectionCardEntry; count: number }

interface CollectionPageProps extends SellModeProps {
  name: string
  /** Slug of this list, threaded into selected cards so cross-list edits can target it. */
  slug?: string
  entries: CollectionCardEntry[]
  /** Section names in display order, including empty sections. Falls back to entry order. */
  sectionOrder?: string[]
  /** The list's default card labels; entries without an override inherit these. */
  listLabels?: CardLabel[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  useScryfallImgUrls?: boolean
  totalPrice: number
  /** Show the page-header Copy/Download export menu (public read view only). */
  enableExport?: boolean
  modalCardKey: string | null
  onOpenModal: (cardKey: string) => void
  onCloseModal: () => void
  currency: PriceCurrency
  editMode?: boolean
  /** Card names added during the current edit session (edit mode only). */
  addedCardNames?: string[]
  onCardIncrement?: (entry: CollectionCardEntry) => void
  onCardDecrement?: (entry: CollectionCardEntry) => void
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
  /** Build-time price date (ISO), shipped with the collection JSON; drives staleness after a refresh. */
  pricesDate?: string
  /** Show the public "Update Prices" toolbar button + staleness notice (public site only). */
  enablePriceRefresh?: boolean
  /** Offer "Add to Trade" in the multi-select menu (public site only; the trade page is unreachable on admin). */
  enableTrade?: boolean
  /** When provided (edit mode), enables bulk edit actions in the multi-select menu. */
  bulkEdit?: FlatBulkEdit
  /** When provided (public read view), shows a "Combine with list…" header button. */
  onCombine?: () => void
  /** Mirror the toolbar/filter state into the URL query so the view is shareable (public read view only). */
  enableUrlState?: boolean
}

export const CollectionPage: Component<CollectionPageProps> = (props) => {
  const t = useT()
  const selection = useCardSelection({ kind: 'collection', name: props.name })
  const editActions = createMemo(() =>
    props.bulkEdit ? buildSelectionEditActions(props.bulkEdit, selection) : undefined,
  )
  // Section order, including any empty sections from the build/save payload; falls back to the
  // sections discovered in the entries (in file order) when not provided.
  const sectionOrder = createMemo(() => deriveSectionOrder(props.sectionOrder, props.entries))
  const hasSections = createMemo(() => sectionOrder().length >= 2)
  // `sellMode` is a parameter rather than a read of the toolbar signal so the URL
  // sync can ask for the *full* option set (what a shared link may legally name)
  // while the dropdown shows only what is currently offered.
  const groupByOptionsFor = (sellMode: boolean): CollectionGroupByOption[] => [
    ...(hasSections()
      ? [{ value: 'section' as const, label: 'site.groupBy.section' as const }]
      : []),
    { value: 'type', label: 'site.groupBy.type' },
    { value: 'cmc', label: 'site.groupBy.cmc' },
    { value: 'color-identity', label: 'site.groupBy.colorIdentity' },
    { value: 'price', label: 'site.groupBy.price' },
    ...(sellMode ? SELL_GROUP_BY_OPTIONS : []),
    { value: 'none', label: 'site.groupBy.none' },
  ]
  // A plain accessor, not a memo: `createMemo` evaluates eagerly, and `sell` is
  // declared below. Rebuilding a seven-element array on read costs nothing.
  const groupByOptions = (): SelectOption<CollectionGroupBy>[] =>
    groupByOptionsFor(sell.active()).map((option) => ({
      value: option.value,
      label: t(option.label),
    }))
  // A parameter, not a read of the live mode, for the same reason as the
  // group-by options: the URL sync validates against the full set a shared
  // link may name, while the dropdown offers only what is currently on.
  const sortValuesFor = (sellMode: boolean): readonly SortBy[] =>
    sortByValuesFor(COLLECTION_SORT_BYS, sellMode)

  // Intentional one-time seed for the toolbar's group-by signal (read once at construction;
  // it must not fight the user's later toolbar changes). The editor remounts these pages on
  // each load, so a stale seed is not reachable.
  const initialGroupBy: CollectionGroupBy = sectionDefaultGroupBy(props.entries)

  const toolbar = useToolbarState<CollectionGroupBy>({
    groupBy: initialGroupBy,
    sortBy: 'file-order',
  })
  const {
    viewMode,
    setViewMode,
    cardSize,
    setCardSize,
    groupBy,
    setGroupBy,
    sortLayers,
    setSortLayers,
    reverseGroups,
    setReverseGroups,
    priceGroupStrategy,
    setPriceGroupStrategy,
  } = toolbar
  const cardFilters = useCardFilters()
  useListViewUrlSync({
    toolbar,
    filters: cardFilters,
    defaults: { groupBy: initialGroupBy, sortBy: 'file-order' },
    groupByValues: groupByOptionsFor(Boolean(props.enableSellMode)).map((o) => o.value),
    sortByValues: sortValuesFor(Boolean(props.enableSellMode)),
    enabled: props.enableUrlState,
    availableLabels: COLLECTION_LABEL_FILTERS,
    supportsSellMode: Boolean(props.enableSellMode),
  })

  // Declared once, at setup: a page handed a baked payload never calls the quote
  // API (the public site and the public editor), and one without it quotes live
  // against a credentialed API (the admin editors). Making the choice explicit
  // keeps a call site from silently landing on the path it did not mean.
  const quoteSource: QuoteSource = props.bakedBuylist
    ? { kind: 'baked', quotes: props.bakedBuylist }
    : { kind: 'live' }
  const sell = useSellMode({
    toolbar,
    supported: () => Boolean(props.enableSellMode),
    quotes: quoteSource,
    // Deferred: `allCards` is declared below this call.
    cards: () => allCards(),
    selected: selection.selected,
    filters: cardFilters,
    defaults: { groupBy: initialGroupBy, sortBy: 'file-order' },
  })
  const [groupDuplicates, setGroupDuplicates] = createSignal(false)
  const [showChangelog, setShowChangelog] = createSignal(false)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  // Read-mode ⋯ menu (cross-list lookups only); edit mode uses the editor's own menu.
  const readMenu = useReadCardMenu()

  /**
   * The entry's language as a variant dimension, folded so a bare line and an
   * explicit `en` agree; `undefined` display value means "no badge".
   */
  const entryLanguage = (entry: CollectionCardEntry): CardLanguage | undefined =>
    storedLanguage(entry.language)

  /**
   * The card object an entry *displays*: the `@lang` object for a non-en entry
   * when the build baked one, else the printing's default-language object.
   * Pricing deliberately does not use this — an entry prices from its printing's
   * default object regardless of language (see `currencyEntries`).
   */
  const entryCard = (entry: CollectionCardEntry): ScryfallCard | null =>
    overlayCard(lookupPrintingCard(props.cards, entry))

  // Aggregate copy counts per card variant for correct trade maxQty. Shared with
  // the combined view, which caps its unmerged tiles from the same groups.
  const collectionQtyMap = createMemo(() => collectionTradeQtyMap(props.entries))

  /** An entry's effective labels: its own override, else the list default. */
  const entryLabels = (entry: CollectionCardEntry): CardLabel[] =>
    effectiveLabels(entry.labels, props.listLabels)

  /**
   * Whether this copy carries no price by rule — a proxy (not a real card) or a
   * copy wearing custom art (not the printing a price would be for).
   */
  const entryPricelessReason = (entry: CollectionCardEntry): PricelessReason | undefined =>
    cardPricelessReason(pricelessFacts(entry, entryLabels(entry)))

  /**
   * The price cell's text for an entry: the marker when the copy carries no
   * price by rule, the formatted amount otherwise. "$0.00" would read as a
   * price rather than as the refusal to quote one.
   */
  const entryPriceText = (entry: CollectionCardEntry): string =>
    cardPriceText(t, pricelessFacts(entry, entryLabels(entry)), entry.price, props.currency)

  /**
   * Identity of a tile when grouping duplicates: printing + condition plus the
   * raw label override and the copy's custom art — both join the key so a
   * keep-marked or custom-art copy never merges into (and mislabels, or
   * zero-prices) a stack of otherwise-identical tradable copies. The art joins
   * it as the *fact* as well as the URL: a copy whose art file was not deployed
   * has no URL to tell it apart from a plain one, and merging the two would
   * price the priceless copy at retail. Shared by the grouped `allCards`
   * builder and `groupCardIds`, so a tile's card IDs are exactly the entries it
   * visually represents.
   */
  const duplicateGroupKey = (entry: CollectionCardEntry): string =>
    `${entry.name}|${entry.set}|${entry.collectorNumber}|${entry.finish}|${entry.condition}|${displayLanguage(entry.language)}|${formatCardLabels(entry.labels ?? [])}|${entry.customArt ?? ''}|${entry.hasCustomArt === true ? 'art' : ''}`

  const buildCollectionSearchEntry = (
    entry: CollectionCardEntry,
    scryfallCard: ScryfallCard | null,
  ): TradeSearchEntry => {
    const maxQty = collectionTradeMaxQty(entry, collectionQtyMap())
    const labels = entryLabels(entry)
    return {
      name: entry.name,
      nameKey: normalizeCardName(entry.name),
      set: entry.set.toLowerCase(),
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      language: entryLanguage(entry),
      labels: labels.length > 0 ? labels : undefined,
      customArt: entry.customArt,
      hasCustomArt: entry.hasCustomArt,
      note: entry.note,
      price: entry.price,
      scryfallCard,
      sourceName: props.name,
      sourceKind: 'collection',
      maxQty,
      cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
    }
  }

  const handleCollectionAddToTrade = async (entry: CollectionCardEntry) => {
    const scryfallCard = entryCard(entry)
    const searchEntry = buildCollectionSearchEntry(entry, scryfallCard)
    // Guarded: a keep-labeled card confirms once before its first trade add.
    // This one handler covers both the tile "+ Trade" button and the card modal.
    const added = await addEntryToLeftGuarded(searchEntry, props.currency)
    if (added)
      showTradeToast(
        searchEntry.name,
        resolveCardThumbnailUrl(scryfallCard, props.useScryfallImgUrls ?? false),
      )
  }

  const isCollectionCardAddDisabled = (entry: CollectionCardEntry): boolean => {
    const searchEntry = buildCollectionSearchEntry(entry, entryCard(entry))
    return !canAddMoreToLeft(searchEntry)
  }

  const currencyEntries = createMemo((): CollectionCardEntry[] => {
    sessionCacheVersion() // re-price after an in-session "Update Prices"
    return props.entries.map((entry) => {
      const cardKey = printingKey(entry.set, entry.collectorNumber)
      const card = overlayCard(props.cards[cardKey] ?? null)
      if (!card) return entry
      // A proxy and a custom-art copy price at 0 in every currency — the same
      // rule the bake and the price report apply, restated here because this
      // recompute replaces the baked figure whenever the currency changes or
      // prices are refreshed.
      const price =
        entryPricelessReason(entry) !== undefined
          ? 0
          : getCardPriceForFinish(card, entry.finish, props.currency)
      return { ...entry, price }
    })
  })

  const computedTotalPrice = createMemo(() => {
    return currencyEntries().reduce((sum, e) => sum + e.price, 0)
  })

  // Build flat card list from entries. The displayed card is language-resolved
  // (a `[ja]` entry shows its ja scan when baked); the price stays the one
  // `currencyEntries` computed from the printing's default-language object.
  const toCardData = (entry: CollectionCardEntry, quantity: number): CardData => {
    const card = entryCard(entry)
    const labels = entryLabels(entry)
    return {
      name: entry.name,
      quantity,
      cmc: card?.cmc ?? 0,
      edhrec: card?.edhrec_rank ?? 999999,
      price: entry.price,
      type: card?.type_line ?? '',
      section: entry.section,
      fileOrder: entry.fileOrder,
      // Lowercased like the identical builder in `combined-list.ts`. Paired with
      // `entryIndexMap` below, which keys on the same value.
      setCode: entry.set.toLowerCase(),
      colorIdentity: card?.color_identity ?? [],
      hasPrinting: true,
      oracleTags: card?.oracleTags ?? [],
      artTags: card?.artTags ?? [],
      labels,
      customArt: entry.customArt,
      hasCustomArt: entry.hasCustomArt,
      finish: entry.finish,
      language: entryLanguage(entry),
      ...buylistFieldsFor(card, entry.finish, entry.language, pricelessFacts(entry, labels)),
      card,
    }
  }

  const allCards = createMemo((): CardData[] => {
    if (groupDuplicates()) {
      const grouped = new Map<string, GroupedEntry>()
      for (const entry of currencyEntries()) {
        const key = duplicateGroupKey(entry)
        const existing = grouped.get(key)
        if (existing) existing.count++
        else grouped.set(key, { entry, count: 1 })
      }
      return [...grouped.values()].map(({ entry, count }) => toCardData(entry, count))
    }
    return currencyEntries().map((entry) => toCardData(entry, 1))
  })

  // Seed the session cache from this collection's baked card data so the editor's
  // card search and the trade page reuse it instead of re-fetching from Scryfall.
  onMount(() => {
    seedCards(props.cards)
    seedPrintings(props.printings)
  })

  // Price refresh is wired for every render but only shown when `enablePriceRefresh`.
  const prices = usePublicPriceControls({ cards: allCards, pricesDate: props.pricesDate })

  // Scroll to a cross-list navigation target (e.g. from "Find Other Printings")
  // once the collection's cards are rendered.
  useCardNavScroll(
    () => (props.slug ? { type: 'collection', slug: props.slug } : null),
    () => allCards().length > 0,
  )

  const setCodeOptions = createMemo(() => collectSetCodes(allCards()))
  const cardTypeOptions = createMemo(() => collectCardTypes(allCards()))
  const oracleTagOptions = createMemo(() => collectOracleTags(allCards()))
  const artTagOptions = createMemo(() => collectArtTags(allCards()))
  const untaggedAddedNames = createMemo(() =>
    isTagFilterActive(cardFilters.filters)
      ? untaggedAddedCardNames(allCards(), props.addedCardNames ?? [])
      : [],
  )

  const filteredCards = createMemo(() => filterCards(allCards(), cardFilters.filters))

  const filteredTotalPrice = createMemo(() => groupTotalPrice(filteredCards()))

  /**
   * The filtered view as sellable cards. A plain function, not a memo: the
   * buylist summary below skips it entirely while sell mode is off, and a hot
   * memo would map the whole list on every filter change regardless. Both the
   * header's buylist total and the cart export read it, so the figure the header
   * promises always covers exactly the cards the export ships.
   */
  const filteredSellables = (): SellableCard[] => filteredCards().map(sellableFromCardData)

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

  const cardGroups = createMemo((): CardGroup[] => {
    return groupAndSortCards(
      filteredCards(),
      groupBy(),
      sortLayers(),
      sectionOrder(),
      priceGroupStrategy(),
      props.currency,
      reverseGroups(),
    )
  })

  // Find the modal entry and card
  const modalEntry = createMemo((): CollectionCardEntry | null => {
    if (!props.modalCardKey) return null
    const idx = parseInt(props.modalCardKey, 10)
    if (!isNaN(idx) && currencyEntries()[idx]) return currencyEntries()[idx] ?? null
    return null
  })

  // Language-resolved like the tiles, so a `[ja]` entry's modal shows the ja scan.
  const modalCard = createMemo((): ScryfallCard | null => {
    const entry = modalEntry()
    if (!entry) return null
    return entryCard(entry)
  })

  const modalAddToTrade = createMemo(() => {
    const entry = modalEntry()
    if (!entry || props.editMode || props.onCardMove) return undefined
    return () => void handleCollectionAddToTrade(entry)
  })

  const modalAddToTradeDisabled = createMemo(() => {
    const entry = modalEntry()
    if (!entry) return true
    return isCollectionCardAddDisabled(entry)
  })

  // Pre-computed index map for O(1) entry lookups (avoids O(n²) on large collections)
  const entryIndexMap = createMemo(() => {
    const map = new Map<string, number>()
    currencyEntries().forEach((e, i) => {
      map.set(`${e.name}|${e.set.toLowerCase()}|${e.fileOrder}`, i)
    })
    return map
  })

  const findEntryIndex = (cardData: CardData): number => {
    return entryIndexMap().get(`${cardData.name}|${cardData.setCode}|${cardData.fileOrder}`) ?? -1
  }

  // All card IDs a tile represents: every entry sharing the grouped tile's
  // duplicateGroupKey (or just the single entry when not grouping).
  const groupCardIds = (entry: CollectionCardEntry): number[] => {
    if (!groupDuplicates()) {
      return entry.cardId !== undefined ? [entry.cardId] : []
    }
    const key = duplicateGroupKey(entry)
    return currencyEntries()
      .filter((e) => duplicateGroupKey(e) === key)
      .map((e) => e.cardId)
      .filter((id): id is number => id !== undefined)
  }

  const renderCollectionCard = (c: CardData) => {
    const entryIdx = findEntryIndex(c)
    const entry = currencyEntries()[entryIdx]
    const showTrade = !props.editMode && !props.onCardMove && entry !== undefined
    const selectKey = String(entryIdx)
    const buildSelected = (): SelectedCard => {
      const preview = resolveCardPreview(c.card, Boolean(props.useScryfallImgUrls), c.customArt)
      return {
        key: selectKey,
        name: c.name,
        set: entry?.set.toLowerCase(),
        collectorNumber: entry?.collectorNumber,
        finish: entry?.finish,
        condition: entry?.condition,
        language: entry ? entryLanguage(entry) : undefined,
        labels: entry ? entryLabels(entry) : undefined,
        customArt: c.customArt,
        hasCustomArt: c.hasCustomArt,
        note: entry?.note,
        quantity: c.quantity,
        groupSize: c.quantity,
        price: c.price,
        scryfallCard: c.card,
        image: preview.image || undefined,
        sideways: preview.sideways,
        sourceName: props.name,
        sourceSlug: props.slug,
        sourceKind: 'collection',
        maxQty: c.quantity,
        cardIds: entry ? groupCardIds(entry) : [],
      }
    }
    const contextInfo = (): CardContextInfo => ({
      cardName: c.name,
      card: c.card,
      cardIds: entry ? groupCardIds(entry) : [],
      quantity: c.quantity,
      set: entry?.set,
      collectorNumber: entry?.collectorNumber,
      finish: entry?.finish,
      condition: entry?.condition,
    })
    return (
      <CardItem
        name={c.name}
        quantity={c.quantity}
        card={c.card}
        customArt={c.customArt}
        symbolMap={props.symbolMap}
        buylistPrice={c.buylistPrice}
        viewMode={viewMode()}
        hideCount={!groupDuplicates()}
        useScryfallImgUrls={props.useScryfallImgUrls}
        onCardClick={() => props.onOpenModal(String(entryIdx))}
        onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
        onTooltipLeave={() => setTooltip(null)}
        collectionFinish={entry?.finish}
        collectionCondition={entry?.condition}
        collectionLanguage={entry ? entryLanguage(entry) : undefined}
        collectionSetCN={entry ? `${entry.set.toUpperCase()}:${entry.collectorNumber}` : undefined}
        collectionPrice={entry?.price}
        labelBadges={entry?.labels}
        priceless={cardPricelessReason(c)}
        currency={props.currency}
        cardId={entry?.cardId}
        editMode={props.editMode}
        onIncrement={props.editMode && entry ? () => props.onCardIncrement?.(entry) : undefined}
        onDecrement={props.editMode && entry ? () => props.onCardDecrement?.(entry) : undefined}
        onContextMenu={
          props.editMode
            ? (rect) => props.onCardContextMenu?.(contextInfo(), rect)
            : !props.onCardMove && readMenu.enabled()
              ? (rect) => readMenu.open(contextInfo(), rect)
              : undefined
        }
        onMove={props.onCardMove ? (rect) => props.onCardMove!(contextInfo(), rect) : undefined}
        onAddToTrade={showTrade ? () => void handleCollectionAddToTrade(entry) : undefined}
        addToTradeDisabled={showTrade ? isCollectionCardAddDisabled(entry) : undefined}
        selectable={entry !== undefined}
        selectState={selection.state(selectKey)}
        onToggleSelect={() => selection.toggle(buildSelected())}
      />
    )
  }

  const modalMeta = createMemo(() => {
    if (!modalEntry() || !modalCard()) return undefined
    const entry = modalEntry()!
    const card = modalCard()!
    const parts: MetaEntry[] = []
    parts.push({ label: 'price', value: entryPriceText(entry) })
    parts.push({
      label: 'set',
      value: `${entry.set.toUpperCase()}:${entry.collectorNumber}`,
    })
    if (entry.finish) {
      parts.push({
        label: 'finish',
        value: finishName(t, entry.finish),
      })
    }
    if (entry.condition) {
      parts.push({ label: 'condition', value: entry.condition })
    }
    const language = entryLanguage(entry)
    if (language) {
      parts.push({ label: 'language', value: languageDisplayName(language) })
    }
    // The modal is the full-truth view, so it shows the *effective* labels —
    // inherited defaults included — unlike the tiles, which badge overrides only.
    const labels = entryLabels(entry)
    if (labels.length > 0) {
      parts.push({
        label: 'labels',
        value: labels.map(cardLabelName).join(' · '),
      })
    }
    parts.push({
      label: 'rarity',
      value: rarityName(t, card.rarity),
    })
    return parts
  })

  const modalPrintings = createMemo(() =>
    modalEntry() ? (props.printings[modalEntry()!.name] ?? []) : [],
  )

  const serializeCollection = (format: ExportFormat): string => {
    switch (format) {
      case 'txt':
        return collectionToText(props.entries)
      case 'md':
        return collectionToMarkdown(
          props.name,
          props.entries,
          sectionOrder(),
          frontMatterFromLabels(props.listLabels),
        )
      case 'csv':
        return collectionToCsv(props.entries)
    }
  }

  return (
    <div
      class={
        (props.fullWidth ?? (props.editMode || props.onCardMove))
          ? 'page-full-width'
          : 'page-container'
      }
    >
      {/* Header */}
      <div class="page-header">
        <div>
          <h1 class="page-title">{props.name}</h1>
          <p class="page-stats">
            {t('site.stats.cardsAndTotal', {
              count: props.entries.length,
              amount: formatPrice(computedTotalPrice(), props.currency),
            })}
            <ListPageStats
              filters={cardFilters}
              currency={props.currency}
              filteredAmount={filteredTotalPrice()}
              selectedCount={selection.count()}
              selectedAmount={selection.value(props.currency)}
              sellMode={sell.active()}
              buylistSummary={filteredSellSummary()}
              selectionSummary={sell.summary()}
            />
          </p>
          <SellModeNotice sellMode={sell.active()} />
        </div>
        <Show
          when={
            props.onCombine ||
            props.enableExport ||
            (props.changelog && props.changelog.length > 0) ||
            props.enablePriceRefresh
          }
        >
          <div class="btn-group">
            <Show when={props.onCombine}>
              <button onClick={() => props.onCombine!()} class="btn btn-secondary">
                {t('site.page.combineWithList')}
              </button>
            </Show>
            <Show when={props.changelog && props.changelog.length > 0}>
              <button
                onClick={() => setShowChangelog(true)}
                class="btn btn-secondary btn-view-changes"
              >
                {t('site.page.viewChanges')}
              </button>
            </Show>
            <Show when={props.enableExport}>
              <ExportMenu
                serialize={serializeCollection}
                name={props.name}
                extraFormats={cartExportFormats()}
              />
            </Show>
            <Show when={props.enablePriceRefresh}>
              <UpdatePricesButton prices={prices} />
            </Show>
          </div>
        </Show>
      </div>
      <Toolbar
        viewMode={viewMode()}
        onViewModeChange={setViewMode}
        cardSize={cardSize()}
        onCardSizeChange={setCardSize}
        groupBy={groupBy()}
        groupByOptions={groupByOptions()}
        onGroupByChange={(v) => setGroupBy(v as CollectionGroupBy)}
        sortLayers={sortLayers()}
        sortByOptions={sortByOptions(sortValuesFor(sell.active()))}
        onSortLayersChange={setSortLayers}
        priceGroupStrategy={priceGroupStrategy()}
        onPriceGroupStrategyChange={setPriceGroupStrategy}
        reverseGroups={reverseGroups()}
        onReverseGroupsChange={() => setReverseGroups((prev) => !prev)}
        sell={sell.control()}
        filters={cardFilters}
        symbolMap={props.symbolMap}
        currency={props.currency}
        setCodeOptions={setCodeOptions()}
        cardTypeOptions={cardTypeOptions()}
        oracleTagOptions={oracleTagOptions()}
        artTagOptions={artTagOptions()}
        showLabelsFilter={COLLECTION_LABEL_FILTERS.length > 0}
        availableLabels={COLLECTION_LABEL_FILTERS}
        extraToggles={[
          {
            label: t('site.collection.groupDuplicates'),
            checked: groupDuplicates(),
            onChange: () => setGroupDuplicates((prev) => !prev),
          },
        ]}
        selectionMenu={
          <SelectionMenu
            selection={selection}
            currency={props.currency}
            enableTrade={props.enableTrade}
            useScryfallImgUrls={props.useScryfallImgUrls}
            editActions={editActions()}
            dockOnTouch
          />
        }
      />

      <Show when={props.enablePriceRefresh}>
        <PriceStalenessNotice outdatedNames={prices.outdatedNames()} />
      </Show>
      <TagFilterWarning untaggedCardNames={untaggedAddedNames()} />

      {/* Card sections */}
      <div
        class={`card-sections view-${viewMode()}`}
        style={`--card-width:${CARD_SIZE_WIDTHS[cardSize()]}px`}
      >
        <For each={cardGroups()}>
          {(group) => (
            <CardSection
              label={group.key}
              cards={group.cards}
              currency={props.currency}
              renderCard={renderCollectionCard}
            />
          )}
        </For>
      </div>

      {/* List-view hover tooltip */}
      <TooltipOverlay tooltip={tooltip()} pos={tooltipPos()} tooltipRef={tooltipRef} />

      {/* Read-mode card ⋯ menu */}
      {readMenu.element()}

      {/* Card detail modal */}
      <CardModal
        open={Boolean(modalCard())}
        card={modalCard()}
        customArt={modalEntry()?.customArt}
        hasCustomArt={modalEntry()?.hasCustomArt}
        cardName={modalEntry()?.name ?? null}
        symbolMap={props.symbolMap}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency}
        printings={modalPrintings()}
        onClose={props.onCloseModal}
        meta={modalMeta()}
        note={modalEntry()?.note}
        onAddToTrade={modalAddToTrade()}
        addToTradeDisabled={modalAddToTradeDisabled()}
      />

      {/* Changelog modal */}
      <Show when={props.changelog && props.changelog.length > 0}>
        <ChangelogModal
          open={showChangelog()}
          changelog={props.changelog!}
          cards={props.cards}
          printings={props.printings}
          symbolMap={props.symbolMap}
          useScryfallImgUrls={props.useScryfallImgUrls}
          currency={props.currency}
          onClose={() => setShowChangelog(false)}
        />
      </Show>
    </div>
  )
}
