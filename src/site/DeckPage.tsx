import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, onMount, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import { seedCards, seedPrintings, overlayCard, sessionCacheVersion } from './session-cache'
import { normalizeCardName } from '../term-match'
import { usePublicPriceControls, UpdatePricesButton } from './PriceControls'
import { PriceStalenessNotice } from './PriceStalenessNotice'
import { TagFilterWarning } from './TagFilterWarning'
import type { Card, DeckData, ScryfallCard, Finish } from '../types'
import type { CardContextInfo } from './card-context'
import type { ChangelogPage } from '../changelog-parser'
import { findPrinting, hasSpecificPrinting } from '../card-printing'
import { SymbolText } from './symbols'
import type { PriceCurrency } from '../price-currency'
import { getCardPrice, formatPrice } from '../price-currency'
import {
  type GroupBy,
  type SortBy,
  type CardData,
  type CardGroup,
  groupAndSortCards,
  groupTotalPrice,
  sortByOptions,
  CARD_SIZE_WIDTHS,
} from './card-sorting'
import { CardModal } from './CardModal'
import { ChangelogModal } from './ChangelogModal'
import { useCardNavScroll } from './card-nav'
import { TooltipOverlay } from './TooltipOverlay'
import { useTooltip } from './useTooltip'
import { Toolbar } from './Toolbar'
import { TradePrintingPicker } from './TradePrintingPicker'
import { addEntryToLeft, canAddMoreToLeft, showTradeToast } from './useTradeState'
import type { TradeSearchEntry } from './useTradeData'
import { resolveCardThumbnailUrl, resolveCardPreview } from './image-sources'
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
import { PrimerRenderer, buildToc } from './PrimerRenderer'
import { useCardSelection, type SelectedCard } from './useCardSelection'
import { SelectionMenu } from './SelectionMenu'
import { buildSelectionEditActions } from './selection-edit-actions'
import type { DeckBulkEdit } from '../editor/DeckEditController'
import { ExportMenu, type ExportFormat } from './ExportMenu'
import { deckToExportText, deckToMarkdown } from '../deck-text'
import { deckToCsv } from '../editor/list-export'

type DeckTradePicker = { cardName: string; printings: ScryfallCard[]; deckEntry: Card }

type DeckGroupByOption = { value: GroupBy; label: string }
const DECK_GROUP_BY_OPTIONS: DeckGroupByOption[] = [
  { value: 'type', label: 'Type' },
  { value: 'section', label: 'Section' },
  { value: 'cmc', label: 'Mana Value' },
  { value: 'color-identity', label: 'Color Identity' },
  { value: 'price', label: 'Price' },
  { value: 'printing', label: 'Printing' },
  { value: 'none', label: 'None' },
]

// The sort fields this page offers, in order — shared by the toolbar's dropdown
// options and the URL sync's validation of incoming sort layers.
const DECK_SORT_BYS: readonly SortBy[] = ['name', 'cmc', 'price', 'color-identity', 'edhrec']

/** Rebuild the deck hash for a primer toggle, preserving any shareable list-view query string. */
const deckPrimerHash = (slug: string, primerOpen: boolean): string => {
  const query = window.location.hash.split('?')[1]
  const base = `#/deck/${slug}${primerOpen ? '/primer' : ''}`
  return query ? `${base}?${query}` : base
}

const isCommanderSection = (s: string): boolean => s.toLowerCase().includes('commander')
const isSideboardSection = (s: string): boolean => s.toLowerCase().includes('sideboard')
const isExtraSection = (s: string): boolean => {
  const low = s.toLowerCase()
  return low.includes('maybeboard') || low.includes('token')
}

