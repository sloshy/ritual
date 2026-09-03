import type { Component, JSX } from 'solid-js'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import type { PriceCurrency } from '../pricing/price-currency'
import { cardPriceText, cardPricelessReason } from '../list-view/priceless'
import { type GroupBy, type SortBy, groupTotalPrice } from '../list-view/card-sorting'
import { CardModal } from '../list-view/CardModal'
import { PageCountAndTotal } from './PageStats'
import type { SellModeProps } from '../list-view/sell-mode'
import { finishName, rarityName } from '../list-view/printing-display'
import { CardSection } from './CardSection'
import { ListPageShell } from './ListPageShell'
import { useListPage, type ListPageDefaults } from './useListPage'
import {
  useCombinedSelection,
  type SelectionListId,
  type SelectionSourceKind,
} from '../list-view/useCardSelection'
import { addSelectedCardToTrade, canAddSelectedCardToTrade } from './useSelectionTrade'
import type { MetaEntry } from '../list-view/meta-entry'
import type { CombinedCardData, NamedListRef } from '../list-view/combined-list'
import { combinedGroupByOptions, type GroupByOption } from './list-page-options'
import {
  CARD_LABEL_SELECTIONS,
  cardLabelName,
  labelFiltersFor,
  type CardLabelSelection,
} from '../card/card-labels'
import { useT } from '../ui/i18n'

// The sort fields the combined view offers, in order — shared by the toolbar's
// dropdown options and the URL sync's validation of incoming sort layers.
const COMBINED_SORT_BYS: readonly SortBy[] = [
  'name',
  'cmc',
  'price',
  'color-identity',
  'set-code',
  'edhrec',
  'file-order',
  'tags',
]

/** Group by source list, sorted by name — the view's URL-omitted default. */
const COMBINED_DEFAULTS: ListPageDefaults<GroupBy> = { groupBy: 'source', sortBy: 'name' }

/**
 * The label chips a combined view offers — and the `labels=` values a shared
 * URL may name here: the union of what its lists' kinds accept (collections
 * take the whole vocabulary, decks `proxy` alone, wanted lists nothing), plus
 * the "unlabeled" chip, in canonical order. Empty when no selected list can
 * carry a label at all, which is what hides the row.
 *
 * Derived per kind from {@link labelFiltersFor} — the same derivation the
 * single-list pages use — and from the list *kinds* rather than the loaded
 * cards, since it must answer before any detail has arrived.
 */
export function combinedLabelFilters(
  kinds: readonly SelectionSourceKind[],
): readonly CardLabelSelection[] {
  const available = new Set<CardLabelSelection>()
  for (const kind of kinds) for (const value of labelFiltersFor(kind)) available.add(value)
  if (available.size === 0) return []
  return CARD_LABEL_SELECTIONS.filter((value) => available.has(value))
}

interface CombinedCardsViewProps extends SellModeProps {
  /** The already-built combined cards to display (flattened across source lists). */
  cards: CombinedCardData[]
  /** Merged mana-symbol lookup for the displayed cards. */
  symbolMap: Record<string, string>
  /** The source lists the cards belong to, scoping the multi-select menu. */
  selectionLists: SelectionListId[]
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Offer "Add to Trade" on each tile and in the multi-select menu (public site only). */
  enableTrade?: boolean
  /** Page heading. */
  title: string
  /** Optional content rendered under the stats line (e.g. the source-list list). */
  header?: JSX.Element
  /** While true, a spinner replaces the (empty) card grid. */
  loading?: boolean
  /** When set, an error banner replaces the card grid. */
  error?: JSX.Element | string
  /** Message shown when there are no cards and we are neither loading nor errored. */
  emptyMessage?: string
  /** Mirror the toolbar/filter state into the URL query so the view is shareable (combined-list view only). */
  enableUrlState?: boolean
  /**
   * Every list, for the share filters. The view's own member lists stay
   * offered — a card trivially "shares" with its own source list.
   */
  shareLists?: readonly NamedListRef[]
}

