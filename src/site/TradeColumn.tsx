import type { Component } from 'solid-js'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { PriceCurrency } from '../price-currency'
import { formatPrice } from '../price-currency'
import type { TradeCardEntry } from './data-types'
import { TradeCardRow } from './TradeCardRow'
import { isCardSideways, resolveCardImageSources } from './image-sources'
import { sortTradeCards } from './trade-sort'
import type { TradeSortBy, TradeSortState } from './trade-sort'
import type { TradeSearchEntry } from './useTradeData'

export type AutocompleteItem =
  | { kind: 'local'; entry: TradeSearchEntry }
  | { kind: 'scryfall'; name: string }

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
  altMode: boolean
  onAltModeChange: () => void
  hidden: boolean
  onTooltipEnter: (src: string, sideways: boolean) => void
  onTooltipLeave: () => void
}

export const TradeColumn: Component<TradeColumnProps> = (props) => {
  const [showSuggest, setShowSuggest] = createSignal(false)
  let inputRef: HTMLInputElement | undefined

  const sortedCards = createMemo(() => sortTradeCards(props.cards, props.sort))
  const totalPrice = createMemo(() => props.cards.reduce((s, c) => s + (c.price ?? 0) * c.qty, 0))
  const totalCount = createMemo(() => props.cards.reduce((s, c) => s + c.qty, 0))

  const title = () => (props.side === 'left' ? 'Offering' : 'Receiving')

  const sourceTone = () => {
    if (props.side === 'left') return props.altMode ? 'deck' : 'collection'
    return props.altMode ? 'scryfall' : 'wanted'
  }

  const sourceLabel = () => {
    if (props.side === 'left') return props.altMode ? 'Collection + Decks' : 'Collection'
    return props.altMode ? 'Scryfall' : 'Wanted List'
  }

  const searchPlaceholder = () => {
    if (props.side === 'left') {
      return props.altMode ? 'Search collections + decks…' : 'Search your collections…'
    }
    return props.altMode ? "Scryfall search: e.g. 't:creature c:r'" : 'Search your wanted lists…'
  }

  const altModeLabel = () =>
    props.side === 'left' ? 'Include cards in decks' : 'Search Scryfall instead'

  const emptyMessage = () => {
    if (props.side === 'left') {
      return props.altMode
        ? 'No cards yet. Search above to add from your collections or decks.'
        : 'No cards yet. Search above to add from your collections.'
    }
    return props.altMode
      ? 'No cards yet. Search Scryfall above to add any printing.'
      : 'No cards yet. Search above to add from a wanted list.'
  }

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
    if (item.kind === 'scryfall') return 'Scryfall'
    const { entry } = item
    switch (entry.sourceKind) {
      case 'collection':
        return entry.sourceName
      case 'deck':
        return `In ${entry.sourceName}`
      case 'wanted':
        return `from ${entry.sourceName}`
    }
  }

  const suggestionSet = (item: AutocompleteItem): string => {
    if (item.kind === 'scryfall') return ''
    const set = item.entry.set?.toUpperCase()
    if (!set) return ''
    return item.entry.collectorNumber ? `${set}:${item.entry.collectorNumber}` : set
  }

  const suggestionPrice = (item: AutocompleteItem): string => {
    if (item.kind === 'scryfall') return ''
    const price = item.entry.price
    if (price === undefined || price <= 0) return 'N/A'
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
            {totalCount()} {totalCount() === 1 ? 'card' : 'cards'} ·{' '}
            <strong>{totalPrice() > 0 ? formatPrice(totalPrice(), props.currency) : '—'}</strong>
          </span>
        </div>
        <div class="trade-col-source">
          <span class={`source-pill ${sourceTone()}`}>
            <span class="source-dot" />
            {sourceLabel()}
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
            placeholder={searchPlaceholder()}
            value={props.searchQuery}
            onInput={(e) => handleInputChange((e.target as HTMLInputElement).value)}
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
          <label class="search-mode-toggle">
            <input type="checkbox" checked={props.altMode} onChange={props.onAltModeChange} />
            <span class="switch" />
            <span>{altModeLabel()}</span>
          </label>
        </div>

        <Show when={showSuggest()}>
          <div class="search-suggest">
            <Show
              when={props.autocompleteItems.length > 0}
              fallback={
                <Show when={!props.autocompleteLoading}>
                  <div class="search-suggest-empty">No matches. Try a different query.</div>
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
        <span class="col-toolbar-label">Sort</span>
        <div class="view-toggle">
          <button
            classList={{ active: props.sort.by === 'name' }}
            onClick={() => props.onSortChange('name')}
          >
            Name
          </button>
          <button
            classList={{ active: props.sort.by === 'price' }}
            onClick={() => props.onSortChange('price')}
          >
            Price
          </button>
        </div>
        <button
          class="toolbar-toggle"
          classList={{ active: props.sort.reverse }}
          onClick={props.onReverseToggle}
        >
          {props.sort.reverse ? '↑↓ Reversed' : '↑↓ Reverse'}
        </button>
      </div>

      <div class="trade-list">
        <Show
          when={sortedCards().length > 0}
          fallback={<div class="trade-list-empty">{emptyMessage()}</div>}
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
        <span class="trade-col-foot-label">Total</span>
        <span class="trade-col-foot-total">
          {totalPrice() > 0 ? formatPrice(totalPrice(), props.currency) : '—'}
        </span>
      </div>
    </section>
  )
}
