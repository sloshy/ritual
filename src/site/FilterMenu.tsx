import type { Accessor, Component } from 'solid-js'
import { createSignal, For, Show } from 'solid-js'
import { useAnchoredMenu } from '../ui/useAnchoredMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
import { parseSetCodesInput, scanSetCodesInput } from '../set-codes'
import { colorIdentityName, WUBRG } from './card-sorting'
import {
  parseManaValueFilter,
  toggleColorSelection,
  type ManaValueComparator,
} from './card-filters'
import { formatCardTypeForDisplay, parseCardTypesInput, scanCardTypeInput } from './card-types'
import type { TagFilterMode, TagMatchLogic } from './card-tags'
import { TagsInput } from './TagsInput'
import type { CardFiltersControl } from './useCardFilters'

const PANEL_WIDTH = 320

type ComparatorOption = { value: ManaValueComparator; label: string }

const MANA_VALUE_COMPARATORS: ComparatorOption[] = [
  { value: '=', label: '=' },
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
]

export interface FilterMenuProps {
  filters: CardFiltersControl
  symbolMap: Record<string, string>
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
      <Show when={toggle.open() ? toggle.anchorRect() : null}>
        {(rect) => (
          <FilterPanel
            anchorRect={rect}
            onClose={toggle.close}
            anchorEl={toggle.buttonEl}
            filters={props.filters}
            symbolMap={props.symbolMap}
            setCodeOptions={props.setCodeOptions}
            cardTypeOptions={props.cardTypeOptions}
            oracleTagOptions={props.oracleTagOptions}
            artTagOptions={props.artTagOptions}
            showHideExtras={props.showHideExtras}
          />
        )}
      </Show>
    </div>
  )
}

type FilterPanelProps = FilterMenuProps & {
  anchorRect: Accessor<DOMRect>
  onClose: () => void
  /** The Filters button, excluded from outside-click dismissal so it can toggle the panel. */
  anchorEl: () => HTMLElement | undefined
}

const FilterPanel: Component<FilterPanelProps> = (props) => {
  const menu = useAnchoredMenu({
    anchorRect: props.anchorRect,
    width: PANEL_WIDTH,
    onClose: props.onClose,
    excludeEl: props.anchorEl,
  })
  const [manaValueError, setManaValueError] = createSignal<string | null>(null)

  const handleManaValueInput = (raw: string) => {
    const parsed = parseManaValueFilter(raw)
    setManaValueError(parsed.ok ? null : parsed.error)
    if (parsed.ok) props.filters.update({ manaValue: parsed.value })
  }

  const handleClearAll = () => {
    props.filters.reset()
    setManaValueError(null)
  }

  return (
    <div
      ref={menu.setMenuRef}
      class="filter-menu-panel"
      style={menu.style()}
      role="group"
      aria-label="Card filters"
    >
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
        <label class="filter-label" for="filter-sets">
          Sets
        </label>
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
      <div class="filter-row">
        <label class="filter-label" for="filter-mana-value">
          Mana Value
        </label>
        <div class="filter-mana-value">
          <select
            class="toolbar-select"
            aria-label="Mana value comparison"
            value={props.filters.filters.manaValueOp}
            onChange={(e) =>
              props.filters.update({ manaValueOp: e.currentTarget.value as ManaValueComparator })
            }
          >
            <For each={MANA_VALUE_COMPARATORS}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
          <input
            id="filter-mana-value"
            class="filter-input filter-input-mana-value"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            placeholder="Any"
            aria-invalid={manaValueError() !== null}
            value={props.filters.filters.manaValue ?? ''}
            onInput={(e) => handleManaValueInput(e.currentTarget.value)}
          />
        </div>
        <Show when={manaValueError()}>
          {(error) => <span class="filter-error">{error()}</span>}
        </Show>
      </div>
      <Show when={props.filters.activeCount() > 0}>
        <button type="button" class="link-action filter-clear" onClick={handleClearAll}>
          Clear all filters
        </button>
      </Show>
    </div>
  )
}