export interface DeckPageProps {
  deck: DeckData
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  lowestPriceCards?: Record<string, ScryfallCard | null>
  lowestPriceCardsEur?: Record<string, ScryfallCard | null>
  lowestPriceCardsTix?: Record<string, ScryfallCard | null>
  symbolMap: Record<string, string>
  /** Show the page-header Copy/Download export menu (public read view only). */
  enableExport?: boolean
  useScryfallImgUrls?: boolean
  modalCardName: string | null
  onOpenModal: (cardName: string) => void
  onCloseModal: () => void
  currency: PriceCurrency
  missingCards?: Partial<Record<PriceCurrency, string[]>>
  slug: string
  primerOpen?: boolean
  sectionId?: string
  editMode?: boolean
  /** Card names added during the current edit session (edit mode only). */
  addedCardNames?: string[]
  onCardIncrement?: (cardName: string) => void
  onCardDecrement?: (cardName: string) => void
  onCardContextMenu?: (info: CardContextInfo, rect: DOMRect) => void
  /**
   * When provided, each card shows a single "Move To…" button (instead of the edit
   * or trade controls) that reports the card and the button's rect. Used by the
   * admin Move Cards page.
   */
  onCardMove?: (info: CardContextInfo, rect: DOMRect) => void
  unsavedChangeCount?: number
  changelog?: ChangelogPage[]
  /**
   * Force the page width. Defaults to full width in edit/move mode and the centered
   * container otherwise; the public in-browser editor sets `false` to keep the
   * normal margins even while editing.
   */
  fullWidth?: boolean
  /** Build-time price date (ISO), shipped with the deck JSON; drives staleness after a refresh. */
  pricesDate?: string
  /** Show the public "Update Prices" toolbar button + staleness notice (public site only). */
  enablePriceRefresh?: boolean
  /** Offer "Add to Trade" in the multi-select menu (public site only; the trade page is unreachable on admin). */
  enableTrade?: boolean
  /** When provided (edit mode), enables bulk edit actions in the multi-select menu. */
  bulkEdit?: DeckBulkEdit
  /** When provided (public read view), shows a "Combine with list…" header button. */
  onCombine?: () => void
  /** Mirror the toolbar/filter state into the URL query so the view is shareable (public read view only). */
  enableUrlState?: boolean
}

