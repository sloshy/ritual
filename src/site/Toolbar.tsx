import type { Component, JSX } from 'solid-js'
import { Show, For, Index, createSignal } from 'solid-js'
import type {
  ViewMode,
  CardSize,
  SortBy,
  SortLayer,
  SelectOption,
  PriceGroupStrategy,
} from './card-sorting'
import type { PriceCurrency } from '../price-currency'
import { capitalize } from './utils'
import { useStuck } from './useStuck'
import { FilterMenu } from './FilterMenu'
import type { CardFiltersControl } from './useCardFilters'
import { useMobileLayout, usePointerCoarse } from '../ui/useMediaQuery'
import { BottomSheet } from '../ui/BottomSheet'
import { selectionModeActive, toggleSelectionMode } from './selection-mode'
import type { SellModeControl } from './sell-mode'
import { buylistLoading } from './buylist-quotes'
import { BUYERS, BUYER_DISPLAY_NAMES, parseBuyerId } from '../buylist'

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
  /** The ordered multi-level sort. Always non-empty. */
  sortLayers: SortLayer[]
  sortByOptions: SelectOption<SortBy>[]
  /** Replace the entire sort-layer list (add/remove/reorder/edit a layer). */
  onSortLayersChange: (layers: SortLayer[]) => void
  priceGroupStrategy: PriceGroupStrategy
  onPriceGroupStrategyChange: (value: PriceGroupStrategy) => void
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
  /** Show the Labels filter chips (collection-bearing views only). */
  showLabelsFilter?: boolean
  /** Sell-mode toggle and buyer selector; omitted on pages that do not offer sell mode. */
  sell?: SellModeControl
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
      showLabelsFilter={props.showLabelsFilter}
      showBuylistFilter={Boolean(props.sell?.active)}
    />
  )

  // Built once and shared by both layout branches, like `filterMenu`: crossing
  // the mobile breakpoint must move the same instance rather than remount it.
  const sellControls = (
    <Show when={props.sell}>
      {(sell) => {
        // Sell mode turns on a frame after the click (see `engageSellMode`), and
        // the button is what shows that the click registered — so it reads the
        // engaging flag as well as the mode itself.
        const pressed = (): boolean => sell().active || sell().engaging()
        // Gated on the mode, not just the global store: quotes keep loading
        // after a toggle-off, and a button spinning for work whose result is no
        // longer displayed is worse than no spinner.
        const busy = (): boolean => pressed() && buylistLoading()
        return (
          <>
            <button
              type="button"
              class="toolbar-toggle toolbar-sell-toggle"
              classList={{ active: pressed() }}
              aria-pressed={pressed()}
              // Marks the control's own state as in-flux for assistive tech —
              // it suppresses interim announcements rather than making one. The
              // announcement is the live region below.
              aria-busy={busy()}
              title={
                busy()
                  ? 'Sell mode: fetching buylist prices…'
                  : 'Sell mode: show buylist prices and filters'
              }
              onClick={() => sell().onToggle()}
            >
              Sell mode
              <Show when={busy()}>
                <span class="toolbar-busy-spinner" aria-hidden="true" />
              </Show>
            </button>
            {/* Mounted unconditionally so its text *changes* — a live region
                created at the same moment as its content does not announce. */}
            <span class="visually-hidden" role="status">
              {busy() ? 'Fetching buylist prices' : ''}
            </span>
            <Show when={sell().active}>
              <div class="toolbar-group">
                <label class="toolbar-label" for="buylist-buyer">
                  Buyer:
                </label>
                <select
                  id="buylist-buyer"
                  class="toolbar-select"
                  value={sell().buyer}
                  onChange={(e) => sell().onBuyerChange(parseBuyerId(e.currentTarget.value))}
                >
                  <For each={BUYERS}>
                    {(buyer) => <option value={buyer}>{BUYER_DISPLAY_NAMES[buyer]}</option>}
                  </For>
                </select>
              </div>
            </Show>
          </>
        )
      }}
    </Show>
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

  // A new layer defaults to the first sort field not already in use, so adding a
  // layer never silently duplicates one; falls back to the first option if every
  // field is somehow taken.
  const firstUnusedSort = (): SortBy => {
    const used = new Set(props.sortLayers.map((l) => l.sortBy))
    const opt = props.sortByOptions.find((o) => !used.has(o.value))
    return opt?.value ?? props.sortByOptions[0]?.value ?? 'name'
  }
  // The select's raw string value is validated back to a SortBy against the known
  // options rather than asserted, so a stray value can never enter a sort layer.
  const selectLayerField = (index: number, rawValue: string) => {
    const opt = props.sortByOptions.find((o) => o.value === rawValue)
    if (opt) setLayerField(index, opt.value)
  }
  const setLayerField = (index: number, sortBy: SortBy) =>
    props.onSortLayersChange(props.sortLayers.map((l, i) => (i === index ? { ...l, sortBy } : l)))
  const toggleLayerReverse = (index: number) =>
    props.onSortLayersChange(
      props.sortLayers.map((l, i) => (i === index ? { ...l, reverse: !l.reverse } : l)),
    )
  const addLayer = () =>
    props.onSortLayersChange([...props.sortLayers, { sortBy: firstUnusedSort(), reverse: false }])
  const removeLayer = (index: number) =>
    props.onSortLayersChange(props.sortLayers.filter((_, i) => i !== index))
  const canAddLayer = () => props.sortLayers.length < props.sortByOptions.length

  const sortControls = () => (
    <div class="toolbar-sort-layers">
      {/* <Index> (index-keyed) not <For> (reference-keyed): layers are a positional
          list whose values change in place, and every edit rebuilds the array, so
          reference keying would needlessly recreate each row's <select> on any change. */}
      <Index each={props.sortLayers}>
        {(layer, index) => (
          <div class="toolbar-sort-layer">
            <select
              class="toolbar-select"
              value={layer().sortBy}
              onChange={(e) => selectLayerField(index, e.currentTarget.value)}
            >
              <For each={props.sortByOptions}>
                {(opt) => <option value={opt.value}>{opt.label}</option>}
              </For>
            </select>
            <button
              type="button"
              class="toolbar-toggle toolbar-sort-reverse"
              classList={{ active: layer().reverse }}
              aria-pressed={layer().reverse}
              title={layer().reverse ? 'Sorted descending' : 'Sorted ascending'}
              aria-label="Reverse this sort"
              onClick={() => toggleLayerReverse(index)}
            >
              <span aria-hidden="true">↑↓</span>
            </button>
            <Show when={props.sortLayers.length > 1}>
              <button
                type="button"
                class="toolbar-toggle toolbar-sort-remove"
                title="Remove this sort"
                aria-label="Remove this sort"
                onClick={() => removeLayer(index)}
              >
                <span aria-hidden="true">−</span>
              </button>
            </Show>
          </div>
        )}
      </Index>
      <Show when={canAddLayer()}>
        <button
          type="button"
          class="toolbar-toggle toolbar-sort-add"
          title="Add another sort"
          aria-label="Add another sort"
          onClick={addLayer}
        >
          <span aria-hidden="true">+</span>
        </button>
      </Show>
    </div>
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
              {sellControls}
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
                  <Show when={props.groupBy === 'price' || props.groupBy === 'buylist-price'}>
                    <div class="sheet-control">
                      <span class="sheet-control-label">Brackets</span>
                      {bracketsSelect()}
                    </div>
                  </Show>
                  <div class="sheet-control">
                    <span class="sheet-control-label">Sort</span>
                    {sortControls()}
                  </div>
                  <Show when={props.groupBy !== 'none'}>
                    <div class="sheet-control">
                      <span class="sheet-control-label">Order</span>
                      <div class="sheet-control-group">{reverseGroupsToggle()}</div>
                    </div>
                  </Show>
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
          <Show when={props.groupBy === 'price' || props.groupBy === 'buylist-price'}>
            <div class="toolbar-group">
              <label class="toolbar-label">Brackets:</label>
              {bracketsSelect()}
            </div>
          </Show>
          <div class="toolbar-group">
            <label class="toolbar-label">Sort:</label>
            {sortControls()}
          </div>
          {reverseGroupsToggle()}
          {extraToggleButtons()}
          {selectModeToggle()}
          {sellControls}
          {filterMenu}
          {props.selectionMenu}
        </Show>
      </div>
    </>
  )
}
