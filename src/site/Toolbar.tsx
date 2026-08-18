import type { Component, JSX } from 'solid-js'
import { Show, For, Index, createMemo, createSignal } from 'solid-js'
import type {
  ViewMode,
  CardSize,
  SortBy,
  SortLayer,
  SelectOption,
  PriceGroupStrategy,
} from './card-sorting'
import type { PriceCurrency } from '../price-currency'
import type { CardLabelSelection } from '../card-labels'
import { useStuck } from './useStuck'
import { FilterMenu } from './FilterMenu'
import { QuickFilter } from './QuickFilter'
import type { CardFiltersControl } from './useCardFilters'
import { useMobileLayout, usePointerCoarse } from '../ui/useMediaQuery'
import { BottomSheet } from '../ui/BottomSheet'
import { selectionModeActive, toggleSelectionMode } from './selection-mode'
import type { SellModeControl } from './sell-mode'
import { buylistLoading } from './buylist-quotes'
import { PriceSourceSelect } from './PriceSourceSelect'
import { pricesEnabled } from './price-view'
import { BUYERS, buyerName, parseBuyerId, type BuyerId } from '../buylist'
import type { MessageKey } from '../i18n/messages/en'
import { useI18n } from '../ui/i18n'

/** Present on an {@link ExtraToggle} ⇒ it is inert, for the reason it carries. */
type ExtraToggleLock = {
  /** Shown as the toggle's `title`, explaining why it cannot be used. */
  reason: string
}

type ExtraToggle = {
  label: string
  checked: boolean
  onChange: () => void
  /** Set to lock the toggle: the state it controls is unavailable right now. */
  locked?: ExtraToggleLock
}

