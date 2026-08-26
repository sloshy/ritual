import type { Component } from 'solid-js'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { useT } from '../ui/i18n'
import type { MessageKey } from '../i18n/messages/en'
import type { PriceCurrency } from '../pricing/price-currency'
import { formatPrice } from '../pricing/price-currency'
import { cardPricelessMarkerText } from '../list-view/priceless'
import type { TradeCardEntry } from '../list/site-data'
import { TradeCardRow } from './TradeCardRow'
import { isCardSideways, resolveCardImageSources } from '../card/image-sources'
import { sortTradeCards } from './trade-sort'
import type { TradeSortBy, TradeSortState } from './trade-sort'
import type { TradeSearchEntry } from './useTradeData'

export type AutocompleteItem =
  | { kind: 'local'; entry: TradeSearchEntry }
  /** A bare card name from the card-search backend — the live API's cache, or Scryfall. */
  | { kind: 'search'; name: string }

/**
 * Which cards a column's search box covers. The left column switches between its
 * two with the "include decks" toggle. The right column's depends on the Scryfall
 * toggle *and* on whether a live backend is answering searches: with one, its
 * cache covers every card, so wanted lists and the cache are searched together
 * ({@link TradeColumnMode `wanted-cache`}) and the toggle has nothing left to do.
 */
export type TradeColumnMode =
  | 'collection'
  | 'collection-decks'
  | 'wanted'
  | 'scryfall'
  | 'wanted-cache'

/** The row under the search box: a mode switch, or a note when the mode is fixed. */
export type TradeColumnModeControl =
  | { kind: 'toggle'; label: string; active: boolean; onChange: () => void }
  | { kind: 'note'; text: string }

/**
 * Every key this table's copy may name. Narrower than `MessageKey` so `t()` can
 * render one without params, and `Extract` turns a key that no longer exists in
 * the catalog into `never` — a compile error at the table below.
 */
type TradeModeMessageKey = Extract<MessageKey, `site.tradeMode.${string}`>

/**
 * One search mode's copy. Every text field is a {@link MessageKey}, not rendered
 * text: this table is evaluated once at module load, so a string here would
 * freeze the column's pill, placeholder, and empty state in whatever language
 * the bundle booted in.
 */
type TradeColumnModeCopy = {
  /** `source-pill` modifier class, which colours the pill's dot. */
  tone: 'collection' | 'deck' | 'wanted' | 'scryfall'
  label: TradeModeMessageKey
  placeholderKey: TradeModeMessageKey
  emptyMessage: TradeModeMessageKey
  /** Subline for a bare card-name suggestion; `null` in modes that yield none. */
  searchLabel: TradeModeMessageKey | null
}

const MODE_COPY: Record<TradeColumnMode, TradeColumnModeCopy> = {
  collection: {
    tone: 'collection',
    label: 'site.tradeMode.collection.label',
    placeholderKey: 'site.tradeMode.collection.placeholder',
    emptyMessage: 'site.tradeMode.collection.empty',
    searchLabel: null,
  },
  'collection-decks': {
    tone: 'deck',
    label: 'site.tradeMode.collectionDecks.label',
    placeholderKey: 'site.tradeMode.collectionDecks.placeholder',
    emptyMessage: 'site.tradeMode.collectionDecks.empty',
    searchLabel: null,
  },
  wanted: {
    tone: 'wanted',
    label: 'site.tradeMode.wanted.label',
    placeholderKey: 'site.tradeMode.wanted.placeholder',
    emptyMessage: 'site.tradeMode.wanted.empty',
    searchLabel: null,
  },
  scryfall: {
    tone: 'scryfall',
    label: 'site.tradeMode.scryfall.label',
    placeholderKey: 'site.tradeMode.scryfall.placeholder',
    emptyMessage: 'site.tradeMode.scryfall.empty',
    searchLabel: 'site.tradeMode.scryfall.searchLabel',
  },
  'wanted-cache': {
    tone: 'wanted',
    label: 'site.tradeMode.wantedCache.label',
    placeholderKey: 'site.tradeMode.wantedCache.placeholder',
    emptyMessage: 'site.tradeMode.wantedCache.empty',
    searchLabel: 'site.tradeMode.wantedCache.searchLabel',
  },
}

// Defer the suggest-hide past the click handler so onMouseDown on a suggestion can fire first.
const SUGGEST_HIDE_DELAY_MS = 150

