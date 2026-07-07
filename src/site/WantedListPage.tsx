import type { Component } from 'solid-js'
import { createSignal, createMemo, onMount, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import { seedCards, seedPrintings, sessionCacheVersion } from './session-cache'
import { usePublicPriceControls, UpdatePricesButton } from './PriceControls'
import { PriceStalenessNotice } from './PriceStalenessNotice'
import { TagFilterWarning } from './TagFilterWarning'
import type { ScryfallCard, Finish } from '../types'
import type { CardContextInfo } from './card-context'
import type { WantedListCardEntry } from './data-types'
import type { ChangelogPage } from '../changelog-parser'
import type { PriceCurrency } from '../price-currency'
import { getCardPriceForFinish, formatPrice, formatPriceOrNA } from '../price-currency'
import {
  type CardData,
  type CardGroup,
  type GroupBy,
  groupAndSortCards,
  CARD_SIZE_WIDTHS,
} from './card-sorting'
import { CardModal } from './CardModal'
import { ChangelogModal } from './ChangelogModal'
import { capitalize } from './utils'
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
import { TradePrintingPicker } from './TradePrintingPicker'
import { addEntryToRight, canAddMoreToRight, showTradeToast } from './useTradeState'
import type { TradeSearchEntry } from './useTradeData'
import { resolveCardThumbnailUrl, resolveCardPreview } from './image-sources'
import { hasSpecificPrinting } from '../card-printing'
import { resolveWantedCardEntry } from './resolve-card'
import { useCardSelection, type SelectedCard } from './useCardSelection'
import { SelectionMenu } from './SelectionMenu'
import { buildSelectionEditActions } from './selection-edit-actions'
import type { FlatBulkEdit } from '../editor/flat-list-controller'
import { ExportMenu, type ExportFormat } from './ExportMenu'
import { wantedToText, wantedToMarkdown, wantedToCsv } from '../editor/list-export'

type WantedListGroupBy = GroupBy
type MetaEntry = { label: string; value: string }
type WantedTradePicker = {
  cardName: string
  printings: ScryfallCard[]
  wantedEntry: WantedListCardEntry
}

interface WantedListPageProps {
  name: string
  /** Slug of this list, threaded into selected cards so cross-list edits can target it. */
  slug?: string
  entries: WantedListCardEntry[]
  /** Section names in display order, including empty sections. Falls back to entry order. */
  sectionOrder?: string[]
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
  const selection = useCardSelection({ kind: 'wanted', name: props.name })
  const editActions = createMemo(() =>
    props.bulkEdit ? buildSelectionEditActions(props.bulkEdit, selection) : undefined,
  )
  // Section order, including any empty sections from the build/save payload; falls back to the
  // sections discovered in the entries (in file order) when not provided.
  const sectionOrder = createMemo(() => deriveSectionOrder(props.sectionOrder, props.entries))
  const hasSections = createMemo(() => sectionOrder().length >= 2)
  const groupByOptions = createMemo(() => [
    ...(hasSections() ? [{ value: 'section', label: 'Section' }] : []),
    { value: 'type', label: 'Type' },
    { value: 'cmc', label: 'Mana Value' },
    { value: 'color-identity', label: 'Color Identity' },
    { value: 'price', label: 'Price' },
    { value: 'printing', label: 'Printing' },
    { value: 'none', label: 'None' },
  ])

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
    sortBy,
    setSortBy,
    reverse,
    setReverse,
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
    groupByValues: groupByOptions().map((o) => o.value as WantedListGroupBy),
    enabled: props.enableUrlState,
  })
  const [showChangelog, setShowChangelog] = createSignal(false)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  const [wantedTradePicker, setWantedTradePicker] = createSignal<WantedTradePicker | null>(null)

  const buildWantedSearchEntry = (
    entry: WantedListCardEntry,
    scryfallCard: ScryfallCard | null,
  ): TradeSearchEntry => ({
    name: entry.name,
    nameLower: entry.name.toLowerCase(),
    set: entry.set?.toLowerCase(),
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
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
      nameLower: printing.name.toLowerCase(),
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

  const currencyEntries = createMemo((): WantedListCardEntry[] => {
    sessionCacheVersion() // re-price after an in-session "Update Prices"
    return props.entries.map((entry) => {
      const card = resolveWantedCardEntry(entry, props.cards)
      if (!card) return entry

      const price = getCardPriceForFinish(card, entry.finish ?? 'nonfoil', props.currency)
      return { ...entry, price }
    })
  })

  const computedTotalPrice = createMemo(() => {
    return currencyEntries().reduce((sum, e) => sum + e.price, 0)
  })

  const allCards = createMemo((): CardData[] => {
    return currencyEntries().map((entry) => {
      const card = resolveWantedCardEntry(entry, props.cards)
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
        card,
      }
    })
  })

  // Seed the session cache from this list's baked card data so the editor's card
  // search and the trade page reuse it instead of re-fetching from Scryfall.
  onMount(() => {
    seedCards(props.cards)
    seedPrintings(props.printings)
  })

  // Price refresh is wired for every render but only shown when `enablePriceRefresh`.
  const prices = usePublicPriceControls({ cards: allCards, pricesDate: props.pricesDate })

  const setCodeOptions = createMemo(() => collectSetCodes(allCards()))
  const cardTypeOptions = createMemo(() => collectCardTypes(allCards()))
  const oracleTagOptions = createMemo(() => collectOracleTags(allCards()))
  const artTagOptions = createMemo(() => collectArtTags(allCards()))
  const untaggedAddedNames = createMemo(() =>
    isTagFilterActive(cardFilters.filters)
      ? untaggedAddedCardNames(allCards(), props.addedCardNames ?? [])
      : [],
  )

  const cardGroups = createMemo((): CardGroup[] => {
    const working = filterCards(allCards(), cardFilters.filters)

    return groupAndSortCards(
      working,
      groupBy(),
      sortBy(),
      reverse(),
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
    return resolveWantedCardEntry(modalEntry()!, props.cards)
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
        return 'any printing'
      case 'printing':
        return 'any finish'
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
      const preview = resolveCardPreview(c.card, Boolean(props.useScryfallImgUrls))
      return {
        key: selectKey,
        name: c.name,
        set: specific ? entry.set.toLowerCase() : undefined,
        collectorNumber: specific ? entry.collectorNumber : undefined,
        finish: entry?.finish,
        note: entry?.note,
        quantity: 1,
        groupSize: 1,
        price: c.price,
        scryfallCard: c.card,
        image: preview.image || undefined,
        sideways: preview.sideways,
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
        symbolMap={props.symbolMap}
        viewMode={viewMode()}
        hideCount={true}
        useScryfallImgUrls={props.useScryfallImgUrls}
        onCardClick={() => props.onOpenModal(String(entryIdx))}
        onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
        onTooltipLeave={() => setTooltip(null)}
        collectionFinish={entry?.finish}
        collectionSetCN={
          entry && hasSpecificPrinting(entry)
            ? `${entry.set.toUpperCase()}:${entry.collectorNumber}`
            : undefined
        }
        collectionPrice={entry?.price}
        currency={props.currency}
        editMode={props.editMode}
        onIncrement={props.editMode && entry ? () => props.onCardIncrement?.(entry) : undefined}
        onDecrement={props.editMode && entry ? () => props.onCardDecrement?.(entry) : undefined}
        onContextMenu={
          props.editMode ? (rect) => props.onCardContextMenu?.(contextInfo(), rect) : undefined
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
    parts.push({
      label: 'price',
      value: formatPriceOrNA(entry.price, props.currency),
    })
    if (hasSpecificPrinting(entry)) {
      parts.push({
        label: 'set',
        value: `${entry.set.toUpperCase()}:${entry.collectorNumber}`,
      })
    }
    if (entry.finish) {
      parts.push({
        label: 'finish',
        value: capitalize(entry.finish),
      })
    }
    const sl = stateLabel(entry.state)
    if (sl) {
      parts.push({ label: 'specificity', value: sl })
    }
    parts.push({
      label: 'rarity',
      value: capitalize(card.rarity),
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
            {props.entries.length} cards · Total:{' '}
            {formatPrice(computedTotalPrice(), props.currency)}
          </p>
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
              <ExportMenu serialize={serializeWanted} name={props.name} />
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
        sortBy={sortBy()}
        sortByOptions={[
          { value: 'file-order', label: 'File Order' },
          { value: 'name', label: 'Name' },
          { value: 'cmc', label: 'Mana Value' },
          { value: 'price', label: 'Price' },
          { value: 'color-identity', label: 'Color Identity' },
          { value: 'set-code', label: 'Set Code' },
          { value: 'edhrec', label: 'EDHRec Rank' },
        ]}
        onSortByChange={setSortBy}
        priceGroupStrategy={priceGroupStrategy()}
        onPriceGroupStrategyChange={setPriceGroupStrategy}
        reverse={reverse()}
        onReverseChange={() => setReverse((prev) => !prev)}
        reverseGroups={reverseGroups()}
        onReverseGroupsChange={() => setReverseGroups((prev) => !prev)}
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
      <div
        ref={tooltipRef}
        class={`list-tooltip ${tooltip() ? 'visible' : ''} ${tooltip()?.sideways ? 'list-tooltip-sideways' : ''}`}
        style={`left:${tooltipPos().left}px;top:${tooltipPos().top}px;`}
      >
        <Show when={tooltip()}>
          <img src={tooltip()!.src} alt="" class={tooltip()!.sideways ? 'tooltip-rotated' : ''} />
        </Show>
      </div>

      {/* Card detail modal */}
      <CardModal
        open={Boolean(modalCard())}
        card={modalCard()}
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
