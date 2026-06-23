import type { Component, JSX } from 'solid-js'
import { Show, For } from 'solid-js'
import type { ViewMode, CardSize, SortBy, PriceGroupStrategy } from './card-sorting'
import { capitalize } from './utils'
import { useStuck } from './useStuck'
import { UpdatePricesButton } from './PriceControls'
import type { PriceRefresh } from './usePriceRefresh'
import { FilterMenu } from './FilterMenu'
import type { CardFiltersControl } from './useCardFilters'

type SelectOption = { value: string; label: string }

type ExtraToggle = {
  label: string
  checked: boolean
  onChange: () => void
}

interface ToolbarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  cardSize: CardSize
  onCardSizeChange: (size: CardSize) => void
  groupBy: string
  groupByOptions: SelectOption[]
  onGroupByChange: (value: string) => void
  sortBy: SortBy
  sortByOptions: SelectOption[]
  onSortByChange: (value: SortBy) => void
  priceGroupStrategy: PriceGroupStrategy
  onPriceGroupStrategyChange: (value: PriceGroupStrategy) => void
  reverse: boolean
  onReverseChange: () => void
  reverseGroups: boolean
  onReverseGroupsChange: () => void
  filters: CardFiltersControl
  symbolMap: Record<string, string>
  /** Lowercase set codes present in the list, for the set filter autocomplete. */
  setCodeOptions: string[]
  /** Lowercase card type tags present in the list, for the type filter autocomplete. */
  cardTypeOptions: string[]
  /** Show the "Hide Extras" filter toggle (deck pages only). */
  showHideExtras?: boolean
  extraToggles?: ExtraToggle[]
  /** When set, a right-aligned "Update Prices" button is shown (public list pages). */
  priceRefresh?: PriceRefresh
  /** Bulk multi-select actions control; rendered only while cards are selected. */
  selectionMenu?: JSX.Element
}

const VIEW_MODE_ICONS: Record<ViewMode, string> = {
  binder: '▦',
  overlap: '⧉',
  stack: '▤',
  list: '☰',
}

const CARD_SIZE_LABELS: Record<CardSize, string> = {
  large: 'L',
  medium: 'M',
  small: 'S',
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const { stuck, sentinelRef } = useStuck()
  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" class="toolbar-sentinel" />
      <div class="toolbar" classList={{ 'is-stuck': stuck() }}>
        <div class="view-toggle">
          {(['binder', 'overlap', 'stack', 'list'] as ViewMode[]).map((mode) => (
            <button
              data-view={mode}
              class={props.viewMode === mode ? 'active' : ''}
              title={`${capitalize(mode)} View`}
              onClick={() => props.onViewModeChange(mode)}
            >
              {VIEW_MODE_ICONS[mode]}
            </button>
          ))}
        </div>
        <Show when={props.viewMode !== 'list'}>
          <div class="view-toggle">
            {(['large', 'medium', 'small'] as CardSize[]).map((size) => (
              <button
                class={props.cardSize === size ? 'active' : ''}
                title={`${capitalize(size)} cards`}
                onClick={() => props.onCardSizeChange(size)}
              >
                {CARD_SIZE_LABELS[size]}
              </button>
            ))}
          </div>
        </Show>
        <div class="toolbar-group">
          <label class="toolbar-label">Group:</label>
          <select
            class="toolbar-select"
            value={props.groupBy}
            onChange={(e) => props.onGroupByChange(e.currentTarget.value)}
          >
            <For each={props.groupByOptions}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
        </div>
        <Show when={props.groupBy === 'price'}>
          <div class="toolbar-group">
            <label class="toolbar-label">Brackets:</label>
            <select
              class="toolbar-select"
              value={props.priceGroupStrategy}
              onChange={(e) =>
                props.onPriceGroupStrategyChange(e.currentTarget.value as PriceGroupStrategy)
              }
            >
              <option value="archidekt">Archidekt</option>
              <option value="five">Every $5</option>
              <option value="ten">Every $10</option>
            </select>
          </div>
        </Show>
        <div class="toolbar-group">
          <label class="toolbar-label">Sort:</label>
          <select
            class="toolbar-select"
            value={props.sortBy}
            onChange={(e) => props.onSortByChange(e.currentTarget.value as SortBy)}
          >
            <For each={props.sortByOptions}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
        </div>
        <button
          type="button"
          class="toolbar-toggle"
          classList={{ active: props.reverse }}
          aria-pressed={props.reverse}
          onClick={props.onReverseChange}
        >
          <span aria-hidden="true">↑↓</span> Reverse
        </button>
        <Show when={props.groupBy !== 'none'}>
          <button
            type="button"
            class="toolbar-toggle"
            classList={{ active: props.reverseGroups }}
            aria-pressed={props.reverseGroups}
            onClick={props.onReverseGroupsChange}
          >
            <span aria-hidden="true">↑↓</span> Reverse Sections
          </button>
        </Show>
        <Show when={props.extraToggles}>
          {(toggles) => (
            <For each={toggles()}>
              {(t) => (
                <button
                  type="button"
                  class="toolbar-toggle"
                  classList={{ active: t.checked }}
                  aria-pressed={t.checked}
                  onClick={t.onChange}
                >
                  {t.label}
                </button>
              )}
            </For>
          )}
        </Show>
        <FilterMenu
          filters={props.filters}
          symbolMap={props.symbolMap}
          setCodeOptions={props.setCodeOptions}
          cardTypeOptions={props.cardTypeOptions}
          showHideExtras={props.showHideExtras}
        />
        {props.selectionMenu}
        <Show when={props.priceRefresh}>
          {(refresh) => (
            <div class="toolbar-price-refresh">
              <UpdatePricesButton prices={refresh()} />
            </div>
          )}
        </Show>
      </div>
    </>
  )
}