export interface TradeColumnProps {
  side: 'left' | 'right'
  cards: TradeCardEntry[]
  sort: TradeSortState
  currency: PriceCurrency
  useScryfallImgUrls?: boolean
  onSortChange: (by: TradeSortBy) => void
  onReverseToggle: () => void
  onRemove: (card: TradeCardEntry) => void
  onUpdateQty: (card: TradeCardEntry, delta: number) => void
  onEdit: (card: TradeCardEntry) => void
  searchQuery: string
  onSearchInput: (q: string) => void
  autocompleteItems: AutocompleteItem[]
  autocompleteLoading: boolean
  onAutocompleteSelect: (item: AutocompleteItem) => void
  mode: TradeColumnMode
  modeControl: TradeColumnModeControl
  hidden: boolean
  onTooltipEnter: (src: string, sideways: boolean) => void
  onTooltipLeave: () => void
}

export const TradeColumn: Component<TradeColumnProps> = (props) => {
  const t = useT()
  const [showSuggest, setShowSuggest] = createSignal(false)
  let inputRef: HTMLInputElement | undefined

  const sortedCards = createMemo(() => sortTradeCards(props.cards, props.sort))
  const totalPrice = createMemo(() => props.cards.reduce((s, c) => s + (c.price ?? 0) * c.qty, 0))
  const totalCount = createMemo(() => props.cards.reduce((s, c) => s + c.qty, 0))

  const title = () => (props.side === 'left' ? t('site.trade.offering') : t('site.trade.receiving'))

  const copy = (): TradeColumnModeCopy => MODE_COPY[props.mode]

  // Read the control once per recompute: the parent passes an object literal, so
  // every read of the prop allocates a new one — narrowing a second read would
  // be describing a different object than the one rendered.
  const modeToggle = createMemo(() => {
    const control = props.modeControl
    return control.kind === 'toggle' ? control : null
  })
  const modeNote = createMemo(() => {
    const control = props.modeControl
    return control.kind === 'note' ? control : null
  })

  const handleInputChange = (value: string) => {
    props.onSearchInput(value)
    setShowSuggest(value.length >= 2)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowSuggest(false)
      props.onSearchInput('')
    }
    if (e.key === 'Enter' && props.autocompleteItems.length > 0) {
      const first = props.autocompleteItems[0]
      if (first) handleSelect(first)
    }
  }

  const handleSelect = (item: AutocompleteItem) => {
    props.onAutocompleteSelect(item)
    setShowSuggest(false)
    if (inputRef) inputRef.value = ''
    props.onSearchInput('')
  }

  const suggestionThumb = (item: AutocompleteItem): string | null => {
    if (item.kind !== 'local' || !item.entry.scryfallCard) return null
    const { frontImage } = resolveCardImageSources(
      item.entry.scryfallCard,
      Boolean(props.useScryfallImgUrls),
    )
    return frontImage || null
  }

  const suggestionSubline = (item: AutocompleteItem): string => {
    if (item.kind === 'search') {
      const searchLabel = copy().searchLabel
      return searchLabel === null ? '' : t(searchLabel)
    }
    const { entry } = item
    switch (entry.sourceKind) {
      case 'collection':
        return entry.sourceName
      case 'deck':
        return t('site.tradeColumn.fromDeck', { name: entry.sourceName })
      case 'wanted':
        return t('site.tradeColumn.fromWanted', { name: entry.sourceName })
    }
  }

  const suggestionSet = (item: AutocompleteItem): string => {
    if (item.kind === 'search') return ''
    const set = item.entry.set?.toUpperCase()
    if (!set) return ''
    return item.entry.collectorNumber ? `${set}:${item.entry.collectorNumber}` : set
  }

  const suggestionPrice = (item: AutocompleteItem): string => {
    if (item.kind === 'search') return ''
    // Same rule as the rows the suggestion becomes: a proxy or custom-art copy
    // reads as its marker rather than as the printing's price.
    const marker = cardPricelessMarkerText(t, item.entry)
    if (marker !== undefined) return marker
    const price = item.entry.price
    if (price === undefined || price <= 0) return t('site.tradeColumn.priceUnavailable')
    return formatPrice(price, props.currency)
  }

  const handleSuggestionThumbEnter = (item: AutocompleteItem) => {
    const src = suggestionThumb(item)
    if (!src) return
    const sideways = item.kind === 'local' ? isCardSideways(item.entry.scryfallCard) : false
    props.onTooltipEnter(src, sideways)
  }

  return (
    <section class="trade-col" classList={{ 'is-hidden': props.hidden }} data-side={props.side}>
      <div class="trade-col-head">
        <div class="trade-col-title-row">
          <h2 class="trade-col-title">{title()}</h2>
          <span class="trade-col-meta">
            {t('ui.count.cards', { count: totalCount() })} ·{' '}
            <strong>{totalPrice() > 0 ? formatPrice(totalPrice(), props.currency) : '—'}</strong>
          </span>
        </div>
        <div class="trade-col-source">
          <span class={`source-pill ${copy().tone}`}>
            <span class="source-dot" />
            {t(copy().label)}
          </span>
        </div>
      </div>

      <div class="col-search">
        <div class="search-inputwrap">
          <span class="search-icon">⌕</span>
          <input
            ref={inputRef}
            type="text"
            class="search-input"
            placeholder={t(copy().placeholderKey)}
            value={props.searchQuery}
            onInput={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (props.searchQuery.length >= 2) setShowSuggest(true)
            }}
            onBlur={() => setTimeout(() => setShowSuggest(false), SUGGEST_HIDE_DELAY_MS)}
            autocomplete="off"
          />
          <Show when={props.autocompleteLoading}>
            <span class="trade-search-spinner" />
          </Show>
        </div>

        <div class="search-mode-row">
          <Show when={modeToggle()}>
            {(toggle) => (
              <label class="search-mode-toggle">
                <input
                  type="checkbox"
                  checked={toggle().active}
                  onChange={() => toggle().onChange()}
                />
                <span class="switch" />
                <span>{toggle().label}</span>
              </label>
            )}
          </Show>
          <Show when={modeNote()}>
            {(note) => <span class="search-mode-note">{note().text}</span>}
          </Show>
        </div>

        <Show when={showSuggest()}>
          <div class="search-suggest">
            <Show
              when={props.autocompleteItems.length > 0}
              fallback={
                <Show when={!props.autocompleteLoading}>
                  <div class="search-suggest-empty">{t('site.tradeColumn.noSuggestions')}</div>
                </Show>
              }
            >
              <For each={props.autocompleteItems}>
                {(item) => {
                  const thumb = suggestionThumb(item)
                  return (
                    <div
                      class="search-suggest-row"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSelect(item)
                      }}
                    >
                      <div
                        class="search-suggest-thumb"
                        onMouseEnter={() => handleSuggestionThumbEnter(item)}
                        onMouseLeave={props.onTooltipLeave}
                      >
                        <Show when={thumb} fallback={<span>—</span>}>
                          {(src) => <img src={src()} alt="" loading="lazy" />}
                        </Show>
                      </div>
                      <div class="search-suggest-name">
                        {item.kind === 'local' ? item.entry.name : item.name}
                        <span class="small">{suggestionSubline(item)}</span>
                      </div>
                      <span class="search-suggest-set">{suggestionSet(item)}</span>
                      <Show when={item.kind === 'local'}>
                        <span class="search-suggest-price">{suggestionPrice(item)}</span>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>
      </div>

      <div class="col-toolbar">
        <span class="col-toolbar-label">{t('site.tradeColumn.sort')}</span>
        <div class="view-toggle">
          <button
            classList={{ active: props.sort.by === 'name' }}
            onClick={() => props.onSortChange('name')}
          >
            {t('site.tradeColumn.sortName')}
          </button>
          <button
            classList={{ active: props.sort.by === 'price' }}
            onClick={() => props.onSortChange('price')}
          >
            {t('site.tradeColumn.sortPrice')}
          </button>
        </div>
        <button
          class="toolbar-toggle"
          classList={{ active: props.sort.reverse }}
          onClick={props.onReverseToggle}
        >
          {props.sort.reverse ? t('site.tradeColumn.reversed') : t('site.tradeColumn.reverse')}
        </button>
      </div>

      <div class="trade-list">
        <Show
          when={sortedCards().length > 0}
          fallback={<div class="trade-list-empty">{t(copy().emptyMessage)}</div>}
        >
          <For each={sortedCards()}>
            {(card) => (
              <TradeCardRow
                card={card}
                useScryfallImgUrls={props.useScryfallImgUrls}
                currency={props.currency}
                onRemove={() => props.onRemove(card)}
                onUpdateQty={(delta) => props.onUpdateQty(card, delta)}
                onEdit={card.editable ? () => props.onEdit(card) : undefined}
                onTooltipEnter={props.onTooltipEnter}
                onTooltipLeave={props.onTooltipLeave}
              />
            )}
          </For>
        </Show>
      </div>

      <div class="trade-col-foot">
        <span class="trade-col-foot-label">{t('site.tradeColumn.total')}</span>
        <span class="trade-col-foot-total">
          {totalPrice() > 0 ? formatPrice(totalPrice(), props.currency) : '—'}
        </span>
      </div>
    </section>
  )
}
