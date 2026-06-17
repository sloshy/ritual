import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, on, onCleanup, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import { seedCards, seedPrintings, sessionCacheVersion } from './session-cache'
import type { PriceCurrency } from '../price-currency'
import { formatPrice, formatPriceOrNA } from '../price-currency'
import {
  type GroupBy,
  type CardGroup,
  groupAndSortCards,
  groupTotalPrice,
  CARD_SIZE_WIDTHS,
} from './card-sorting'
import { CardModal } from './CardModal'
import { capitalize } from './utils'
import { LIST_TYPE_DISPLAY, type ListType } from '../list-type'
import { useTooltip } from './useTooltip'
import { Toolbar } from './Toolbar'
import { CardSection } from './CardSection'
import { useToolbarState } from './useToolbarState'
import { useCardFilters } from './useCardFilters'
import { collectSetCodes, filterCards } from './card-filters'
import { useCombinedSelection, type SelectionListId } from './useCardSelection'
import { SelectionMenu } from './SelectionMenu'
import {
  type CombinedCardData,
  type LoadedListDetail,
  type NamedListRef,
  buildCombinedCards,
  listHref,
  loadCombinedDetails,
  mergeSymbolMaps,
  mergeCardMaps,
  mergePrintingMaps,
} from './combined-list'

type MetaEntry = { label: string; value: string }
type SelectOption = { value: string; label: string }

interface CombinedListPageProps {
  /** True when viewing every list ("All" was chosen in the modal or navbar). */
  all: boolean
  /** When `all`, restricts the view to a single list type (e.g. "all decks"). */
  allType?: ListType
  /** The resolved lists being combined (every matching list when `all`), in selection order. */
  lists: NamedListRef[]
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Offer "Add to Trade" in the multi-select menu (public site only). */
  enableTrade?: boolean
}

