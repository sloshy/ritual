import type { Component, JSX } from 'solid-js'
import { batch, createEffect, createSignal, For, on, Show } from 'solid-js'
import { AdaptiveMenu } from '../ui/AdaptiveMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
import { parseSetCodesInput, scanSetCodesInput } from '../set-codes'
import { colorIdentityName, WUBRG } from './card-sorting'
import {
  parseCopiesFilter,
  parseManaValueFilter,
  parsePriceFilter,
  toggleColorSelection,
  toggleLabelFilterOption,
  type LabelFilterOption,
  type NumericComparator,
  type NumericFilterParse,
} from './card-filters'
import { CARD_LABEL_DISPLAY_NAMES } from '../card-labels'
import { type PriceCurrency, getCurrencySymbol } from '../price-currency'
import { formatCardTypeForDisplay, parseCardTypesInput, scanCardTypeInput } from './card-types'
import {
  COLOR_MATCH_MODES,
  FILTER_MATCH_MODES,
  SET_CODE_FILTER_MODES,
  type FilterMatchMode,
} from './filter-mode'
import { TagsInput } from './TagsInput'
import type { CardFiltersControl } from './useCardFilters'
import { useDebouncedInput, type DebouncedInput } from './useDebouncedInput'

/**
 * Wide enough for the header row to hold all three "Hide" toggles plus Clear on
 * one line (deck pages show the most), which also lets the Color Identity row fit
 * its label and four match modes without wrapping.
 *
 * Only feeds the anchored-popover placement math — `.filter-menu-panel` in
 * shared.css sets the width that actually renders, so keep the two in step.
 */
const PANEL_WIDTH = 380

/** Display name for the colorless swatch — `colorIdentityName([])` is "Colorless". */
const COLORLESS_NAME = colorIdentityName([])

/** A numeric filter value as the string its input field shows ('' when unset). */
function numericFieldText(value: number | null): string {
  return value === null ? '' : String(value)
}

/**
 * A debounced numeric filter field (Mana Value, Price, Copies): mirrors the store
 * value as text, and on each debounced commit parses the draft, surfaces a validation
 * error, and applies the parsed value only when it is valid.
 */
function useNumericFilterInput(
  current: () => number | null,
  parse: (raw: string) => NumericFilterParse,
  setError: (error: string | null) => void,
  apply: (value: number | null) => void,
): DebouncedInput {
  return useDebouncedInput(
    () => numericFieldText(current()),
    (raw) => {
      const parsed = parse(raw)
      setError(parsed.ok ? null : parsed.error)
      if (parsed.ok) apply(parsed.value)
    },
  )
}

type ComparatorOption = { value: NumericComparator; label: string }

/** Shared comparator choices for the numeric (mana value, price, copies) filters. */
const COMPARATOR_OPTIONS: ComparatorOption[] = [
  { value: '=', label: '=' },
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
]

/** One button in a filter's match-mode segmented control. */
type FilterModeOption<M extends string> = { value: M; label: string; title: string }

type FilterModeToggleProps<M extends string> = {
  /** Accessible name for the group, e.g. "Card type match mode". */
  ariaLabel: string
  options: readonly FilterModeOption<M>[]
  value: M
  onChange: (mode: M) => void
}

/**
 * The segmented Include / Exclude / Exact control that sits beside a filter's
 * heading. Every multi-value filter uses it, so the whole menu speaks one
 * vocabulary; Sets passes a two-option list since `exact` can't apply there.
 */
