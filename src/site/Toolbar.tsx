import type { Component, JSX } from 'solid-js'
import { Show, For, createSignal } from 'solid-js'
import type { ViewMode, CardSize, SortBy, PriceGroupStrategy } from './card-sorting'
import type { PriceCurrency } from '../price-currency'
import { capitalize } from './utils'
import { useStuck } from './useStuck'
import { FilterMenu } from './FilterMenu'
import type { CardFiltersControl } from './useCardFilters'
import { useMobileLayout, usePointerCoarse } from '../ui/useMediaQuery'
import { BottomSheet } from '../ui/BottomSheet'
import { selectionModeActive, toggleSelectionMode } from './selection-mode'

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
  /** Active currency, used to label and interpret the price filter. */
  currency: PriceCurrency
  /** Lowercase set codes present in the list, for the set filter autocomplete. */
  setCodeOptions: string[]
  /** Lowercase card type tags present in the list, for the type filter autocomplete. */
  cardTypeOptions: string[]
  /** Oracle tag slugs present in the list, for the oracle tag filter autocomplete. */
  oracleTagOptions: string[]
  /** Art tag slugs present in the list, for the art tag filter autocomplete. */
  artTagOptions: string[]
  /** Show the "Hide Extras" filter toggle (deck pages only). */
  showHideExtras?: boolean
  extraToggles?: ExtraToggle[]
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

/**
 * The list-page toolbar. Two layouts share one sticky container:
 *
 * - Desktop: every control inline — view mode, card size, group/sort selects,
 *   order toggles, filters, selection. ("Update prices" lives in the page
 *   header's button group instead, not in this toolbar.)
 * - Phone-width ({@link useMobileLayout}): a single compact row — view mode, a
 *   "Sort & Group" button opening a bottom sheet with the full grouping/sorting
 *   controls, and filters (with its active-count badge).
 *
 * Independently of width, coarse-pointer devices get a "Select" toggle (touch
 * selection mode — taps select cards) and lose the overlap/stack view modes,
 * whose fan-out interaction requires hover.
 */