/**
 * The shared rendering surface for a flattened, multi-source card list: the
 * toolbar (group/sort/filter), source-aware grouping, multi-select menu, hover
 * tooltip, and card detail modal. Backs both the combined-list view and the
 * Find page's "Search Results" view — callers build {@link CombinedCardData}
 * themselves and hand it in, along with the title and header.
 *
 * Everything it shares with the single-list pages comes from the list-page
 * frame ({@link useListPage} + {@link ListPageShell}); what it holds itself is
 * a selection scoped to a *set* of lists rather than one, and source-derived
 * grouping. It has no list identity of its own — no slug, so no share-filter
 * self-exclusion, no card-nav target, and no per-tile ⋯ menu (the frame mounts
 * the menu element, but these tiles never open it).
 */
export const CombinedCardsView: Component<CombinedCardsViewProps> = (props) => {
  const t = useT()
  const [modalTile, setModalTile] = createSignal<CombinedCardData | null>(null)

  const sectionOrder = createMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const c of props.cards) {
      if (!seen.has(c.section)) {
        seen.add(c.section)
        order.push(c.section)
      }
    }
    return order
  })

  const hasCollections = createMemo(() => props.cards.some((c) => c.sourceKind === 'collection'))

  /** The label chips this view offers; empty hides the row entirely. */
  const labelFilters = createMemo(() =>
    combinedLabelFilters(props.selectionLists.map((l) => l.kind)),
  )

  // `sellMode` is a parameter rather than a read of the toolbar signal so the URL
  // sync can ask for the *full* option set (what a shared link may legally name)
  // while the dropdown shows only what is currently offered.
  const groupByOptionsFor = (sellMode: boolean): readonly GroupByOption[] =>
    combinedGroupByOptions(sellMode, sectionOrder().length >= 2, hasCollections())

  // Scoped to the view's lists, not to one: `selected`/`count`/`clear` cover
  // every member list, while the tiles below key on already-global keys.
  const selection = useCombinedSelection(() => props.selectionLists)

  const page = useListPage<GroupBy, CombinedCardData>({
    selection,
    options: {
      groupByOptionsFor,
      sortBys: COMBINED_SORT_BYS,
      // A card's position within its own source list, across several of them.
      sortByOverrides: { 'file-order': 'domain.sortBy.listOrder' },
      availableLabels: labelFilters,
      defaults: COMBINED_DEFAULTS,
    },
    cards: () => props.cards,
    sectionOrder,
    currency: () => props.currency,
    enableSellMode: () => Boolean(props.enableSellMode),
    bakedBuylist: props.bakedBuylist,
    enableUrlState: () => props.enableUrlState,
    shareLists: () => props.shareLists,
  })

  const totalPrice = createMemo(() => groupTotalPrice(props.cards))
  const cardCount = createMemo(() => props.cards.reduce((sum, c) => sum + c.quantity, 0))

  const modalMeta = createMemo((): MetaEntry[] | undefined => {
    const card = modalTile()
    if (!card) return undefined
    const tile = card.selectedTile
    const parts: MetaEntry[] = [
      { label: 'price', value: cardPriceText(t, card, card.price, props.currency) },
      { label: 'list', value: card.sourceName },
    ]
    if (card.hasPrinting && tile.set) {
      parts.push({ label: 'set', value: `${tile.set.toUpperCase()}:${tile.collectorNumber}` })
    }
    if (tile.finish) parts.push({ label: 'finish', value: finishName(t, tile.finish) })
    if (tile.condition) parts.push({ label: 'condition', value: tile.condition })
    if (card.labels.length > 0) {
      parts.push({
        label: 'labels',
        value: card.labels.map(cardLabelName).join(' · '),
      })
    }
    if (card.card) parts.push({ label: 'rarity', value: rarityName(t, card.card.rarity) })
    return parts
  })

  /**
   * Per-tile "Add to Trade" — one copy, off the tile's own selection payload, so
   * the keep-guard and the name-only printing prompt behave exactly as they do
   * from the multi-select menu. Independent of the current selection: clicking
   * "+" on a tile neither requires nor disturbs one.
   */
  const addTileToTrade = (c: CombinedCardData): Promise<number> =>
    addSelectedCardToTrade(c.selectedTile, {
      currency: props.currency,
      useScryfallImgUrls: props.useScryfallImgUrls,
    })

  /** The modal's "Add to Trade" action, or undefined where the modal offers none. */
  type ModalTradeAction = { add: () => void; disabled: boolean }

  // One memo rather than a pair: the handler and its disabled flag answer the
  // same question about the same card, and split memos could disagree.
  const modalTrade = createMemo((): ModalTradeAction | undefined => {
    const card = modalTile()
    if (!card || !props.enableTrade) return undefined
    return {
      add: () => void addTileToTrade(card),
      disabled: !canAddSelectedCardToTrade(card.selectedTile),
    }
  })

  const renderTile = (c: CombinedCardData) => (
    <CardItem
      name={c.name}
      quantity={c.quantity}
      card={c.card}
      customArt={c.customArt}
      priceless={cardPricelessReason(c)}
      symbolMap={props.symbolMap}
      buylistPrice={c.buylistPrice}
      viewMode={page.toolbar.viewMode()}
      hideCount={c.quantity <= 1}
      useScryfallImgUrls={props.useScryfallImgUrls}
      onCardClick={() => setModalTile(c)}
      onTooltipEnter={(src, sideways) => page.tooltip.setTooltip({ src, sideways })}
      onTooltipLeave={() => page.tooltip.setTooltip(null)}
      collectionFinish={c.selectedTile.finish}
      collectionCondition={c.selectedTile.condition}
      collectionLanguage={c.selectedTile.language}
      collectionSetCN={
        c.hasPrinting && c.selectedTile.set
          ? `${c.selectedTile.set.toUpperCase()}:${c.selectedTile.collectorNumber}`
          : undefined
      }
      collectionPrice={c.price}
      labelBadges={c.labels.length > 0 ? c.labels : undefined}
      currency={props.currency}
      selectable
      selectState={selection.state(c.selectKey)}
      onToggleSelect={() => selection.toggle(c.selectedTile)}
      onAddToTrade={props.enableTrade ? () => void addTileToTrade(c) : undefined}
      // Unconditional: CardItem reads this only inside the `onAddToTrade`
      // guard, so it is never evaluated while the button is hidden.
      addToTradeDisabled={!canAddSelectedCardToTrade(c.selectedTile)}
    />
  )

  return (
    <ListPageShell
      page={page}
      title={props.title}
      fullWidth={false}
      currency={props.currency}
      symbolMap={props.symbolMap}
      useScryfallImgUrls={props.useScryfallImgUrls}
      enableTrade={props.enableTrade}
      statsLead={
        <PageCountAndTotal count={cardCount()} total={totalPrice()} currency={props.currency} />
      }
      headerExtra={props.header}
      beforeCards={
        <>
          <Show when={props.error}>
            <div class="error-container">{props.error}</div>
          </Show>

          <Show when={props.loading}>
            <div class="loading-container">
              <div class="loading-spinner" />
            </div>
          </Show>

          <Show when={!props.loading && props.cards.length === 0 && !props.error}>
            <div class="combined-empty">{props.emptyMessage ?? t('site.combined.empty')}</div>
          </Show>
        </>
      }
      sections={
        <For each={page.cardGroups()}>
          {(group) => (
            <CardSection
              label={group.key}
              cards={group.cards}
              currency={props.currency}
              renderCard={renderTile}
            />
          )}
        </For>
      }
      overlays={
        <CardModal
          open={Boolean(modalTile())}
          card={modalTile()?.card ?? null}
          customArt={modalTile()?.customArt}
          hasCustomArt={modalTile()?.hasCustomArt}
          cardName={modalTile()?.name ?? null}
          symbolMap={props.symbolMap}
          useScryfallImgUrls={props.useScryfallImgUrls}
          currency={props.currency}
          printings={modalTile()?.printings ?? []}
          onClose={() => setModalTile(null)}
          meta={modalMeta()}
          onAddToTrade={modalTrade()?.add}
          addToTradeDisabled={modalTrade()?.disabled}
          note={modalTile()?.selectedTile.note}
          tags={modalTile()?.tags}
        />
      }
    />
  )
}
