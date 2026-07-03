import type { Component } from 'solid-js'
import { createSignal, createMemo, onMount, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import { seedCards, seedPrintings, overlayCard, sessionCacheVersion } from './session-cache'
import { usePublicPriceControls } from './PriceControls'
import { PriceStalenessNotice } from './PriceStalenessNotice'
import { TagFilterWarning } from './TagFilterWarning'
import type { ScryfallCard } from '../types'
import type { CardContextInfo } from './card-context'
import type { CollectionCardEntry } from './data-types'
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
import { addEntryToLeft, canAddMoreToLeft, showTradeToast } from './useTradeState'
import type { TradeSearchEntry } from './useTradeData'
import { resolveCardThumbnailUrl, resolveCardPreview } from './image-sources'
import { useCardSelection, type SelectedCard } from './useCardSelection'
import { SelectionMenu } from './SelectionMenu'
import { buildSelectionEditActions } from './selection-edit-actions'
import type { FlatBulkEdit } from '../editor/flat-list-controller'
import { ExportMenu, type ExportFormat } from './ExportMenu'
import { collectionToText, collectionToMarkdown, collectionToCsv } from '../editor/list-export'

// Collections always have a specific printing, so 'printing' grouping does not apply.
type CollectionGroupBy = Exclude<GroupBy, 'printing'>
type MetaEntry = { label: string; value: string }
type GroupedEntry = { entry: CollectionCardEntry; count: number }

interface CollectionPageProps {
  name: string
  /** Slug of this list, threaded into selected cards so cross-list edits can target it. */
  slug?: string
  entries: CollectionCardEntry[]
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
  const selection = useCardSelection({ kind: 'collection', name: props.name })
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
    { value: 'none', label: 'None' },
  ])

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
    groupByValues: groupByOptions().map((o) => o.value as CollectionGroupBy),
    enabled: props.enableUrlState,
  })
  const [groupDuplicates, setGroupDuplicates] = createSignal(false)
  const [showChangelog, setShowChangelog] = createSignal(false)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  // Aggregate copy counts per card variant for correct trade maxQty.
  // Mirrors the groupKey logic in useTradeData to ensure consistent deduplication.
  const collectionQtyMap = createMemo(() => {
    const map = new Map<string, number>()
    for (const entry of props.entries) {
      if (entry.note) continue
      const key = `${entry.name}|${entry.set.toLowerCase()}|${entry.collectorNumber}|${entry.finish}|${entry.condition}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  })

  const buildCollectionSearchEntry = (
    entry: CollectionCardEntry,
    scryfallCard: ScryfallCard | null,
  ): TradeSearchEntry => {
    const groupKey = `${entry.name}|${entry.set.toLowerCase()}|${entry.collectorNumber}|${entry.finish}|${entry.condition}`
    const maxQty = entry.note ? 1 : (collectionQtyMap().get(groupKey) ?? 1)
    return {
      name: entry.name,
      nameLower: entry.name.toLowerCase(),
      set: entry.set.toLowerCase(),
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      note: entry.note,
      price: entry.price,
      scryfallCard,
      sourceName: props.name,
      sourceKind: 'collection',
      maxQty,
      cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
    }
  }

  const handleCollectionAddToTrade = (entry: CollectionCardEntry) => {
    const cardKey = `${entry.set.toLowerCase()}:${entry.collectorNumber}`
    const scryfallCard = props.cards[cardKey] ?? null
    const searchEntry = buildCollectionSearchEntry(entry, scryfallCard)
    const added = addEntryToLeft(searchEntry, props.currency)
    if (added)
      showTradeToast(
        searchEntry.name,
        resolveCardThumbnailUrl(scryfallCard, props.useScryfallImgUrls ?? false),
      )
  }

  const isCollectionCardAddDisabled = (entry: CollectionCardEntry): boolean => {
    const cardKey = `${entry.set.toLowerCase()}:${entry.collectorNumber}`
    const scryfallCard = props.cards[cardKey] ?? null
    const searchEntry = buildCollectionSearchEntry(entry, scryfallCard)
    return !canAddMoreToLeft(searchEntry)
  }

  const currencyEntries = createMemo((): CollectionCardEntry[] => {
    sessionCacheVersion() // re-price after an in-session "Update Prices"
    return props.entries.map((entry) => {
      const cardKey = `${entry.set.toLowerCase()}:${entry.collectorNumber}`
      const card = overlayCard(props.cards[cardKey] ?? null)
      if (!card) return entry
      const price = getCardPriceForFinish(card, entry.finish, props.currency)
      return { ...entry, price }
    })
  })

  const computedTotalPrice = createMemo(() => {
    return currencyEntries().reduce((sum, e) => sum + e.price, 0)
  })

  // Build flat card list from entries
  const allCards = createMemo((): CardData[] => {
    if (groupDuplicates()) {
      // Group identical entries (same name+set+CN+finish+condition)
      const grouped = new Map<string, GroupedEntry>()
      for (const entry of currencyEntries()) {
        const key = `${entry.name}|${entry.set}|${entry.collectorNumber}|${entry.finish}|${entry.condition}`
        const existing = grouped.get(key)
        if (existing) {
          existing.count++
        } else {
          grouped.set(key, { entry, count: 1 })
        }
      }

      const result: CardData[] = []
      for (const { entry, count } of grouped.values()) {
        const cardKey = `${entry.set.toLowerCase()}:${entry.collectorNumber}`
        const card = overlayCard(props.cards[cardKey] ?? null)
        result.push({
          name: entry.name,
          quantity: count,
          cmc: card?.cmc ?? 0,
          edhrec: card?.edhrec_rank ?? 999999,
          price: entry.price,
          type: card?.type_line ?? '',
          section: entry.section,
          fileOrder: entry.fileOrder,
          setCode: entry.set,
          colorIdentity: card?.color_identity ?? [],
          hasPrinting: true,
          oracleTags: card?.oracleTags ?? [],
          artTags: card?.artTags ?? [],
          card,
        })
      }
      return result
    }

    return currencyEntries().map((entry) => {
      const cardKey = `${entry.set.toLowerCase()}:${entry.collectorNumber}`
      const card = overlayCard(props.cards[cardKey] ?? null)
      return {
        name: entry.name,
        quantity: 1,
        cmc: card?.cmc ?? 0,
        edhrec: card?.edhrec_rank ?? 999999,
        price: entry.price,
        type: card?.type_line ?? '',
        section: entry.section,
        fileOrder: entry.fileOrder,
        setCode: entry.set,
        colorIdentity: card?.color_identity ?? [],
        hasPrinting: true,
        oracleTags: card?.oracleTags ?? [],
        artTags: card?.artTags ?? [],
        card,
      }
    })
  })

  // Seed the session cache from this collection's baked card data so the editor's
  // card search and the trade page reuse it instead of re-fetching from Scryfall.
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

  // Find the modal entry and card
  const modalEntry = createMemo((): CollectionCardEntry | null => {
    if (!props.modalCardKey) return null
    const idx = parseInt(props.modalCardKey, 10)
    if (!isNaN(idx) && currencyEntries()[idx]) return currencyEntries()[idx] ?? null
    return null
  })

  const modalCard = createMemo((): ScryfallCard | null => {
    if (!modalEntry()) return null
    const cardKey = `${modalEntry()!.set}:${modalEntry()!.collectorNumber}`
    return props.cards[cardKey] ?? null
  })

  const modalAddToTrade = createMemo(() => {
    const entry = modalEntry()
    if (!entry || props.editMode || props.onCardMove) return undefined
    return () => handleCollectionAddToTrade(entry)
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
      map.set(`${e.name}|${e.set}|${e.fileOrder}`, i)
    })
    return map
  })

  const findEntryIndex = (cardData: CardData): number => {
    return entryIndexMap().get(`${cardData.name}|${cardData.setCode}|${cardData.fileOrder}`) ?? -1
  }

  // All card IDs a tile represents: every entry sharing the grouped tile's
  // name+set+CN+finish+condition (or just the single entry when not grouping).
  const groupCardIds = (entry: CollectionCardEntry): number[] => {
    if (!groupDuplicates()) {
      return entry.cardId !== undefined ? [entry.cardId] : []
    }
    return currencyEntries()
      .filter(
        (e) =>
          e.name === entry.name &&
          e.set === entry.set &&
          e.collectorNumber === entry.collectorNumber &&
          e.finish === entry.finish &&
          e.condition === entry.condition,
      )
      .map((e) => e.cardId)
      .filter((id): id is number => id !== undefined)
  }

  const renderCollectionCard = (c: CardData) => {
    const entryIdx = findEntryIndex(c)
    const entry = currencyEntries()[entryIdx]
    const showTrade = !props.editMode && !props.onCardMove && entry !== undefined
    const selectKey = String(entryIdx)
    const buildSelected = (): SelectedCard => {
      const preview = resolveCardPreview(c.card, Boolean(props.useScryfallImgUrls))
      return {
        key: selectKey,
        name: c.name,
        set: entry?.set.toLowerCase(),
        collectorNumber: entry?.collectorNumber,
        finish: entry?.finish,
        condition: entry?.condition,
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
        symbolMap={props.symbolMap}
        viewMode={viewMode()}
        hideCount={!groupDuplicates()}
        useScryfallImgUrls={props.useScryfallImgUrls}
        onCardClick={() => props.onOpenModal(String(entryIdx))}
        onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
        onTooltipLeave={() => setTooltip(null)}
        collectionFinish={entry?.finish}
        collectionCondition={entry?.condition}
        collectionSetCN={entry ? `${entry.set.toUpperCase()}:${entry.collectorNumber}` : undefined}
        collectionPrice={entry?.price}
        currency={props.currency}
        editMode={props.editMode}
        onIncrement={props.editMode && entry ? () => props.onCardIncrement?.(entry) : undefined}
        onDecrement={props.editMode && entry ? () => props.onCardDecrement?.(entry) : undefined}
        onContextMenu={
          props.editMode ? (rect) => props.onCardContextMenu?.(contextInfo(), rect) : undefined
        }
        onMove={props.onCardMove ? (rect) => props.onCardMove!(contextInfo(), rect) : undefined}
        onAddToTrade={showTrade ? () => handleCollectionAddToTrade(entry) : undefined}
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
    parts.push({ label: 'price', value: formatPriceOrNA(entry.price, props.currency) })
    parts.push({
      label: 'set',
      value: `${entry.set.toUpperCase()}:${entry.collectorNumber}`,
    })
    if (entry.finish) {
      parts.push({
        label: 'finish',
        value: capitalize(entry.finish),
      })
    }
    if (entry.condition) {
      parts.push({ label: 'condition', value: entry.condition })
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

  const serializeCollection = (format: ExportFormat): string => {
    switch (format) {
      case 'txt':
        return collectionToText(props.entries)
      case 'md':
        return collectionToMarkdown(props.name, props.entries, sectionOrder())
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
            {props.entries.length} cards · Total:{' '}
            {formatPrice(computedTotalPrice(), props.currency)}
          </p>
        </div>
        <Show
          when={
            props.onCombine || props.enableExport || (props.changelog && props.changelog.length > 0)
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
              <ExportMenu serialize={serializeCollection} name={props.name} />
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
        extraToggles={[
          {
            label: 'Group Duplicates',
            checked: groupDuplicates(),
            onChange: () => setGroupDuplicates((prev) => !prev),
          },
        ]}
        priceRefresh={props.enablePriceRefresh ? prices : undefined}
        selectionMenu={
          <SelectionMenu
            selection={selection}
            currency={props.currency}
            enableTrade={props.enableTrade}
            useScryfallImgUrls={props.useScryfallImgUrls}
            editActions={editActions()}
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