export const Toolbar: Component<ToolbarProps> = (props) => {
  const { stuck, sentinelRef } = useStuck()
  const mobile = useMobileLayout()
  const coarse = usePointerCoarse()
  const [sortSheetOpen, setSortSheetOpen] = createSignal(false)

  // Overlap/stack reveal cards on hover, which touch devices don't have.
  const viewModes = (): ViewMode[] =>
    coarse() ? ['binder', 'list'] : ['binder', 'overlap', 'stack', 'list']

  const viewToggle = () => (
    <div class="view-toggle">
      <For each={viewModes()}>
        {(mode) => (
          <button
            data-view={mode}
            class={props.viewMode === mode ? 'active' : ''}
            title={`${capitalize(mode)} View`}
            onClick={() => props.onViewModeChange(mode)}
          >
            {VIEW_MODE_ICONS[mode]}
          </button>
        )}
      </For>
    </div>
  )

  const sizeToggle = () => (
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
  )

  const selectModeToggle = () => (
    <Show when={coarse()}>
      <button
        type="button"
        class="toolbar-toggle"
        classList={{ active: selectionModeActive() }}
        aria-pressed={selectionModeActive()}
        title="Selection mode: tap cards to select them"
        onClick={toggleSelectionMode}
      >
        Select
      </button>
    </Show>
  )

  // Created once and referenced from both layout branches (like
  // props.selectionMenu), so crossing the mobile/desktop breakpoint moves the
  // same instance instead of remounting it and dropping its open/validation state.
  const filterMenu = (
    <FilterMenu
      filters={props.filters}
      symbolMap={props.symbolMap}
      currency={props.currency}
      setCodeOptions={props.setCodeOptions}
      cardTypeOptions={props.cardTypeOptions}
      oracleTagOptions={props.oracleTagOptions}
      artTagOptions={props.artTagOptions}
      showHideExtras={props.showHideExtras}
    />
  )

  const groupSelect = () => (
    <select
      class="toolbar-select"
      value={props.groupBy}
      onChange={(e) => props.onGroupByChange(e.currentTarget.value)}
    >
      <For each={props.groupByOptions}>
        {(opt) => <option value={opt.value}>{opt.label}</option>}
      </For>
    </select>
  )

  const bracketsSelect = () => (
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
  )

  const sortSelect = () => (
    <select
      class="toolbar-select"
      value={props.sortBy}
      onChange={(e) => props.onSortByChange(e.currentTarget.value as SortBy)}
    >
      <For each={props.sortByOptions}>
        {(opt) => <option value={opt.value}>{opt.label}</option>}
      </For>
    </select>
  )

  const reverseToggle = () => (
    <button
      type="button"
      class="toolbar-toggle"
      classList={{ active: props.reverse }}
      aria-pressed={props.reverse}
      onClick={props.onReverseChange}
    >
      <span aria-hidden="true">↑↓</span> Reverse
    </button>
  )

  const reverseGroupsToggle = () => (
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
  )

  const extraToggleButtons = () => (
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
  )

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" class="toolbar-sentinel" />
      <div class="toolbar" classList={{ 'is-stuck': stuck() }}>
        <Show
          when={!mobile()}
          fallback={
            <>
              {viewToggle()}
              <button
                type="button"
                class="toolbar-toggle toolbar-sort-sheet-btn"
                aria-haspopup="dialog"
                aria-expanded={sortSheetOpen()}
                onClick={() => setSortSheetOpen(true)}
              >
                Sort <span aria-hidden="true">▾</span>
              </button>
              {selectModeToggle()}
              {filterMenu}
              {props.selectionMenu}
              <BottomSheet
                open={sortSheetOpen()}
                onClose={() => setSortSheetOpen(false)}
                title="Sort & Group"
              >
                <div class="sheet-controls">
                  <div class="sheet-control">
                    <span class="sheet-control-label">Group</span>
                    {groupSelect()}
                  </div>
                  <Show when={props.groupBy === 'price'}>
                    <div class="sheet-control">
                      <span class="sheet-control-label">Brackets</span>
                      {bracketsSelect()}
                    </div>
                  </Show>
                  <div class="sheet-control">
                    <span class="sheet-control-label">Sort</span>
                    {sortSelect()}
                  </div>
                  <div class="sheet-control">
                    <span class="sheet-control-label">Order</span>
                    <div class="sheet-control-group">
                      {reverseToggle()}
                      {reverseGroupsToggle()}
                    </div>
                  </div>
                  <Show when={props.viewMode !== 'list'}>
                    <div class="sheet-control">
                      <span class="sheet-control-label">Card size</span>
                      {sizeToggle()}
                    </div>
                  </Show>
                  <Show when={props.extraToggles && props.extraToggles.length > 0}>
                    <div class="sheet-control">
                      <span class="sheet-control-label">Extras</span>
                      <div class="sheet-control-group">{extraToggleButtons()}</div>
                    </div>
                  </Show>
                </div>
              </BottomSheet>
            </>
          }
        >
          {viewToggle()}
          <Show when={props.viewMode !== 'list'}>{sizeToggle()}</Show>
          <div class="toolbar-group">
            <label class="toolbar-label">Group:</label>
            {groupSelect()}
          </div>
          <Show when={props.groupBy === 'price'}>
            <div class="toolbar-group">
              <label class="toolbar-label">Brackets:</label>
              {bracketsSelect()}
            </div>
          </Show>
          <div class="toolbar-group">
            <label class="toolbar-label">Sort:</label>
            {sortSelect()}
          </div>
          {reverseToggle()}
          {reverseGroupsToggle()}
          {extraToggleButtons()}
          {selectModeToggle()}
          {filterMenu}
          {props.selectionMenu}
        </Show>
      </div>
    </>
  )
}