export const CombinedListPage: Component<CombinedListPageProps> = (props) => {
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
  } = useToolbarState<GroupBy>({ groupBy: 'source', sortBy: 'name' })
  const cardFilters = useCardFilters()
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  const [loaded, setLoaded] = createSignal<LoadedListDetail[] | null>(null)
  const [error, setError] = createSignal(false)
  const [modalTile, setModalTile] = createSignal<CombinedCardData | null>(null)

  // Fetch every selected list's detail JSON whenever the selection changes. The key
  // string keeps the effect from re-firing when the array identity changes but the
  // contents don't.
  const listsKey = createMemo(() => props.lists.map((l) => `${l.type}:${l.slug}`).join(','))
  createEffect(
    on(listsKey, () => {
      const refs = props.lists
      setLoaded(null)
      setError(false)
      setModalTile(null)
      if (refs.length === 0) {
        setLoaded([])
        return
      }
      const controller = new AbortController()
      onCleanup(() => controller.abort())
      void (async () => {
        try {
          const result = await loadCombinedDetails(refs, controller.signal)
          // Seed the shared session cache so the trade page reuses this data.
          seedCards(mergeCardMaps(result))
          seedPrintings(mergePrintingMaps(result))
          setLoaded(result)
        } catch (e) {
          if ((e as Error).name === 'AbortError') return
          console.error('Combined view: load failed', e)
          setError(true)
          setLoaded([])
        }
      })()
    }),
  )

  // Header description for an "all" view: every list, or every list of one type.
  // `null` for an explicit selection, which enumerates its lists instead.
  const allLabel = createMemo<string | null>(() => {
    if (!props.all) return null
    return props.allType
      ? `Viewing all ${LIST_TYPE_DISPLAY[props.allType].label.toLowerCase()}`
      : 'Viewing all cards from all lists'
  })

  const symbolMap = createMemo(() => mergeSymbolMaps(loaded() ?? []))

  const combinedCards = createMemo((): CombinedCardData[] => {
    sessionCacheVersion() // re-price after an in-session "Update Prices"
    const l = loaded()
    if (!l) return []
    return buildCombinedCards(l, props.currency, props.useScryfallImgUrls)
  })

  const sectionOrder = createMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const c of combinedCards()) {
      if (!seen.has(c.section)) {
        seen.add(c.section)
        order.push(c.section)
      }
    }
    return order
  })

  const hasCollections = createMemo(() => props.lists.some((l) => l.type === 'collection'))

  // Group-by options are the lowest common denominator of the combined list types,
  // plus "Source List". "Printing" only applies when no collection is present (every
  // collection card is pinned, so the distinction is meaningless once one is mixed in).
  const groupByOptions = createMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'source', label: 'Source List' }]
    if (sectionOrder().length >= 2) opts.push({ value: 'section', label: 'Section' })
    opts.push(
      { value: 'type', label: 'Type' },
      { value: 'cmc', label: 'Mana Value' },
      { value: 'color-identity', label: 'Color Identity' },
      { value: 'price', label: 'Price' },
    )
    if (!hasCollections()) opts.push({ value: 'printing', label: 'Printing' })
    opts.push({ value: 'none', label: 'None' })
    return opts
  })

  const selectionLists = createMemo<SelectionListId[]>(() =>
    props.lists.map((l) => ({ kind: l.type, name: l.name })),
  )
  const selection = useCombinedSelection(selectionLists)

  const setCodeOptions = createMemo(() => collectSetCodes(combinedCards()))

  const cardGroups = createMemo((): CardGroup<CombinedCardData>[] => {
    const working = filterCards(combinedCards(), cardFilters.filters)
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

  const totalPrice = createMemo(() => groupTotalPrice(combinedCards()))
  const cardCount = createMemo(() => combinedCards().reduce((sum, c) => sum + c.quantity, 0))

  const modalMeta = createMemo((): MetaEntry[] | undefined => {
    const t = modalTile()
    if (!t) return undefined
    const tile = t.selectedTile
    const parts: MetaEntry[] = [
      { label: 'price', value: formatPriceOrNA(t.price, props.currency) },
      { label: 'list', value: t.sourceName },
    ]
    if (t.hasPrinting && tile.set) {
      parts.push({ label: 'set', value: `${tile.set.toUpperCase()}:${tile.collectorNumber}` })
    }
    if (tile.finish) parts.push({ label: 'finish', value: capitalize(tile.finish) })
    if (tile.condition) parts.push({ label: 'condition', value: tile.condition })
    if (t.card) parts.push({ label: 'rarity', value: capitalize(t.card.rarity) })
    return parts
  })

  const renderTile = (c: CombinedCardData) => (
    <CardItem
      name={c.name}
      quantity={c.quantity}
      card={c.card}
      symbolMap={symbolMap()}
      viewMode={viewMode()}
      hideCount={c.quantity <= 1}
      useScryfallImgUrls={props.useScryfallImgUrls}
      onCardClick={() => setModalTile(c)}
      onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
      onTooltipLeave={() => setTooltip(null)}
      collectionFinish={c.selectedTile.finish}
      collectionCondition={c.selectedTile.condition}
      collectionSetCN={
        c.hasPrinting && c.selectedTile.set
          ? `${c.selectedTile.set.toUpperCase()}:${c.selectedTile.collectorNumber}`
          : undefined
      }
      collectionPrice={c.price}
      currency={props.currency}
      selectable
      selectState={selection.state(c.selectKey)}
      onToggleSelect={() => selection.toggle(c.selectedTile)}
    />
  )

  return (
    <div class="page-container">
      {/* Header */}
      <div class="page-header">
        <div>
          <h1 class="page-title">Combined List</h1>
          <p class="page-stats">
            {cardCount()} cards · Total: {formatPrice(totalPrice(), props.currency)}
          </p>
          <Show
            when={allLabel()}
            fallback={
              <p class="combined-sources">
                Combining:{' '}
                <For each={props.lists}>
                  {(l, i) => (
                    <>
                      <Show when={i() > 0}>{', '}</Show>
                      <a class="combined-source-name" href={listHref(l.type, l.slug)}>
                        {l.name}
                      </a>
                    </>
                  )}
                </For>
              </p>
            }
          >
            {(label) => <p class="combined-sources">{label()}</p>}
          </Show>
        </div>
      </div>

      <Toolbar
        viewMode={viewMode()}
        onViewModeChange={setViewMode}
        cardSize={cardSize()}
        onCardSizeChange={setCardSize}
        groupBy={groupBy()}
        groupByOptions={groupByOptions()}
        onGroupByChange={(v) => setGroupBy(v as GroupBy)}
        sortBy={sortBy()}
        sortByOptions={[
          { value: 'name', label: 'Name' },
          { value: 'cmc', label: 'Mana Value' },
          { value: 'price', label: 'Price' },
          { value: 'color-identity', label: 'Color Identity' },
          { value: 'set-code', label: 'Set Code' },
          { value: 'edhrec', label: 'EDHRec Rank' },
          { value: 'file-order', label: 'List Order' },
        ]}
        onSortByChange={setSortBy}
        priceGroupStrategy={priceGroupStrategy()}
        onPriceGroupStrategyChange={setPriceGroupStrategy}
        reverse={reverse()}
        onReverseChange={() => setReverse((prev) => !prev)}
        reverseGroups={reverseGroups()}
        onReverseGroupsChange={() => setReverseGroups((prev) => !prev)}
        filters={cardFilters}
        symbolMap={symbolMap()}
        setCodeOptions={setCodeOptions()}
        selectionMenu={
          <SelectionMenu
            selection={selection}
            currency={props.currency}
            enableTrade={props.enableTrade}
            useScryfallImgUrls={props.useScryfallImgUrls}
          />
        }
      />

      <Show when={error()}>
        <div class="error-container">Failed to load one or more lists.</div>
      </Show>

      <Show when={loaded() === null}>
        <div class="loading-container">
          <div class="loading-spinner" />
        </div>
      </Show>

      <Show when={loaded() !== null && combinedCards().length === 0 && !error()}>
        <div class="combined-empty">No cards to show.</div>
      </Show>

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
              renderCard={(c) => renderTile(c)}
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
        open={Boolean(modalTile())}
        card={modalTile()?.card ?? null}
        cardName={modalTile()?.name ?? null}
        symbolMap={symbolMap()}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency}
        printings={modalTile()?.printings ?? []}
        onClose={() => setModalTile(null)}
        meta={modalMeta()}
        note={modalTile()?.selectedTile.note}
      />
    </div>
  )
}
