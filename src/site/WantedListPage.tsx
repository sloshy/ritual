import { buylistFieldsFor } from './buylist-quotes'
import { createSellSummary, useSellMode, type QuoteSource } from './useSellMode'
import { sellableFromCardData, selectionToCartCsv, type SellableCard } from './sell-value'
import { buyerName } from '../buylist'
import { cartBuyer, type SellModeProps } from './sell-mode'
import type { Component } from 'solid-js'
import { createSignal, createMemo, onMount, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import { seedCards, seedPrintings, sessionCacheVersion } from './session-cache'
import { normalizeCardName } from '../term-match'
import { useT } from '../ui/i18n'
import type { MessageKey } from '../i18n/messages/en'
import { displayFinish } from '../finish-condition'
import { storedLanguage } from '../card-language'
import { usePublicPriceControls, UpdatePricesButton } from './PriceControls'
import { PriceStalenessNotice } from './PriceStalenessNotice'
import { TagFilterWarning } from './TagFilterWarning'
import { ListPageStats, PageCountAndTotal, SellModeNotice } from './PageStats'
import type { ScryfallCard, Finish } from '../types'
import type { CardContextInfo } from './card-context'
import type { CardKingdomCards, WantedListCardEntry } from './data-types'
import type { ChangelogPage } from '../changelog-parser'
import type { PriceCurrency } from '../price-currency'
import { pricesEnabled, sitePriceForFinish } from './price-view'
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
import { labelFiltersFor } from '../card-labels'
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
import { TradePrintingPicker } from './TradePrintingPicker'
import { addEntryToRight, canAddMoreToRight, showTradeToast } from './useTradeState'
import type { TradeSearchEntry } from './useTradeData'
import { resolveCardThumbnailUrl, resolveCardPreview } from './image-sources'
import { hasSpecificPrinting } from '../card-printing'
import { resolveWantedCardEntry } from './resolve-card'
import type { SourceCardMaps } from './source-cards'
import { cardPriceText, cardPricelessReason, isPricelessCard, pricelessFacts } from './priceless'
import { useCardSelection, type SelectedCard } from './useCardSelection'
import { SelectionMenu } from './SelectionMenu'
import { buildSelectionEditActions } from './selection-edit-actions'
import type { FlatBulkEdit } from '../editor/flat-list-controller'
import { ExportMenu, type ExportFormat, type ExtraExportFormat } from './ExportMenu'
import { wantedToText, wantedToMarkdown, wantedToCsv } from '../editor/list-export'
import type { MetaEntry } from './meta-entry'

type WantedListGroupBy = GroupBy

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
type WantedGroupByOption = { value: WantedListGroupBy; label: GroupByMessageKey }

// The sort fields this page offers, in order — shared by the toolbar's dropdown
// options and the URL sync's validation of incoming sort layers.
const WANTED_SORT_BYS: readonly SortBy[] = [
  'file-order',
  'name',
  'cmc',
  'price',
  'color-identity',
  'set-code',
  'edhrec',
]
type WantedTradePicker = {
  cardName: string
  printings: ScryfallCard[]
  wantedEntry: WantedListCardEntry
}

interface WantedListPageProps extends SellModeProps {
  name: string
  /** Slug of this list, threaded into selected cards so cross-list edits can target it. */
  slug?: string
  entries: WantedListCardEntry[]
  /** Section names in display order, including empty sections. Falls back to entry order. */
  sectionOrder?: string[]
  cards: Record<string, ScryfallCard | null>
  /** Card Kingdom's picks for the name-only entries, read under the CK source. */
  cardsCardKingdom?: CardKingdomCards
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
  onCardIncrement?: (entry: WantedListCardEntry) => void
  onCardDecrement?: (entry: WantedListCardEntry) => void
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
  /** Build-time price date (ISO), shipped with the wanted-list JSON; drives staleness after a refresh. */
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

export const WantedListPage: Component<WantedListPageProps> = (props) => {
  const t = useT()
  const selection = useCardSelection({ kind: 'wanted', name: props.name })
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
  const groupByOptionsFor = (sellMode: boolean): WantedGroupByOption[] => [
    ...(hasSections()
      ? [{ value: 'section' as const, label: 'site.groupBy.section' as const }]
      : []),
    { value: 'type', label: 'site.groupBy.type' },
    { value: 'cmc', label: 'site.groupBy.cmc' },
    { value: 'color-identity', label: 'site.groupBy.colorIdentity' },
    { value: 'price', label: 'site.groupBy.price' },
    { value: 'printing', label: 'site.groupBy.printing' },
    ...(sellMode ? SELL_GROUP_BY_OPTIONS : []),
    { value: 'none', label: 'site.groupBy.none' },
  ]
  // A plain accessor, not a memo: `createMemo` evaluates eagerly, and `sell` is
  // declared below. Rebuilding a seven-element array on read costs nothing.
  const groupByOptions = (): SelectOption<WantedListGroupBy>[] =>
    groupByOptionsFor(sell.active()).map((option) => ({
      value: option.value,
      label: t(option.label),
    }))
  // A parameter, not a read of the live mode, for the same reason as the
  // group-by options: the URL sync validates against the full set a shared
  // link may name, while the dropdown offers only what is currently on.
  const sortValuesFor = (sellMode: boolean): readonly SortBy[] =>
    sortByValuesFor(WANTED_SORT_BYS, sellMode)

  // Intentional one-time seed for the toolbar's group-by signal (read once at construction;
  // it must not fight the user's later toolbar changes). The editor remounts these pages on
  // each load, so a stale seed is not reachable.
  const initialGroupBy: WantedListGroupBy = sectionDefaultGroupBy(props.entries)

  const toolbar = useToolbarState<WantedListGroupBy>({
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
    // Wanted-list entries carry no labels at all, so every `labels=` value a
    // pasted link brings is dropped rather than filtering the page to nothing.
    availableLabels: labelFiltersFor('wanted'),
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
  const [showChangelog, setShowChangelog] = createSignal(false)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  // Read-mode ⋯ menu (cross-list lookups only); edit mode uses the editor's own menu.
  const readMenu = useReadCardMenu()

  const [wantedTradePicker, setWantedTradePicker] = createSignal<WantedTradePicker | null>(null)

  const buildWantedSearchEntry = (
    entry: WantedListCardEntry,
    scryfallCard: ScryfallCard | null,
  ): TradeSearchEntry => ({
    name: entry.name,
    nameKey: normalizeCardName(entry.name),
    set: entry.set?.toLowerCase(),
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    // The row shows the real printing — it is the card being asked for — but a
    // copy wearing art of its own carries no price, so the rule travels with it.
    customArt: entry.customArt,
    hasCustomArt: entry.hasCustomArt,
    note: entry.note,
    price: entry.price,
    scryfallCard,
    sourceName: props.name,
    sourceKind: 'wanted',
    maxQty: 1,
    cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
  })

  const handleWantedAddToTrade = (
    entry: WantedListCardEntry,
    scryfallCard: ScryfallCard | null,
  ) => {
    if (!hasSpecificPrinting(entry)) {
      setWantedTradePicker({
        cardName: entry.name,
        printings: props.printings[entry.name] ?? [],
        wantedEntry: entry,
      })
      return
    }
    const searchEntry = buildWantedSearchEntry(entry, scryfallCard)
    const added = addEntryToRight(searchEntry, props.currency)
    if (added)
      showTradeToast(
        searchEntry.name,
        resolveCardThumbnailUrl(scryfallCard, props.useScryfallImgUrls ?? false),
      )
  }

  const handleWantedTradePickerSelect = (printing: ScryfallCard, finish: Finish) => {
    const picker = wantedTradePicker()
    if (!picker) return
    const searchEntry: TradeSearchEntry = {
      name: printing.name,
      nameKey: normalizeCardName(printing.name),
      set: printing.set.toLowerCase(),
      collectorNumber: printing.collector_number,
      finish,
      scryfallCard: printing,
      sourceName: props.name,
      sourceKind: 'wanted',
      maxQty: 1,
      cardIds: picker.wantedEntry.cardId !== undefined ? [picker.wantedEntry.cardId] : [],
    }
    const added = addEntryToRight(searchEntry, props.currency)
    setWantedTradePicker(null)
    if (added)
      showTradeToast(
        searchEntry.name,
        resolveCardThumbnailUrl(searchEntry.scryfallCard, props.useScryfallImgUrls ?? false),
      )
  }

  const isWantedCardAddDisabled = (
    entry: WantedListCardEntry,
    scryfallCard: ScryfallCard | null,
  ): boolean => {
    if (!hasSpecificPrinting(entry)) return false
    const searchEntry = buildWantedSearchEntry(entry, scryfallCard)
    return !canAddMoreToRight(searchEntry)
  }

  /**
   * The card maps every entry resolves against — one object, rebuilt only when
   * the currency or the baked maps change, rather than per entry per pass.
   */
  const cardMaps = createMemo(
    (): SourceCardMaps => ({
      cards: props.cards,
      cardKingdom: props.cardsCardKingdom,
      currency: props.currency,
    }),
  )

  const currencyEntries = createMemo((): WantedListCardEntry[] => {
    sessionCacheVersion() // re-price after an in-session "Update Prices"
    return props.entries.map((entry) => {
      const card = resolveWantedCardEntry(entry, cardMaps())
      if (!card) return entry

      // A copy wearing custom art is not the printing a price would be for, so
      // it prices at nothing — the same rule the bake applies. (Wanted lines
      // carry no labels, so custom art is the only way one can be priceless.)
      //
      // An entry with no finish token is read at the printing's default finish,
      // not flatly as nonfoil: a foil-only printing has no nonfoil price to quote.
      const price = isPricelessCard(pricelessFacts(entry))
        ? 0
        : sitePriceForFinish(card, displayFinish(card, entry.finish), props.currency)
      return { ...entry, price }
    })
  })

  const computedTotalPrice = createMemo(() => {
    return currencyEntries().reduce((sum, e) => sum + e.price, 0)
  })

  const allCards = createMemo((): CardData[] => {
    return currencyEntries().map((entry) => {
      const card = resolveWantedCardEntry(entry, cardMaps())
      return {
        name: entry.name,
        quantity: 1,
        cmc: card?.cmc ?? 0,
        edhrec: card?.edhrec_rank ?? 999999,
        price: entry.price,
        type: card?.type_line ?? '',
        section: entry.section,
        fileOrder: entry.fileOrder,
        setCode: entry.set ?? '',
        colorIdentity: card?.color_identity ?? [],
        hasPrinting: hasSpecificPrinting(entry),
        oracleTags: card?.oracleTags ?? [],
        artTags: card?.artTags ?? [],
        labels: [],
        customArt: entry.customArt,
        hasCustomArt: entry.hasCustomArt,
        finish: entry.finish,
        language: storedLanguage(entry.language),
        // Wanted lines carry no labels, so their art is the only way one can be
        // priceless — and the sidecar fact, not the display URL, is what says so.
        ...buylistFieldsFor(card, entry.finish, entry.language, pricelessFacts(entry)),
        card,
      }
    })
  })

  // Seed the session cache from this list's baked card data so the editor's card
  // search and the trade page reuse it instead of re-fetching from Scryfall.
  onMount(() => {
    seedCards(props.cards)
    seedPrintings(props.printings)
    if (props.cardsCardKingdom) seedCards(props.cardsCardKingdom)
  })

  // Price refresh is wired for every render but only shown when `enablePriceRefresh`.
  const prices = usePublicPriceControls({ cards: allCards, pricesDate: props.pricesDate })

  // Scroll to a cross-list navigation target (e.g. from "Find Other Printings")
  // once the wanted list's cards are rendered.
  useCardNavScroll(
    () => (props.slug ? { type: 'wanted', slug: props.slug } : null),
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

  const modalEntry = createMemo((): WantedListCardEntry | null => {
    if (!props.modalCardKey) return null
    const idx = parseInt(props.modalCardKey, 10)
    if (!isNaN(idx) && currencyEntries()[idx]) return currencyEntries()[idx] ?? null
    return null
  })

  const modalCard = createMemo((): ScryfallCard | null => {
    if (!modalEntry()) return null
    return resolveWantedCardEntry(modalEntry()!, cardMaps())
  })

  const modalAddToTrade = createMemo(() => {
    const entry = modalEntry()
    if (!entry || props.editMode || props.onCardMove) return undefined
    const scryfallCard = modalCard()
    return () => handleWantedAddToTrade(entry, scryfallCard)
  })

  const modalAddToTradeDisabled = createMemo(() => {
    const entry = modalEntry()
    if (!entry || !hasSpecificPrinting(entry)) return false
    const scryfallCard = modalCard()
    return isWantedCardAddDisabled(entry, scryfallCard)
  })

  const entryIndexMap = createMemo(() => {
    const map = new Map<string, number>()
    currencyEntries().forEach((e, i) => {
      map.set(`${e.name}|${e.set ?? ''}|${e.fileOrder}`, i)
    })
    return map
  })

  const findEntryIndex = (cardData: CardData): number => {
    return (
      entryIndexMap().get(`${cardData.name}|${cardData.setCode ?? ''}|${cardData.fileOrder}`) ?? -1
    )
  }

  const stateLabel = (state: string): string => {
    switch (state) {
      case 'name-only':
        return t('site.wanted.anyPrinting')
      case 'printing':
        return t('site.wanted.anyFinish')
      default:
        return ''
    }
  }

  const renderWantedListCard = (c: CardData) => {
    const entryIdx = findEntryIndex(c)
    const entry = currencyEntries()[entryIdx]
    const showTrade = !props.editMode && !props.onCardMove && entry !== undefined
    const selectKey = String(entryIdx)
    const specific = entry !== undefined && hasSpecificPrinting(entry)
    const buildSelected = (): SelectedCard => {
      const preview = resolveCardPreview(c.card, Boolean(props.useScryfallImgUrls), c.customArt)
      return {
        key: selectKey,
        name: c.name,
        set: specific ? entry.set.toLowerCase() : undefined,
        collectorNumber: specific ? entry.collectorNumber : undefined,
        finish: entry?.finish,
        language: storedLanguage(entry?.language),
        note: entry?.note,
        quantity: 1,
        groupSize: 1,
        price: c.price,
        scryfallCard: c.card,
        image: preview.image || undefined,
        sideways: preview.sideways,
        customArt: c.customArt,
        hasCustomArt: c.hasCustomArt,
        printings: specific ? undefined : (props.printings[c.name] ?? []),
        sourceName: props.name,
        sourceSlug: props.slug,
        sourceKind: 'wanted',
        maxQty: 1,
        cardIds: entry?.cardId !== undefined ? [entry.cardId] : [],
      }
    }
    const contextInfo = (): CardContextInfo => ({
      cardName: c.name,
      card: c.card,
      cardIds: entry?.cardId !== undefined ? [entry.cardId] : [],
      quantity: 1,
      set: entry?.set,
      collectorNumber: entry?.collectorNumber,
      finish: entry?.finish,
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
        hideCount={true}
        useScryfallImgUrls={props.useScryfallImgUrls}
        onCardClick={() => props.onOpenModal(String(entryIdx))}
        onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
        onTooltipLeave={() => setTooltip(null)}
        collectionFinish={entry?.finish}
        collectionLanguage={storedLanguage(entry?.language)}
        collectionSetCN={
          entry && hasSpecificPrinting(entry)
            ? `${entry.set.toUpperCase()}:${entry.collectorNumber}`
            : undefined
        }
        collectionPrice={entry?.price}
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
        onAddToTrade={showTrade ? () => handleWantedAddToTrade(entry, c.card) : undefined}
        addToTradeDisabled={showTrade ? isWantedCardAddDisabled(entry, c.card) : undefined}
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
    if (pricesEnabled()) {
      parts.push({
        label: 'price',
        value: cardPriceText(t, entry, entry.price, props.currency),
      })
    }
    if (hasSpecificPrinting(entry)) {
      parts.push({
        label: 'set',
        value: `${entry.set.toUpperCase()}:${entry.collectorNumber}`,
      })
    }
    if (entry.finish) {
      parts.push({
        label: 'finish',
        value: finishName(t, entry.finish),
      })
    }
    const sl = stateLabel(entry.state)
    if (sl) {
      parts.push({ label: 'specificity', value: sl })
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

  const serializeWanted = (format: ExportFormat): string => {
    switch (format) {
      case 'txt':
        return wantedToText(props.entries)
      case 'md':
        return wantedToMarkdown(props.name, props.entries, sectionOrder())
      case 'csv':
        return wantedToCsv(props.entries)
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
            <PageCountAndTotal
              count={props.entries.length}
              total={computedTotalPrice()}
              currency={props.currency}
            />
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
                serialize={serializeWanted}
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
        onGroupByChange={(v) => setGroupBy(v as WantedListGroupBy)}
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
              renderCard={renderWantedListCard}
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

      {/* Trade printing picker for wanted cards without specific printings */}
      <Show when={wantedTradePicker()}>
        {(picker) => (
          <TradePrintingPicker
            cardName={picker().cardName}
            printings={picker().printings}
            loading={false}
            useScryfallImgUrls={props.useScryfallImgUrls}
            currency={props.currency}
            onSelect={handleWantedTradePickerSelect}
            onClose={() => setWantedTradePicker(null)}
          />
        )}
      </Show>

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