export const DeckPage: Component<DeckPageProps> = (props) => {
  const selection = useCardSelection({ kind: 'deck', name: props.deck.name })
  const editActions = createMemo(() =>
    props.bulkEdit ? buildSelectionEditActions(props.bulkEdit, selection) : undefined,
  )
  const toolbar = useToolbarState<GroupBy>({ groupBy: 'type', sortBy: 'name' })
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
    defaults: { groupBy: 'type', sortBy: 'name' },
    groupByValues: DECK_GROUP_BY_OPTIONS.map((o) => o.value),
    sortByValues: DECK_SORT_BYS,
    enabled: props.enableUrlState,
  })
  const [lowestPrice, setLowestPrice] = createSignal(false)
  const [missingCardsExpanded, setMissingCardsExpanded] = createSignal(false)
  const [showChangelog, setShowChangelog] = createSignal(false)

  const [deckTradePicker, setDeckTradePicker] = createSignal<DeckTradePicker | null>(null)

  // Build a fileOrder → original Card entry lookup for trade support.
  // Mirrors the order counter in allCards() so indices align.
  const deckEntryByOrder = createMemo(() => {
    const map = new Map<number, Card>()
    let order = 0
    for (const section of props.deck.sections) {
      for (const entry of section.cards) {
        map.set(order++, entry)
      }
    }
    return map
  })

  // First-occurrence name lookup used for the modal's "Add to Trade" button.
  const deckEntryByName = createMemo(() => {
    const map = new Map<string, Card>()
    for (const section of props.deck.sections) {
      for (const entry of section.cards) {
        if (!map.has(entry.name)) map.set(entry.name, entry)
      }
    }
    return map
  })

  const buildDeckSearchEntry = (
    cardName: string,
    entry: Card,
    scryfallCard: ScryfallCard | null,
    maxQty: number,
  ): TradeSearchEntry => ({
    name: cardName,
    nameKey: normalizeCardName(cardName),
    set: entry.set?.toLowerCase(),
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    scryfallCard,
    sourceName: props.deck.name,
    sourceKind: 'deck',
    maxQty,
    cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
  })

  const handleDeckAddToTrade = (c: CardData, deckEntry: Card) => {
    if (!hasSpecificPrinting(deckEntry)) {
      setDeckTradePicker({
        cardName: c.name,
        printings: props.printings[c.name] ?? [],
        deckEntry,
      })
      return
    }
    const scryfallCard = c.card
    const entry = buildDeckSearchEntry(c.name, deckEntry, scryfallCard, c.quantity)
    const added = addEntryToLeft(entry, props.currency)
    if (added)
      showTradeToast(
        entry.name,
        resolveCardThumbnailUrl(entry.scryfallCard, props.useScryfallImgUrls ?? false),
      )
  }

  const handleDeckTradePickerSelect = (printing: ScryfallCard, finish: Finish) => {
    const picker = deckTradePicker()
    if (!picker) return
    const searchEntry: TradeSearchEntry = {
      name: printing.name,
      nameKey: normalizeCardName(printing.name),
      set: printing.set.toLowerCase(),
      collectorNumber: printing.collector_number,
      finish,
      scryfallCard: printing,
      sourceName: props.deck.name,
      sourceKind: 'deck',
      maxQty: picker.deckEntry.quantity ?? 1,
      cardIds: picker.deckEntry.cardId !== undefined ? [picker.deckEntry.cardId] : [],
    }
    const added = addEntryToLeft(searchEntry, props.currency)
    setDeckTradePicker(null)
    if (added)
      showTradeToast(
        searchEntry.name,
        resolveCardThumbnailUrl(searchEntry.scryfallCard, props.useScryfallImgUrls ?? false),
      )
  }

  const isDeckCardAddDisabled = (c: CardData, deckEntry: Card): boolean => {
    const entry = buildDeckSearchEntry(c.name, deckEntry, c.card, c.quantity)
    return !canAddMoreToLeft(entry)
  }

  const modalDeckEntry = createMemo(() =>
    props.modalCardName ? deckEntryByName().get(props.modalCardName) : undefined,
  )

  // Active card map based on lowest price toggle and currency
  const activeCards = createMemo(() => {
    if (lowestPrice()) {
      if (props.currency === 'eur' && props.lowestPriceCardsEur) return props.lowestPriceCardsEur
      if (props.currency === 'tix' && props.lowestPriceCardsTix) return props.lowestPriceCardsTix
      if (props.lowestPriceCards) return props.lowestPriceCards
    }
    return props.cards
  })

  const hasLowestPriceCards = createMemo(() =>
    Boolean(props.lowestPriceCards || props.lowestPriceCardsEur || props.lowestPriceCardsTix),
  )

  // Resolve the ScryfallCard to display for a deck entry. Each entry resolves its
  // own printing from the card's full printing list, so two entries of the same
  // card with different set/collector numbers render distinct art and price. The
  // "Lowest Price" toggle intentionally ignores the entry's printing (it shows
  // the cheapest printing per card name); name-only entries fall back to the
  // representative card.
  const resolveEntryCard = (entry: Card): ScryfallCard | null => {
    if (!lowestPrice() && hasSpecificPrinting(entry)) {
      const match = findPrinting(props.printings[entry.name], entry.set, entry.collectorNumber)
      if (match) return overlayCard(match)
    }
    return overlayCard(activeCards()[entry.name] ?? null)
  }

  const handleModalAddToTrade = () => {
    const cardName = props.modalCardName
    const entry = modalDeckEntry()
    if (!cardName || !entry) return
    if (!hasSpecificPrinting(entry)) {
      props.onCloseModal()
      setDeckTradePicker({
        cardName,
        printings: props.printings[cardName] ?? [],
        deckEntry: entry,
      })
      return
    }
    const scryfallCard = activeCards()[cardName] ?? null
    const searchEntry = buildDeckSearchEntry(cardName, entry, scryfallCard, entry.quantity)
    const added = addEntryToLeft(searchEntry, props.currency)
    if (added)
      showTradeToast(
        searchEntry.name,
        resolveCardThumbnailUrl(searchEntry.scryfallCard, props.useScryfallImgUrls ?? false),
      )
  }

  const modalAddToTradeDisabled = createMemo(() => {
    const cardName = props.modalCardName
    const entry = modalDeckEntry()
    if (!cardName || !entry) return true
    if (!hasSpecificPrinting(entry)) return false // picker will handle
    const scryfallCard = activeCards()[cardName] ?? null
    const searchEntry = buildDeckSearchEntry(cardName, entry, scryfallCard, entry.quantity)
    return !canAddMoreToLeft(searchEntry)
  })

  // Missing cards for current currency
  const currentMissingCards = createMemo(() => {
    if (!props.missingCards) return []
    return props.missingCards[props.currency] ?? []
  })

  // Tooltip state for list-view hover preview
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  // Build flat card list with metadata
  const allCards = createMemo((): CardData[] => {
    sessionCacheVersion() // re-resolve card prices after an in-session "Update Prices"
    const result: CardData[] = []
    let order = 0
    for (const section of props.deck.sections) {
      for (const entry of section.cards) {
        const card = resolveEntryCard(entry)
        result.push({
          name: entry.name,
          quantity: entry.quantity,
          cmc: card?.cmc ?? 0,
          edhrec: card?.edhrec_rank ?? 999999,
          price: card ? getCardPrice(card, props.currency) : 0,
          type: card?.type_line ?? '',
          section: section.name,
          fileOrder: order++,
          setCode: card?.set ?? '',
          colorIdentity: card?.color_identity ?? [],
          hasPrinting: hasSpecificPrinting(entry),
          oracleTags: card?.oracleTags ?? [],
          artTags: card?.artTags ?? [],
          card,
        })
      }
    }
    return result
  })

  // Seed the session cache from this deck's baked card data so the editor's card
  // search and the trade page reuse it instead of re-fetching from Scryfall.
  onMount(() => {
    seedCards(props.cards)
    seedPrintings(props.printings)
    if (props.lowestPriceCards) seedCards(props.lowestPriceCards)
    if (props.lowestPriceCardsEur) seedCards(props.lowestPriceCardsEur)
    if (props.lowestPriceCardsTix) seedCards(props.lowestPriceCardsTix)
  })

  // Price refresh is wired for every render but only shown when the page opts in
  // via `enablePriceRefresh` (the public site, read-only or editing).
  const prices = usePublicPriceControls({ cards: allCards, pricesDate: props.pricesDate })

  // Scroll to a cross-list navigation target (e.g. from "Find Other Printings")
  // once the deck's cards are rendered.
  useCardNavScroll(
    () => (props.slug ? { type: 'deck', slug: props.slug } : null),
    () => allCards().length > 0,
  )

  const sectionOrder = createMemo(() => {
    return props.deck.sections.map((s) => s.name)
  })

  // Partition all cards into categories in a single O(n) pass so we avoid
  // re-scanning allCards separately for commander, sideboard, extras, and
  // mainboard.  cardGroups can then depend on mainboardCards rather than
  // allCards, so toolbar changes (groupBy, sortBy…) no longer re-trigger the
  // categorisation step.
  const partitioned = createMemo(() => {
    const commanderCards: CardData[] = []
    const sideboardCards: CardData[] = []
    const extraCards: CardData[] = []
    const mainboardCards: CardData[] = []
    for (const c of allCards()) {
      if (isCommanderSection(c.section)) commanderCards.push(c)
      else if (isSideboardSection(c.section)) sideboardCards.push(c)
      else if (isExtraSection(c.section)) extraCards.push(c)
      else mainboardCards.push(c)
    }
    return { commanderCards, sideboardCards, extraCards, mainboardCards }
  })

  // Toolbar filters apply to everything except the commander section, which is
  // the deck's identity and stays pinned.
  const setCodeOptions = createMemo(() => collectSetCodes(allCards()))
  const cardTypeOptions = createMemo(() => collectCardTypes(allCards()))
  const oracleTagOptions = createMemo(() => collectOracleTags(allCards()))
  const artTagOptions = createMemo(() => collectArtTags(allCards()))
  const untaggedAddedNames = createMemo(() =>
    isTagFilterActive(cardFilters.filters)
      ? untaggedAddedCardNames(allCards(), props.addedCardNames ?? [])
      : [],
  )

  // Sorted and grouped cards (mainboard only)
  const cardGroups = createMemo((): CardGroup[] => {
    const working = filterCards(partitioned().mainboardCards, cardFilters.filters)

    return groupAndSortCards(
      working,
      groupBy(),
      sortLayers(),
      sectionOrder(),
      priceGroupStrategy(),
      props.currency,
      reverseGroups(),
    )
  })

  // Deck price = mainboard + commander + sideboard only
  const mainAndSideboardCards = createMemo(() => {
    const p = partitioned()
    return [...p.commanderCards, ...p.mainboardCards, ...p.sideboardCards]
  })

  const totalPrice = createMemo(() => {
    return groupTotalPrice(mainAndSideboardCards())
  })

  // Extras price (maybeboard, tokens)
  const extrasPrice = createMemo(() => {
    return groupTotalPrice(partitioned().extraCards)
  })

  // Modal card data
  const modalCard = createMemo((): ScryfallCard | null => {
    if (!props.modalCardName) return null
    return activeCards()[props.modalCardName] ?? null
  })

  const serializeDeck = (format: ExportFormat): string => {
    switch (format) {
      case 'txt':
        return deckToExportText(props.deck)
      case 'md':
        return deckToMarkdown(props.deck)
      case 'csv':
        return deckToCsv(props.deck)
    }
  }

  const renderDeckCard = (hideCount: boolean) => (c: CardData) => {
    const deckEntry = deckEntryByOrder().get(c.fileOrder)
    const showTrade = !props.editMode && !props.onCardMove && deckEntry !== undefined
    const selectKey = String(c.fileOrder)
    // Name-only deck entries carry no pinned printing, so leave set/CN unset and
    // ship the printings list — adding such a card to a trade prompts for one.
    const specific = deckEntry !== undefined && hasSpecificPrinting(deckEntry)
    const buildSelected = (): SelectedCard => {
      const preview = resolveCardPreview(c.card, Boolean(props.useScryfallImgUrls))
      return {
        key: selectKey,
        name: c.name,
        set: specific ? deckEntry?.set?.toLowerCase() : undefined,
        collectorNumber: specific ? deckEntry?.collectorNumber : undefined,
        finish: deckEntry?.finish,
        condition: deckEntry?.condition,
        quantity: c.quantity,
        groupSize: c.quantity,
        price: c.price,
        scryfallCard: c.card,
        image: preview.image || undefined,
        sideways: preview.sideways,
        printings: specific ? undefined : (props.printings[c.name] ?? []),
        sourceName: props.deck.name,
        sourceSlug: props.slug,
        sourceKind: 'deck',
        maxQty: c.quantity,
        cardIds: deckEntry?.cardId !== undefined ? [deckEntry.cardId] : [],
      }
    }
    const contextInfo = (): CardContextInfo => ({
      cardName: c.name,
      card: c.card,
      cardIds: deckEntry?.cardId !== undefined ? [deckEntry.cardId] : [],
      quantity: c.quantity,
      set: deckEntry?.set,
      collectorNumber: deckEntry?.collectorNumber,
      finish: deckEntry?.finish,
      condition: deckEntry?.condition,
    })
    return (
      <CardItem
        name={c.name}
        quantity={c.quantity}
        card={c.card}
        symbolMap={props.symbolMap}
        viewMode={viewMode()}
        hideCount={hideCount}
        useScryfallImgUrls={props.useScryfallImgUrls}
        onCardClick={() => props.onOpenModal(c.name)}
        onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
        onTooltipLeave={() => setTooltip(null)}
        collectionFinish={deckEntry?.finish}
        currency={props.currency}
        cardId={deckEntry?.cardId}
        editMode={props.editMode}
        onIncrement={props.editMode ? () => props.onCardIncrement?.(c.name) : undefined}
        onDecrement={props.editMode ? () => props.onCardDecrement?.(c.name) : undefined}
        onContextMenu={
          props.editMode ? (rect) => props.onCardContextMenu?.(contextInfo(), rect) : undefined
        }
        onMove={props.onCardMove ? (rect) => props.onCardMove!(contextInfo(), rect) : undefined}
        onAddToTrade={showTrade ? () => handleDeckAddToTrade(c, deckEntry) : undefined}
        addToTradeDisabled={showTrade ? isDeckCardAddDisabled(c, deckEntry) : undefined}
        selectable
        selectState={selection.state(selectKey)}
        onToggleSelect={() => selection.toggle(buildSelected())}
      />
    )
  }

  const modalPrintings = createMemo(() => {
    if (!props.modalCardName) return []
    const direct = props.printings[props.modalCardName]
    if (direct) return direct
    // Fall back to the card's actual Scryfall name — primer keys may differ in
    // punctuation/casing from the deck's card name key used to index printings.
    const actualName = modalCard()?.name
    return (actualName ? props.printings[actualName] : undefined) ?? []
  })

  const filteredSideboardCards = createMemo(() =>
    filterCards(partitioned().sideboardCards, cardFilters.filters),
  )

  // Pre-compute extra sections for reactive rendering
  const extraSections = createMemo(() => {
    if (cardFilters.filters.hideExtras || partitioned().extraCards.length === 0) return []
    const extraCards = filterCards(partitioned().extraCards, cardFilters.filters)
    return props.deck.sections
      .filter((s) => isExtraSection(s.name))
      .map((s) => ({
        name: s.name,
        cards: extraCards.filter((c) => c.section === s.name),
      }))
      .filter((s) => s.cards.length > 0)
  })

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
          <h1 class="page-title">{props.deck.name}</h1>
          <p class="page-stats">
            Total: {formatPrice(totalPrice(), props.currency)}
            <Show when={!cardFilters.filters.hideExtras && partitioned().extraCards.length > 0}>
              <span class="page-stats-label">
                {' '}
                (all cards: {formatPrice(totalPrice() + extrasPrice(), props.currency)})
              </span>
            </Show>
          </p>
          <Show when={props.deck.sourceUrl}>
            <a href={props.deck.sourceUrl} target="_blank" rel="noreferrer" class="copy-link">
              Imported from{' '}
              {(() => {
                if (props.deck.sourceUrl!.includes('moxfield.com')) return 'Moxfield'
                if (props.deck.sourceUrl!.includes('archidekt.com')) return 'Archidekt'
                if (props.deck.sourceUrl!.includes('mtggoldfish.com')) return 'MTGGoldfish'
                return 'Source'
              })()}{' '}
              ↗
            </a>
          </Show>
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
                Combine with list…
              </button>
            </Show>
            <Show when={props.changelog && props.changelog.length > 0}>
              <button
                onClick={() => setShowChangelog(true)}
                class="btn btn-secondary btn-view-changes"
              >
                View Changes
              </button>
            </Show>
            <Show when={props.enableExport}>
              <ExportMenu serialize={serializeDeck} name={props.deck.name} />
            </Show>
            <Show when={props.enablePriceRefresh}>
              <UpdatePricesButton prices={prices} />
            </Show>
          </div>
        </Show>
      </div>

      {/* Toolbar */}
      <Toolbar
        viewMode={viewMode()}
        onViewModeChange={setViewMode}
        cardSize={cardSize()}
        onCardSizeChange={setCardSize}
        groupBy={groupBy()}
        groupByOptions={DECK_GROUP_BY_OPTIONS}
        onGroupByChange={(v) => setGroupBy(v as GroupBy)}
        sortLayers={sortLayers()}
        sortByOptions={sortByOptions(DECK_SORT_BYS)}
        onSortLayersChange={setSortLayers}
        priceGroupStrategy={priceGroupStrategy()}
        onPriceGroupStrategyChange={setPriceGroupStrategy}
        reverseGroups={reverseGroups()}
        onReverseGroupsChange={() => setReverseGroups((prev) => !prev)}
        filters={cardFilters}
        symbolMap={props.symbolMap}
        currency={props.currency}
        setCodeOptions={setCodeOptions()}
        cardTypeOptions={cardTypeOptions()}
        oracleTagOptions={oracleTagOptions()}
        artTagOptions={artTagOptions()}
        showHideExtras
        extraToggles={
          hasLowestPriceCards()
            ? [
                {
                  label: 'Lowest Price',
                  checked: lowestPrice(),
                  onChange: () => setLowestPrice((prev) => !prev),
                },
              ]
            : undefined
        }
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

      {/* Description / Primer */}
      <Show when={props.deck.description || props.deck.primer}>
        <div class="deck-description-section">
          <Show when={props.deck.description}>
            <div class="deck-description">
              <Show
                when={props.deck.description!.length > 200}
                fallback={
                  <div class="text-preformatted">
                    <SymbolText text={props.deck.description!} symbolMap={props.symbolMap} />
                  </div>
                }
              >
                <ExpandableText text={props.deck.description!} symbolMap={props.symbolMap} />
              </Show>
            </div>
          </Show>
          <Show when={props.deck.primer}>
            <div class="deck-primer">
              <ExpandablePrimer
                primer={props.deck.primer!}
                slug={props.slug}
                cards={activeCards()}
                onOpenModal={props.onOpenModal}
                primerOpen={props.primerOpen}
                sectionId={props.sectionId}
              />
            </div>
          </Show>
        </div>
      </Show>

      {/* Missing cards warning banner */}
      <Show when={currentMissingCards().length > 0}>
        <div class="missing-cards-banner">
          <button
            type="button"
            class="missing-cards-banner-toggle"
            onClick={() => setMissingCardsExpanded((prev) => !prev)}
          >
            <span>⚠️</span>
            <span class="missing-toggle-label">
              {currentMissingCards().length} card
              {currentMissingCards().length > 1 ? 's' : ''} missing {props.currency.toUpperCase()}{' '}
              pricing
            </span>
            <span class="missing-toggle-arrow">{missingCardsExpanded() ? '▲' : '▼'}</span>
          </button>
          <Show when={missingCardsExpanded()}>
            <div class="missing-cards-banner-list">
              <ul>
                <For each={currentMissingCards()}>{(name) => <li>{name}</li>}</For>
              </ul>
            </div>
          </Show>
        </div>
      </Show>

      {/* Card sections */}
      <div
        class={`card-sections view-${viewMode()}`}
        style={`--card-width:${CARD_SIZE_WIDTHS[cardSize()]}px`}
      >
        {/* Commander section always shown first */}
        <Show when={partitioned().commanderCards.length > 0}>
          <CardSection
            label={
              props.deck.sections.find((s) => s.name.toLowerCase().includes('commander'))?.name ??
              'Commander'
            }
            cards={partitioned().commanderCards}
            currency={props.currency}
            renderCard={renderDeckCard(true)}
          />
        </Show>

        {/* Dynamic sorted/grouped sections (mainboard only) */}
        <For each={cardGroups()}>
          {(group) => (
            <CardSection
              label={group.key}
              cards={group.cards}
              currency={props.currency}
              renderCard={renderDeckCard(false)}
            />
          )}
        </For>

        {/* Sideboard always shown at bottom, ungrouped */}
        <Show when={filteredSideboardCards().length > 0}>
          <CardSection
            label={props.deck.sections.find((s) => isSideboardSection(s.name))?.name ?? 'Sideboard'}
            cards={filteredSideboardCards()}
            currency={props.currency}
            renderCard={renderDeckCard(false)}
          />
        </Show>

        {/* Extras (maybeboard, tokens) shown below sideboard, ungrouped */}
        <For each={extraSections()}>
          {(s) => (
            <CardSection
              label={s.name}
              cards={s.cards}
              currency={props.currency}
              renderCard={renderDeckCard(false)}
            />
          )}
        </For>
      </div>

      {/* List-view hover tooltip */}
      <TooltipOverlay tooltip={tooltip()} pos={tooltipPos()} tooltipRef={tooltipRef} />

      {/* Card detail modal */}
      <CardModal
        open={Boolean(modalCard())}
        card={modalCard()}
        cardName={props.modalCardName}
        symbolMap={props.symbolMap}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency}
        printings={modalPrintings()}
        onClose={props.onCloseModal}
        onAddToTrade={!props.editMode && !props.onCardMove ? handleModalAddToTrade : undefined}
        addToTradeDisabled={
          !props.editMode && !props.onCardMove ? modalAddToTradeDisabled() : undefined
        }
      />

      {/* Trade printing picker for deck cards without specific printings */}
      <Show when={deckTradePicker()}>
        {(picker) => (
          <TradePrintingPicker
            cardName={picker().cardName}
            printings={picker().printings}
            loading={false}
            useScryfallImgUrls={props.useScryfallImgUrls}
            currency={props.currency}
            onSelect={handleDeckTradePickerSelect}
            onClose={() => setDeckTradePicker(null)}
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

// Expandable text component for long plain-text descriptions
type ExpandableTextProps = {
  text: string
  symbolMap: Record<string, string>
}

function ExpandableText(props: ExpandableTextProps) {
  const [expanded, setExpanded] = createSignal(false)

  return (
    <div>
      <div class="text-preformatted">
        <SymbolText
          text={expanded() ? props.text : props.text.slice(0, 200) + '…'}
          symbolMap={props.symbolMap}
        />
      </div>
      <button class="link-action" onClick={() => setExpanded((prev) => !prev)}>
        {expanded() ? 'Show less' : 'Read more'}
      </button>
    </div>
  )
}

// Expandable primer component with Markdown rendering and an optional TOC sidebar
type ExpandablePrimerProps = {
  primer: string
  slug: string
  cards: Record<string, ScryfallCard | null>
  onOpenModal: (cardName: string) => void
  primerOpen?: boolean
  sectionId?: string
}

function ExpandablePrimer(props: ExpandablePrimerProps) {
  const [expanded, setExpanded] = createSignal(Boolean(props.primerOpen || props.sectionId))

  // buildToc is a fast O(n) line-scan; createMemo with auto-tracking ensures it only
  // recomputes when the primer text changes, not on every re-render.
  const toc = createMemo(() => buildToc(props.primer))

  // Re-expand whenever the route navigates to the primer or a specific section
  createEffect(() => {
    if (props.primerOpen || props.sectionId) setExpanded(true)
  })

  // Scroll to the target section after the primer is expanded
  createEffect(() => {
    if (!expanded() || !props.sectionId) return
    document.getElementById(props.sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  return (
    <div>
      <Show
        when={expanded()}
        fallback={
          <div>
            <p class="text-hint">This deck has a primer.</p>
            <button
              class="link-action"
              aria-expanded={false}
              onClick={() => {
                setExpanded(true)
                history.replaceState(null, '', deckPrimerHash(props.slug, true))
              }}
            >
              Read more
            </button>
          </div>
        }
      >
        <div>
          <div class={`primer-layout ${toc().length > 0 ? 'primer-layout--with-toc' : ''}`}>
            <Show when={toc().length > 0}>
              <nav class="primer-toc">
                <p class="primer-toc-title">Contents</p>
                <ul>
                  <For each={toc()}>
                    {(h) => (
                      <li class={`primer-toc-item primer-toc-level-${h.level}`}>
                        <a href={`#/deck/${props.slug}/primer/${h.id}`}>
                          {h.text.replace(/\*+/g, '')}
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </nav>
            </Show>
            <PrimerRenderer
              primerMarkdown={props.primer}
              cards={props.cards}
              onOpenModal={props.onOpenModal}
            />
          </div>
          <button
            class="link-action link-action-block"
            aria-expanded={true}
            onClick={() => {
              setExpanded(false)
              history.replaceState(null, '', deckPrimerHash(props.slug, false))
            }}
          >
            Show less
          </button>
        </div>
      </Show>
    </div>
  )
}