function FilterModeToggle<M extends string>(props: FilterModeToggleProps<M>): JSX.Element {
  return (
    <div class="filter-toggle-group" role="group" aria-label={props.ariaLabel}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            classList={{ active: props.value === option.value }}
            aria-pressed={props.value === option.value}
            title={option.title}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

/** The button text and tooltip for one mode, before it is paired with its value. */
type FilterModeCopy = { label: string; title: string }

/**
 * Expand per-mode copy into options, in the canonical mode order. Keying the copy
 * by mode means adding a mode to `FilterMatchMode` fails to compile here until it
 * is given a label, rather than silently rendering one button fewer.
 */
function modeOptions<M extends string>(
  modes: readonly M[],
  copy: Record<M, FilterModeCopy>,
): readonly FilterModeOption<M>[] {
  return modes.map((value) => ({ value, ...copy[value] }))
}

/**
 * Build the match-mode options for a tag-style filter (types, oracle tags, art
 * tags), whose tooltips only differ by the noun they name.
 */
function matchModeOptions(noun: string): readonly FilterModeOption<FilterMatchMode>[] {
  return modeOptions(FILTER_MATCH_MODES, {
    include: { label: 'Include', title: `Match cards with any of the selected ${noun}` },
    exclude: { label: 'Exclude', title: `Hide cards with any of the selected ${noun}` },
    exact: { label: 'Exact', title: `Match cards with all of the selected ${noun}` },
  })
}

const COLOR_MODE_OPTIONS = modeOptions(COLOR_MATCH_MODES, {
  subset: { label: 'Subset', title: 'Card could be played in a deck of the selected colors' },
  include: { label: 'Include', title: 'Card uses at least one of the selected colors' },
  exclude: { label: 'Exclude', title: 'Card uses none of the selected colors' },
  exact: { label: 'Exact', title: 'Color identity is exactly the selected colors' },
})

const SET_MODE_OPTIONS = modeOptions(SET_CODE_FILTER_MODES, {
  include: { label: 'Include', title: 'Show only cards from the selected sets' },
  exclude: { label: 'Exclude', title: 'Hide cards from the selected sets' },
})

const CARD_TYPE_MODE_OPTIONS = matchModeOptions('types')
const ORACLE_TAG_MODE_OPTIONS = matchModeOptions('oracle tags')
const ART_TAG_MODE_OPTIONS = matchModeOptions('art tags')

export interface FilterMenuProps {
  filters: CardFiltersControl
  symbolMap: Record<string, string>
  /** Active currency, used to label and interpret the price filter. */
  currency: PriceCurrency
  /** Lowercase set codes present in the current list, for the set filter autocomplete. */
  setCodeOptions: string[]
  /** Lowercase card type tags present in the current list, for the type filter autocomplete. */
  cardTypeOptions: string[]
  /** Oracle tag slugs present in the current list, for the oracle tag filter autocomplete. */
  oracleTagOptions: string[]
  /** Art tag slugs present in the current list, for the art tag filter autocomplete. */
  artTagOptions: string[]
  /** Show the "Hide Extras" toggle (deck pages only). */
  showHideExtras?: boolean
  /** Show the Labels chip row (collection-bearing views only). */
  showLabelsFilter?: boolean
}

/** One labels-filter chip: its filter value, button text, and tooltip. */
type LabelFilterOptionCopy = { value: LabelFilterOption; label: string; title: string }

/**
 * The labels filter's chips, in canonical order. `keep` and `none` replace the
 * whole selection when picked — `toggleLabelFilterOption` enforces it — so the
 * titles say so rather than letting the chips silently deselect each other.
 */
const LABEL_FILTER_OPTION_COPY: readonly LabelFilterOptionCopy[] = [
  { value: 'sale', label: CARD_LABEL_DISPLAY_NAMES.sale, title: 'Cards labeled for sale' },
  { value: 'trade', label: CARD_LABEL_DISPLAY_NAMES.trade, title: 'Cards labeled for trade' },
  {
    value: 'keep',
    label: CARD_LABEL_DISPLAY_NAMES.keep,
    title: 'Cards labeled to keep (never combined with the other labels)',
  },
  { value: 'none', label: 'Unlabeled', title: 'Cards with no labels at all' },
]

type TagFilterRowProps = {
  /** Heading for the row (e.g. "Oracle Tags"). */
  label: string
  /** id linking the label to the input; also the e2e hook (e.g. "filter-oracle-tags"). */
  inputId: string
  placeholder: string
  suggestionsLabel: string
  options: string[]
  selected: string[]
  modeOptions: readonly FilterModeOption<FilterMatchMode>[]
  mode: FilterMatchMode
  onTags: (tags: string[]) => void
  onMode: (mode: FilterMatchMode) => void
}

/**
 * A tag filter row (Oracle or Art): a match-mode toggle beside the heading and a
 * chip autocomplete. Tag slugs are already lowercase, so the card-type scanner is
 * reused and matching is a plain substring test.
 */
const TagFilterRow: Component<TagFilterRowProps> = (props) => {
  return (
    <div class="filter-row">
      <div class="filter-type-header">
        <label class="filter-label" for={props.inputId}>
          {props.label}
        </label>
        <FilterModeToggle
          ariaLabel={`${props.label} match mode`}
          options={props.modeOptions}
          value={props.mode}
          onChange={props.onMode}
        />
      </div>
      <TagsInput
        selected={props.selected}
        options={props.options}
        onChange={props.onTags}
        inputId={props.inputId}
        placeholder={props.placeholder}
        suggestionsLabel={props.suggestionsLabel}
        format={(tag) => tag}
        query={(draft) => draft.trim().toLowerCase()}
        matches={(tag, query) => query.length === 0 || tag.includes(query)}
        scan={scanCardTypeInput}
        parse={parseCardTypesInput}
      />
    </div>
  )
}

type NumericFilterRowProps = {
  /** Heading for the row (e.g. "Mana Value"). */
  label: string
  /** id linking the label to the input; also the e2e hook (e.g. "filter-mana-value"). */
  inputId: string
  ariaLabel: string
  op: NumericComparator
  onOp: (op: NumericComparator) => void
  /** The raw draft text shown in the field (debounced from the store). */
  value: string
  onValueInput: (raw: string) => void
  /** Commit any pending value immediately when the field loses focus. */
  onValueBlur: () => void
  error: string | null
  step: string
  inputMode: 'numeric' | 'decimal'
}

/**
 * A numeric filter row (Mana Value, Price, or Copies): the label, a comparator
 * toggle group, and a number input all on one line — these three rows are the
 * menu's most compact, so keeping the field beside its comparators rather than
 * below them saves a line each. Validation errors wrap underneath. Price carries
 * its currency in the label rather than beside the field, so all three fields are
 * the same width and their comparator groups line up.
 */
const NumericFilterRow: Component<NumericFilterRowProps> = (props) => {
  return (
    <div class="filter-row">
      <div class="filter-type-header">
        <label class="filter-label" for={props.inputId}>
          {props.label}
        </label>
        <div class="filter-toggle-group" role="group" aria-label={props.ariaLabel}>
          <For each={COMPARATOR_OPTIONS}>
            {(opt) => (
              <button
                type="button"
                classList={{ active: props.op === opt.value }}
                aria-pressed={props.op === opt.value}
                onClick={() => props.onOp(opt.value)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
        <input
          id={props.inputId}
          class="filter-input filter-input-numeric"
          type="number"
          min="0"
          step={props.step}
          inputmode={props.inputMode}
          placeholder="Any"
          aria-invalid={props.error !== null}
          value={props.value}
          onInput={(e) => props.onValueInput(e.currentTarget.value)}
          onBlur={props.onValueBlur}
        />
      </div>
      <Show when={props.error}>{(error) => <span class="filter-error">{error()}</span>}</Show>
    </div>
  )
}

/**
 * Toolbar "Filters" button + anchored dropdown panel holding every card filter:
 * hide lands/unpriced toggles, name terms, color identity, set codes, mana value.
 */
export const FilterMenu: Component<FilterMenuProps> = (props) => {
  const toggle = useAnchoredToggle()

  return (
    <div class="filter-menu">
      <button
        type="button"
        ref={toggle.setButtonRef}
        class="toolbar-toggle"
        classList={{ active: props.filters.activeCount() > 0 }}
        aria-expanded={toggle.open()}
        aria-haspopup="true"
        onClick={toggle.toggleOpen}
      >
        Filters
        <Show when={props.filters.activeCount() > 0}>
          <span class="filter-menu-badge">{props.filters.activeCount()}</span>
        </Show>
        <span aria-hidden="true">{toggle.open() ? '▴' : '▾'}</span>
      </button>
      <AdaptiveMenu
        toggle={toggle}
        width={PANEL_WIDTH}
        panelClass="filter-menu-panel"
        title="Filters"
        role="group"
        aria-label="Card filters"
      >
        <FilterPanelBody
          filters={props.filters}
          symbolMap={props.symbolMap}
          currency={props.currency}
          setCodeOptions={props.setCodeOptions}
          cardTypeOptions={props.cardTypeOptions}
          oracleTagOptions={props.oracleTagOptions}
          artTagOptions={props.artTagOptions}
          showHideExtras={props.showHideExtras}
          showLabelsFilter={props.showLabelsFilter}
        />
      </AdaptiveMenu>
    </div>
  )
}

const FilterPanelBody: Component<FilterMenuProps> = (props) => {
  const [manaValueError, setManaValueError] = createSignal<string | null>(null)
  const [priceError, setPriceError] = createSignal<string | null>(null)
  const [copiesError, setCopiesError] = createSignal<string | null>(null)

  // The price filter can be cleared externally (switching currency resets it in the
  // store), which leaves no error to show — drop any stale validation message so it
  // isn't stranded next to an emptied field.
  createEffect(
    on(
      () => props.filters.filters.price,
      (price) => {
        if (price === null) setPriceError(null)
      },
      { defer: true },
    ),
  )

  // The free-text and numeric filters commit to the store 250ms after the user stops
  // typing, so fast typing no longer triggers a filter+re-render pass per keystroke.
  // The fields still echo keystrokes instantly via each input's `draft`.
  const nameInput = useDebouncedInput(
    () => props.filters.filters.name,
    (name) => props.filters.update({ name }),
  )

  const manaValueInput = useNumericFilterInput(
    () => props.filters.filters.manaValue,
    parseManaValueFilter,
    setManaValueError,
    (manaValue) => props.filters.update({ manaValue }),
  )

  const priceInput = useNumericFilterInput(
    () => props.filters.filters.price,
    parsePriceFilter,
    setPriceError,
    (price) => props.filters.update({ price }),
  )

  const copiesInput = useNumericFilterInput(
    () => props.filters.filters.copies,
    parseCopiesFilter,
    setCopiesError,
    (copies) => props.filters.update({ copies }),
  )

  // The currency lives in the label — "Price ($)" — rather than beside the field,
  // so the three numeric fields stay a uniform width. Currencies with no symbol
  // fall back to a bare "Price".
  const priceLabel = (): string => {
    const symbol = getCurrencySymbol(props.currency)
    return symbol ? `Price (${symbol})` : 'Price'
  }

  const handleClearAll = () => {
    // One reactive flush for the whole reset. Order matters: reset the store first so
    // each input's `reset()` re-seeds its draft from the new defaults, and abandons any
    // debounced value not yet committed so it can't re-apply after the reset.
    batch(() => {
      props.filters.reset()
      nameInput.reset()
      manaValueInput.reset()
      priceInput.reset()
      copiesInput.reset()
      setManaValueError(null)
      setPriceError(null)
      setCopiesError(null)
    })
  }

  return (
    <>
      <div class="filter-row filter-row-toggles">
        <button
          type="button"
          class="toolbar-toggle"
          classList={{ active: props.filters.filters.hideLands }}
          aria-pressed={props.filters.filters.hideLands}
          onClick={() => props.filters.update({ hideLands: !props.filters.filters.hideLands })}
        >
          Hide Lands
        </button>
        <button
          type="button"
          class="toolbar-toggle"
          classList={{ active: props.filters.filters.hideUnpriced }}
          aria-pressed={props.filters.filters.hideUnpriced}
          onClick={() =>
            props.filters.update({ hideUnpriced: !props.filters.filters.hideUnpriced })
          }
        >
          Hide Unpriced
        </button>
        <Show when={props.showHideExtras}>
          <button
            type="button"
            class="toolbar-toggle"
            classList={{ active: props.filters.filters.hideExtras }}
            aria-pressed={props.filters.filters.hideExtras}
            onClick={() => props.filters.update({ hideExtras: !props.filters.filters.hideExtras })}
          >
            Hide Extras
          </button>
        </Show>
        {/* Rendered even with nothing active (disabled) rather than shown conditionally,
            so applying the first filter doesn't reflow the row it sits in. */}
        <button
          type="button"
          class="btn btn-primary filter-clear"
          disabled={props.filters.activeCount() === 0}
          onClick={handleClearAll}
        >
          Clear
        </button>
      </div>
      <div class="filter-row">
        <label class="filter-label" for="filter-name">
          Name
        </label>
        <input
          id="filter-name"
          class="filter-input"
          type="text"
          placeholder="Search terms…"
          value={nameInput.draft()}
          onInput={(e) => nameInput.onInput(e.currentTarget.value)}
          onBlur={nameInput.flush}
        />
      </div>
      <div class="filter-row">
        <div class="filter-type-header">
          <span class="filter-label">Color Identity</span>
          <FilterModeToggle
            ariaLabel="Color match mode"
            options={COLOR_MODE_OPTIONS}
            value={props.filters.filters.colorMode}
            onChange={(colorMode) => props.filters.update({ colorMode })}
          />
        </div>
        <div class="filter-colors">
          <For each={WUBRG}>
            {(color) => (
              <button
                type="button"
                class="filter-color-btn"
                classList={{ active: props.filters.filters.colors.includes(color) }}
                aria-pressed={props.filters.filters.colors.includes(color)}
                title={colorIdentityName([color])}
                onClick={() =>
                  props.filters.update({
                    colors: toggleColorSelection(props.filters.filters.colors, color),
                  })
                }
              >
                <Show
                  when={props.symbolMap[`{${color}}`]}
                  fallback={<span class="filter-color-letter">{color}</span>}
                >
                  {(src) => (
                    <img src={src()} alt={colorIdentityName([color])} class="mana-symbol" />
                  )}
                </Show>
              </button>
            )}
          </For>
          {/* Colorless sits after the five colors, as it does in Scryfall's own filters. */}
          <button
            type="button"
            class="filter-color-btn"
            classList={{ active: props.filters.filters.colorless }}
            aria-pressed={props.filters.filters.colorless}
            title={COLORLESS_NAME}
            onClick={() => props.filters.update({ colorless: !props.filters.filters.colorless })}
          >
            <Show
              when={props.symbolMap['{C}']}
              fallback={<span class="filter-color-letter">C</span>}
            >
              {(src) => <img src={src()} alt={COLORLESS_NAME} class="mana-symbol" />}
            </Show>
          </button>
        </div>
      </div>
      <Show when={props.showLabelsFilter}>
        <div class="filter-row">
          <span class="filter-label">Labels</span>
          <div class="filter-toggle-group filter-labels" role="group" aria-label="Label filter">
            <For each={LABEL_FILTER_OPTION_COPY}>
              {(opt) => (
                <button
                  type="button"
                  classList={{ active: props.filters.filters.labels.includes(opt.value) }}
                  aria-pressed={props.filters.filters.labels.includes(opt.value)}
                  title={opt.title}
                  onClick={() =>
                    props.filters.update({
                      labels: toggleLabelFilterOption(props.filters.filters.labels, opt.value),
                    })
                  }
                >
                  {opt.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
      <div class="filter-row">
        <div class="filter-type-header">
          <label class="filter-label" for="filter-sets">
            Sets
          </label>
          <FilterModeToggle
            ariaLabel="Set match mode"
            options={SET_MODE_OPTIONS}
            value={props.filters.filters.setCodeMode}
            onChange={(setCodeMode) => props.filters.update({ setCodeMode })}
          />
        </div>
        <TagsInput
          selected={props.filters.filters.setCodes}
          options={props.setCodeOptions}
          onChange={(setCodes) => props.filters.update({ setCodes })}
          inputId="filter-sets"
          placeholder="Set codes…"
          suggestionsLabel="Set code suggestions"
          format={(code) => code.toUpperCase()}
          query={(draft) => draft.trim().toLowerCase()}
          matches={(code, query) => code.startsWith(query)}
          scan={scanSetCodesInput}
          parse={parseSetCodesInput}
        />
      </div>
      <div class="filter-row">
        <div class="filter-type-header">
          <label class="filter-label" for="filter-types">
            Card Type
          </label>
          <FilterModeToggle
            ariaLabel="Card type match mode"
            options={CARD_TYPE_MODE_OPTIONS}
            value={props.filters.filters.cardTypeMode}
            onChange={(cardTypeMode) => props.filters.update({ cardTypeMode })}
          />
        </div>
        <TagsInput
          selected={props.filters.filters.cardTypes}
          options={props.cardTypeOptions}
          onChange={(cardTypes) => props.filters.update({ cardTypes })}
          inputId="filter-types"
          placeholder="Card types…"
          suggestionsLabel="Card type suggestions"
          format={formatCardTypeForDisplay}
          // Strip a leading open quote so suggestions still appear while typing `"Time…`.
          query={(draft) => draft.trim().toLowerCase().replace(/^"/, '')}
          // Match a prefix of the whole tag or of any word within it, so multi-word
          // types like "Time Lord" surface when typing "time" or "lord".
          matches={(type, query) =>
            query.length === 0 ||
            type.startsWith(query) ||
            type.split(' ').some((word) => word.startsWith(query))
          }
          scan={scanCardTypeInput}
          parse={parseCardTypesInput}
        />
      </div>
      <TagFilterRow
        label="Oracle Tags"
        inputId="filter-oracle-tags"
        placeholder="Oracle tags…"
        suggestionsLabel="Oracle tag suggestions"
        options={props.oracleTagOptions}
        selected={props.filters.filters.oracleTags}
        modeOptions={ORACLE_TAG_MODE_OPTIONS}
        mode={props.filters.filters.oracleTagMode}
        onTags={(oracleTags) => props.filters.update({ oracleTags })}
        onMode={(oracleTagMode) => props.filters.update({ oracleTagMode })}
      />
      <TagFilterRow
        label="Art Tags"
        inputId="filter-art-tags"
        placeholder="Art tags…"
        suggestionsLabel="Art tag suggestions"
        options={props.artTagOptions}
        selected={props.filters.filters.artTags}
        modeOptions={ART_TAG_MODE_OPTIONS}
        mode={props.filters.filters.artTagMode}
        onTags={(artTags) => props.filters.update({ artTags })}
        onMode={(artTagMode) => props.filters.update({ artTagMode })}
      />
      <NumericFilterRow
        label="Mana Value"
        inputId="filter-mana-value"
        ariaLabel="Mana value comparison"
        op={props.filters.filters.manaValueOp}
        onOp={(manaValueOp) => props.filters.update({ manaValueOp })}
        value={manaValueInput.draft()}
        onValueInput={manaValueInput.onInput}
        onValueBlur={manaValueInput.flush}
        error={manaValueError()}
        step="1"
        inputMode="numeric"
      />
      <NumericFilterRow
        label={priceLabel()}
        inputId="filter-price"
        ariaLabel="Price comparison"
        op={props.filters.filters.priceOp}
        onOp={(priceOp) => props.filters.update({ priceOp })}
        value={priceInput.draft()}
        onValueInput={priceInput.onInput}
        onValueBlur={priceInput.flush}
        error={priceError()}
        step="0.01"
        inputMode="decimal"
      />
      <NumericFilterRow
        label="Copies"
        inputId="filter-copies"
        ariaLabel="Copies comparison"
        op={props.filters.filters.copiesOp}
        onOp={(copiesOp) => props.filters.update({ copiesOp })}
        value={copiesInput.draft()}
        onValueInput={copiesInput.onInput}
        onValueBlur={copiesInput.flush}
        error={copiesError()}
        step="1"
        inputMode="numeric"
      />
    </>
  )
}