/** One row of the sell-mode buyer dropdown, with its name already rendered. */
type BuyerOption = {
  id: BuyerId
  name: string
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
  /** Show the Labels filter chips (label-bearing views only). */
  showLabelsFilter?: boolean
  /** Which label chips the row offers; omitted means the whole vocabulary. */
  availableLabels?: readonly CardLabelSelection[]
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

/**
 * Tooltips for the view-mode and card-size buttons, as message *keys* rather
 * than rendered text — these tables are evaluated once at import, so a table of
 * strings would keep the toolbar in the boot-time language after a locale
 * switch. Resolved where they are rendered.
 *
 * They also replace a `capitalize(mode)`/`capitalize(size)` concatenation,
 * which left the visible text with no string a translator could ever find.
 */
const VIEW_MODE_TITLES = {
  binder: 'site.viewMode.binder',
  overlap: 'site.viewMode.overlap',
  stack: 'site.viewMode.stack',
  list: 'site.viewMode.list',
} as const satisfies Record<ViewMode, MessageKey>

/** The single-letter glyph on each card-size button. Not translated. */
const CARD_SIZE_LABELS: Record<CardSize, string> = {
  large: 'L',
  medium: 'M',
  small: 'S',
}

const CARD_SIZE_TITLES = {
  large: 'site.cardSize.large',
  medium: 'site.cardSize.medium',
  small: 'site.cardSize.small',
} as const satisfies Record<CardSize, MessageKey>

const CARD_SIZES: readonly CardSize[] = ['large', 'medium', 'small']

type ToolbarSelectProps<T extends string> = {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
}

/**
 * A toolbar `<select>` whose option list can change while it is mounted.
 *
 * Turning sell mode on or off adds and removes group/sort options, and the
 * pages rebuild those option arrays on every read, so the option list is
 * recreated wholesale. A plain `value={...}` binding does not re-run for that —
 * it only tracks the value — so the browser falls back to the first option and
 * the control ends up naming a grouping the page is not using. Marking the
 * matching option `selected` ties the displayed choice to the value however the
 * list is rebuilt.
 *
 * `<Index>` rather than `<For>` for the same reason the sort layers use it: the
 * options are a positional list rebuilt on every read, so reference keying would
 * tear down and recreate every `<option>` on any change.
 */
function ToolbarSelect<T extends string>(props: ToolbarSelectProps<T>): JSX.Element {
  // The DOM hands back a plain string, so the chosen option is resolved against
  // the list rather than asserted — one narrowing here instead of one per caller.
  const select = (raw: string): void => {
    const option = props.options.find((o) => o.value === raw)
    if (option) props.onChange(option.value)
  }
  return (
    <select
      class="toolbar-select"
      value={props.value}
      onChange={(e) => select(e.currentTarget.value)}
    >
      <Index each={props.options}>
        {(opt) => (
          <option value={opt().value} selected={opt().value === props.value}>
            {opt().label}
          </option>
        )}
      </Index>
    </select>
  )
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
  const { t, locale } = useI18n()
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
            title={t(VIEW_MODE_TITLES[mode])}
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
      <For each={CARD_SIZES}>
        {(size) => (
          <button
            class={props.cardSize === size ? 'active' : ''}
            title={t(CARD_SIZE_TITLES[size])}
            onClick={() => props.onCardSizeChange(size)}
          >
            {CARD_SIZE_LABELS[size]}
          </button>
        )}
      </For>
    </div>
  )

  const selectModeToggle = () => (
    <Show when={coarse()}>
      <button
        type="button"
        class="toolbar-toggle"
        classList={{ active: selectionModeActive() }}
        aria-pressed={selectionModeActive()}
        title={t('site.toolbar.selectModeTitle')}
        onClick={toggleSelectionMode}
      >
        {t('site.toolbar.selectMode')}
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
      availableLabels={props.availableLabels}
      showBuylistFilter={Boolean(props.sell?.active)}
    />
  )

  // `buyerName` renders through the module-level (non-reactive) `t`, so this
  // memo reads the locale signal itself to re-derive the option list on a
  // language switch. The store writes the runtime locale before the signal, so
  // the names re-render in the new language rather than one behind.
  const buyerOptions = createMemo<BuyerOption[]>(() => {
    locale()
    return BUYERS.map((id) => ({ id, name: buyerName(id) }))
  })

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
              title={busy() ? t('site.toolbar.sellModeBusyTitle') : t('site.toolbar.sellModeTitle')}
              onClick={() => sell().onToggle()}
            >
              {t('site.toolbar.sellMode')}
              <Show when={busy()}>
                <span class="toolbar-busy-spinner" aria-hidden="true" />
              </Show>
            </button>
            {/* Mounted unconditionally so its text *changes* — a live region
                created at the same moment as its content does not announce. */}
            <span class="visually-hidden" role="status">
              {busy() ? t('site.toolbar.sellModeBusyStatus') : ''}
            </span>
            <Show when={sell().active}>
              <div class="toolbar-group">
                <label class="toolbar-label" for="buylist-buyer">
                  {t('site.toolbar.buyerLabel')}
                </label>
                <select
                  id="buylist-buyer"
                  class="toolbar-select"
                  value={sell().buyer}
                  onChange={(e) => sell().onBuyerChange(parseBuyerId(e.currentTarget.value))}
                >
                  <For each={buyerOptions()}>
                    {(buyer) => <option value={buyer.id}>{buyer.name}</option>}
                  </For>
                </select>
              </div>
            </Show>
          </>
        )
      }}
    </Show>
  )

  // The price-source selector: which store the page's USD prices come from. The
  // same control the card modal and the printing pickers render — one shared
  // component over one module-level signal, so switching it anywhere switches
  // it everywhere.
  const sourceControls = (
    <PriceSourceSelect
      currency={props.currency}
      id="price-source"
      groupClass="toolbar-group"
      labelClass="toolbar-label"
      selectClass="toolbar-select"
    />
  )

  // With prices hidden (`priceSources: []`), the price grouping and sort make
  // no sense — every value would be 0 — so their options disappear with the
  // rest of the price UI. The buylist (sell mode) options are money the buyer
  // pays and deliberately stay.
  const groupByOptions = () =>
    pricesEnabled() ? props.groupByOptions : props.groupByOptions.filter((o) => o.value !== 'price')
  const sortByOptions = () =>
    pricesEnabled() ? props.sortByOptions : props.sortByOptions.filter((o) => o.value !== 'price')

  const groupSelect = () => (
    <ToolbarSelect
      value={props.groupBy}
      options={groupByOptions()}
      onChange={props.onGroupByChange}
    />
  )

  const bracketsSelect = () => (
    <select
      class="toolbar-select"
      value={props.priceGroupStrategy}
      onChange={(e) =>
        props.onPriceGroupStrategyChange(e.currentTarget.value as PriceGroupStrategy)
      }
    >
      <option value="archidekt">{t('site.brackets.archidekt')}</option>
      <option value="five">{t('site.brackets.five')}</option>
      <option value="ten">{t('site.brackets.ten')}</option>
    </select>
  )

  // A new layer defaults to the first sort field not already in use, so adding a
  // layer never silently duplicates one; falls back to the first option if every
  // field is somehow taken.
  const firstUnusedSort = (): SortBy => {
    const used = new Set(props.sortLayers.map((l) => l.sortBy))
    const opt = sortByOptions().find((o) => !used.has(o.value))
    return opt?.value ?? sortByOptions()[0]?.value ?? 'name'
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
  const canAddLayer = () => props.sortLayers.length < sortByOptions().length

  const sortControls = () => (
    <div class="toolbar-sort-layers">
      {/* <Index> (index-keyed) not <For> (reference-keyed): layers are a positional
          list whose values change in place, and every edit rebuilds the array, so
          reference keying would needlessly recreate each row's <select> on any change. */}
      <Index each={props.sortLayers}>
        {(layer, index) => (
          <div class="toolbar-sort-layer">
            <ToolbarSelect
              value={layer().sortBy}
              options={sortByOptions()}
              onChange={(sortBy) => setLayerField(index, sortBy)}
            />
            <button
              type="button"
              class="toolbar-toggle toolbar-sort-reverse"
              classList={{ active: layer().reverse }}
              aria-pressed={layer().reverse}
              title={
                layer().reverse ? t('site.toolbar.sortDescending') : t('site.toolbar.sortAscending')
              }
              aria-label={t('site.toolbar.sortReverse')}
              onClick={() => toggleLayerReverse(index)}
            >
              <span aria-hidden="true">↑↓</span>
            </button>
            <Show when={props.sortLayers.length > 1}>
              <button
                type="button"
                class="toolbar-toggle toolbar-sort-remove"
                title={t('site.toolbar.sortRemove')}
                aria-label={t('site.toolbar.sortRemove')}
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
          title={t('site.toolbar.sortAdd')}
          aria-label={t('site.toolbar.sortAdd')}
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
        <span aria-hidden="true">↑↓</span> {t('site.toolbar.reverseSections')}
      </button>
    </Show>
  )

  // Index, not For: the array is rebuilt on every toggle, so a keyed For would
  // destroy and recreate the button on each click — dropping focus and
  // re-announcing the control instead of changing its state.
  const extraToggleButtons = () => (
    <Show when={props.extraToggles}>
      {(toggles) => (
        <Index each={toggles()}>
          {(toggle) => (
            <button
              type="button"
              class="toolbar-toggle"
              classList={{ active: toggle().checked }}
              aria-pressed={toggle().checked}
              // aria-disabled, not the native attribute: a `disabled` button takes
              // no pointer or focus events, so its `title` never surfaces and the
              // reason it is locked becomes undiscoverable.
              aria-disabled={Boolean(toggle().locked)}
              title={toggle().locked?.reason}
              onClick={() => {
                if (!toggle().locked) toggle().onChange()
              }}
            >
              {toggle().label}
            </button>
          )}
        </Index>
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
                {t('site.toolbar.sortSheet')} <span aria-hidden="true">▾</span>
              </button>
              {selectModeToggle()}
              {sourceControls}
              {sellControls}
              {filterMenu}
              {props.selectionMenu}
              <BottomSheet
                open={sortSheetOpen()}
                onClose={() => setSortSheetOpen(false)}
                title={t('site.toolbar.sortSheetTitle')}
              >
                <div class="sheet-controls">
                  <div class="sheet-control">
                    <span class="sheet-control-label">{t('site.toolbar.sheetGroup')}</span>
                    {groupSelect()}
                  </div>
                  <Show when={props.groupBy === 'price' || props.groupBy === 'buylist-price'}>
                    <div class="sheet-control">
                      <span class="sheet-control-label">{t('site.toolbar.sheetBrackets')}</span>
                      {bracketsSelect()}
                    </div>
                  </Show>
                  <div class="sheet-control">
                    <span class="sheet-control-label">{t('site.toolbar.sheetSort')}</span>
                    {sortControls()}
                  </div>
                  <Show when={props.groupBy !== 'none'}>
                    <div class="sheet-control">
                      <span class="sheet-control-label">{t('site.toolbar.sheetOrder')}</span>
                      <div class="sheet-control-group">{reverseGroupsToggle()}</div>
                    </div>
                  </Show>
                  <Show when={props.viewMode !== 'list'}>
                    <div class="sheet-control">
                      <span class="sheet-control-label">{t('site.toolbar.sheetCardSize')}</span>
                      {sizeToggle()}
                    </div>
                  </Show>
                  <Show when={props.extraToggles && props.extraToggles.length > 0}>
                    <div class="sheet-control">
                      <span class="sheet-control-label">{t('site.toolbar.sheetExtras')}</span>
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
            <label class="toolbar-label">{t('site.toolbar.groupLabel')}</label>
            {groupSelect()}
          </div>
          <Show when={props.groupBy === 'price' || props.groupBy === 'buylist-price'}>
            <div class="toolbar-group">
              <label class="toolbar-label">{t('site.toolbar.bracketsLabel')}</label>
              {bracketsSelect()}
            </div>
          </Show>
          <div class="toolbar-group">
            <label class="toolbar-label">{t('site.toolbar.sortLabel')}</label>
            {sortControls()}
          </div>
          {reverseGroupsToggle()}
          {extraToggleButtons()}
          {selectModeToggle()}
          {sourceControls}
          {sellControls}
          {filterMenu}
          {props.selectionMenu}
        </Show>
        {/* Outside both layout branches: it is positioned against the toolbar
            box rather than laid out in the row, and its "just start typing"
            capture is the same on either width. */}
        <QuickFilter filters={props.filters} />
      </div>
    </>
  )
}
