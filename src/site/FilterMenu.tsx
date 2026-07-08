import type { Component, JSX } from 'solid-js'
import { createEffect, createSignal, For, on, Show } from 'solid-js'
import { AdaptiveMenu } from '../ui/AdaptiveMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
import { parseSetCodesInput, scanSetCodesInput } from '../set-codes'
import { colorIdentityName, WUBRG } from './card-sorting'
import {
  parseCopiesFilter,
  parseManaValueFilter,
  parsePriceFilter,
  toggleColorSelection,
  type NumericComparator,
} from './card-filters'
import { type PriceCurrency, getCurrencySymbol } from '../price-currency'
import { formatCardTypeForDisplay, parseCardTypesInput, scanCardTypeInput } from './card-types'
import type { TagFilterMode, TagMatchLogic } from './card-tags'
import { TagsInput } from './TagsInput'
import type { CardFiltersControl } from './useCardFilters'

const PANEL_WIDTH = 320

type ComparatorOption = { value: NumericComparator; label: string }

/** Shared comparator choices for the numeric (mana value, price, copies) filters. */
const COMPARATOR_OPTIONS: ComparatorOption[] = [
  { value: '=', label: '=' },
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
]

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
}

type TagFilterRowProps = {
  /** Heading for the row (e.g. "Oracle Tags"). */
  label: string
  /** id linking the label to the input; also the e2e hook (e.g. "filter-oracle-tags"). */
  inputId: string
  placeholder: string
  suggestionsLabel: string
  options: string[]
  selected: string[]
  logic: TagMatchLogic
  mode: TagFilterMode
  onTags: (tags: string[]) => void
  onLogic: (logic: TagMatchLogic) => void
  onMode: (mode: TagFilterMode) => void
}

/**
 * A tag filter row (Oracle or Art): an any/all logic toggle, an include/exclude
 * mode toggle, and a chip autocomplete. Tag slugs are already lowercase, so the
 * card-type scanner is reused and matching is a plain substring test.
 */
