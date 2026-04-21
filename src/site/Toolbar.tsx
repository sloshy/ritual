import type { Component } from 'solid-js'
import { Show, For } from 'solid-js'
import type { ViewMode, CardSize, SortBy, PriceGroupStrategy } from './card-sorting'
import { capitalize } from './utils'

type SelectOption = { value: string; label: string }

type ExtraCheckbox = {
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
  hideLands: boolean
  onHideLandsChange: () => void
  extraCheckboxes?: ExtraCheckbox[]
}

const VIEW_MODE_ICONS: Record<ViewMode, string> = {
  binder: '▦',
  list: '☰',
  overlap: '⧗',
  stack: '▥',
}

const CARD_SIZE_LABELS: Record<CardSize, string> = {
  large: 'L',
  medium: 'M',
  small: 'S',
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  return (
    <div class="toolbar">
      <div class="view-toggle">
        {(['binder', 'list', 'overlap', 'stack'] as ViewMode[]).map((mode) => (
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
      <label class="toolbar-checkbox">
        <input type="checkbox" checked={props.reverse} onChange={props.onReverseChange} />
        Reverse
      </label>
      <Show when={props.groupBy !== 'none'}>
        <label class="toolbar-checkbox">
          <input
            type="checkbox"
            checked={props.reverseGroups}
            onChange={props.onReverseGroupsChange}
          />
          Reverse Sections
        </label>
      </Show>
      <label class="toolbar-checkbox">
        <input type="checkbox" checked={props.hideLands} onChange={props.onHideLandsChange} />
        Hide Lands
      </label>
      <Show when={props.extraCheckboxes}>
        {(checkboxes) => (
          <For each={checkboxes()}>
            {(cb) => (
              <label class="toolbar-checkbox">
                <input type="checkbox" checked={cb.checked} onChange={cb.onChange} />
                {cb.label}
              </label>
            )}
          </For>
        )}
      </Show>
    </div>
  )
}