const TagFilterRow: Component<TagFilterRowProps> = (props) => {
  return (
    <div class="filter-row">
      <div class="filter-type-header">
        <label class="filter-label" for={props.inputId}>
          {props.label}
        </label>
        <div class="filter-toggle-group" role="group" aria-label={`${props.label} match logic`}>
          <button
            type="button"
            classList={{ active: props.logic === 'or' }}
            aria-pressed={props.logic === 'or'}
            title="Match cards with any of the selected tags"
            onClick={() => props.onLogic('or')}
          >
            Any
          </button>
          <button
            type="button"
            classList={{ active: props.logic === 'and' }}
            aria-pressed={props.logic === 'and'}
            title="Match cards with all of the selected tags"
            onClick={() => props.onLogic('and')}
          >
            All
          </button>
        </div>
        <div class="filter-toggle-group" role="group" aria-label={`${props.label} filter mode`}>
          <button
            type="button"
            classList={{ active: props.mode === 'include' }}
            aria-pressed={props.mode === 'include'}
            title="Show only cards with the selected tags"
            onClick={() => props.onMode('include')}
          >
            Include
          </button>
          <button
            type="button"
            classList={{ active: props.mode === 'exclude' }}
            aria-pressed={props.mode === 'exclude'}
            title="Hide cards with the selected tags"
            onClick={() => props.onMode('exclude')}
          >
            Exclude
          </button>
        </div>
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
  value: number | null
  onValueInput: (raw: string) => void
  error: string | null
  step: string
  inputMode: 'numeric' | 'decimal'
  /** Class of the flex wrapper around the input (e.g. "filter-mana-value"). */
  wrapperClass: string
  /** Width class for the input itself (e.g. "filter-input-mana-value"). */
  inputClass: string
  /** Optional content rendered before the input (the currency symbol, for Price). */
  prefix?: JSX.Element
}

/**
 * A numeric filter row (Mana Value, Price, or Copies): a comparator toggle
 * group and a number input, with an optional prefix (the currency symbol, for
 * Price) and a validation error shown below.
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
      </div>
      <div class={props.wrapperClass}>
        {props.prefix}
        <input
          id={props.inputId}
          class={`filter-input ${props.inputClass}`}
          type="number"
          min="0"
          step={props.step}
          inputmode={props.inputMode}
          placeholder="Any"
          aria-invalid={props.error !== null}
          value={props.value ?? ''}
          onInput={(e) => props.onValueInput(e.currentTarget.value)}
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

  const handleManaValueInput = (raw: string) => {
    const parsed = parseManaValueFilter(raw)
    setManaValueError(parsed.ok ? null : parsed.error)
    if (parsed.ok) props.filters.update({ manaValue: parsed.value })
  }

  const handlePriceInput = (raw: string) => {
    const parsed = parsePriceFilter(raw)
    setPriceError(parsed.ok ? null : parsed.error)
    if (parsed.ok) props.filters.update({ price: parsed.value })
  }

  const handleCopiesInput = (raw: string) => {
    const parsed = parseCopiesFilter(raw)
    setCopiesError(parsed.ok ? null : parsed.error)
    if (parsed.ok) props.filters.update({ copies: parsed.value })
  }

  const handleClearAll = () => {
    props.filters.reset()
    setManaValueError(null)
    setPriceError(null)
    setCopiesError(null)
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
          value={props.filters.filters.name}
          onInput={(e) => props.filters.update({ name: e.currentTarget.value })}
        />
      </div>
      <div class="filter-row">
        <span class="filter-label">Color Identity</span>
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
          <div class="filter-color-mode" role="group" aria-label="Color match mode">
            <button
              type="button"
              classList={{ active: props.filters.filters.colorMode === 'exclusive' }}
              aria-pressed={props.filters.filters.colorMode === 'exclusive'}
              title="Color identity is exactly the selected colors"
              onClick={() => props.filters.update({ colorMode: 'exclusive' })}
            >
              Exclusive
            </button>
            <button
              type="button"
              classList={{ active: props.filters.filters.colorMode === 'inclusive' }}
              aria-pressed={props.filters.filters.colorMode === 'inclusive'}
              title="Card could be played in a deck of the selected colors"
              onClick={() => props.filters.update({ colorMode: 'inclusive' })}
            >
              Inclusive
            </button>
          </div>
        </div>
      </div>
      <div class="filter-row">
        <div class="filter-type-header">
          <label class="filter-label" for="filter-sets">
            Sets
          </label>
          <div class="filter-toggle-group" role="group" aria-label="Set filter mode">
            <button
              type="button"
              classList={{ active: props.filters.filters.setCodeMode === 'include' }}
              aria-pressed={props.filters.filters.setCodeMode === 'include'}
              title="Show only cards from the selected sets"
              onClick={() => props.filters.update({ setCodeMode: 'include' })}
            >
              Include
            </button>
            <button
              type="button"
              classList={{ active: props.filters.filters.setCodeMode === 'exclude' }}
              aria-pressed={props.filters.filters.setCodeMode === 'exclude'}
              title="Hide cards from the selected sets"
              onClick={() => props.filters.update({ setCodeMode: 'exclude' })}
            >
              Exclude
            </button>
          </div>
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
          <div class="filter-toggle-group" role="group" aria-label="Card type match logic">
            <button
              type="button"
              classList={{ active: props.filters.filters.cardTypeLogic === 'or' }}
              aria-pressed={props.filters.filters.cardTypeLogic === 'or'}
              title="Match cards with any of the selected types"
              onClick={() => props.filters.update({ cardTypeLogic: 'or' })}
            >
              Any
            </button>
            <button
              type="button"
              classList={{ active: props.filters.filters.cardTypeLogic === 'and' }}
              aria-pressed={props.filters.filters.cardTypeLogic === 'and'}
              title="Match cards with all of the selected types"
              onClick={() => props.filters.update({ cardTypeLogic: 'and' })}
            >
              All
            </button>
          </div>
          <div class="filter-toggle-group" role="group" aria-label="Card type filter mode">
            <button
              type="button"
              classList={{ active: props.filters.filters.cardTypeMode === 'include' }}
              aria-pressed={props.filters.filters.cardTypeMode === 'include'}
              title="Show only cards of the selected types"
              onClick={() => props.filters.update({ cardTypeMode: 'include' })}
            >
              Include
            </button>
            <button
              type="button"
              classList={{ active: props.filters.filters.cardTypeMode === 'exclude' }}
              aria-pressed={props.filters.filters.cardTypeMode === 'exclude'}
              title="Hide cards of the selected types"
              onClick={() => props.filters.update({ cardTypeMode: 'exclude' })}
            >
              Exclude
            </button>
          </div>
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
        logic={props.filters.filters.oracleTagLogic}
        mode={props.filters.filters.oracleTagMode}
        onTags={(oracleTags) => props.filters.update({ oracleTags })}
        onLogic={(oracleTagLogic) => props.filters.update({ oracleTagLogic })}
        onMode={(oracleTagMode) => props.filters.update({ oracleTagMode })}
      />
      <TagFilterRow
        label="Art Tags"
        inputId="filter-art-tags"
        placeholder="Art tags…"
        suggestionsLabel="Art tag suggestions"
        options={props.artTagOptions}
        selected={props.filters.filters.artTags}
        logic={props.filters.filters.artTagLogic}
        mode={props.filters.filters.artTagMode}
        onTags={(artTags) => props.filters.update({ artTags })}
        onLogic={(artTagLogic) => props.filters.update({ artTagLogic })}
        onMode={(artTagMode) => props.filters.update({ artTagMode })}
      />
      <NumericFilterRow
        label="Mana Value"
        inputId="filter-mana-value"
        ariaLabel="Mana value comparison"
        op={props.filters.filters.manaValueOp}
        onOp={(manaValueOp) => props.filters.update({ manaValueOp })}
        value={props.filters.filters.manaValue}
        onValueInput={handleManaValueInput}
        error={manaValueError()}
        step="1"
        inputMode="numeric"
        wrapperClass="filter-mana-value"
        inputClass="filter-input-mana-value"
      />
      <NumericFilterRow
        label="Price"
        inputId="filter-price"
        ariaLabel="Price comparison"
        op={props.filters.filters.priceOp}
        onOp={(priceOp) => props.filters.update({ priceOp })}
        value={props.filters.filters.price}
        onValueInput={handlePriceInput}
        error={priceError()}
        step="0.01"
        inputMode="decimal"
        wrapperClass="filter-price"
        inputClass="filter-input-price"
        prefix={
          <Show when={getCurrencySymbol(props.currency)}>
            {(symbol) => (
              <span class="filter-price-symbol" aria-hidden="true">
                {symbol()}
              </span>
            )}
          </Show>
        }
      />
      <NumericFilterRow
        label="Copies"
        inputId="filter-copies"
        ariaLabel="Copies comparison"
        op={props.filters.filters.copiesOp}
        onOp={(copiesOp) => props.filters.update({ copiesOp })}
        value={props.filters.filters.copies}
        onValueInput={handleCopiesInput}
        error={copiesError()}
        step="1"
        inputMode="numeric"
        wrapperClass="filter-copies"
        inputClass="filter-input-copies"
      />
      <Show when={props.filters.activeCount() > 0}>
        <button type="button" class="link-action filter-clear" onClick={handleClearAll}>
          Clear all filters
        </button>
      </Show>
    </>
  )
}
