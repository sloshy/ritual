import type { Accessor, Component } from 'solid-js'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { useAnchoredMenu } from '../ui/useAnchoredMenu'
import { parseSetCodesInput } from '../set-codes'
import { colorIdentityName, WUBRG } from './card-sorting'
import {
  parseManaValueFilter,
  toggleColorSelection,
  type ManaValueComparator,
} from './card-filters'
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
  /** Show the "Hide Extras" toggle (deck pages only). */
  showHideExtras?: boolean
}

/**
 * Toolbar "Filters" button + anchored dropdown panel holding every card filter:
 * hide lands/unpriced toggles, name terms, color identity, set codes, mana value.
 */
export const FilterMenu: Component<FilterMenuProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [anchorRect, setAnchorRect] = createSignal<DOMRect | null>(null)
  let buttonRef: HTMLButtonElement | undefined

  const toggleOpen = () => {
    if (open()) {
      setOpen(false)
      return
    }
    if (buttonRef) setAnchorRect(buttonRef.getBoundingClientRect())
    setOpen(true)
  }

  // Keep the panel attached to the button while the page scrolls or resizes
  // (the sticky toolbar moves until it sticks).
  createEffect(() => {
    if (!open()) return
    const updateAnchor = () => {
      if (buttonRef) setAnchorRect(buttonRef.getBoundingClientRect())
    }
    window.addEventListener('scroll', updateAnchor, true)
    window.addEventListener('resize', updateAnchor)
    onCleanup(() => {
      window.removeEventListener('scroll', updateAnchor, true)
      window.removeEventListener('resize', updateAnchor)
    })
  })

  return (
    <div class="filter-menu">
      <button
        type="button"
        ref={buttonRef}
        class="toolbar-toggle"
        classList={{ active: props.filters.activeCount() > 0 }}
        aria-expanded={open()}
        aria-haspopup="true"
        onClick={toggleOpen}
      >
        Filters
        <Show when={props.filters.activeCount() > 0}>
          <span class="filter-menu-badge">{props.filters.activeCount()}</span>
        </Show>
        <span aria-hidden="true">{open() ? '▴' : '▾'}</span>
      </button>
      <Show when={open() ? anchorRect() : null}>
        {(rect) => (
          <FilterPanel
            anchorRect={rect}
            onClose={() => setOpen(false)}
            anchorEl={() => buttonRef}
            filters={props.filters}
            symbolMap={props.symbolMap}
            setCodeOptions={props.setCodeOptions}
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
        <SetCodeTagsInput
          selected={props.filters.filters.setCodes}
          options={props.setCodeOptions}
          onChange={(setCodes) => props.filters.update({ setCodes })}
        />
      </div>
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

type SetCodeTagsInputProps = {
  /** Currently selected set codes (lowercase). */
  selected: string[]
  /** All set codes available for autocomplete (lowercase). */
  options: string[]
  onChange: (codes: string[]) => void
}

const SetCodeTagsInput: Component<SetCodeTagsInputProps> = (props) => {
  const [draft, setDraft] = createSignal('')
  const [focused, setFocused] = createSignal(false)

  const suggestions = createMemo(() => {
    const query = draft().trim().toLowerCase()
    return props.options.filter((code) => !props.selected.includes(code) && code.startsWith(query))
  })

  const addCodes = (raw: string) => {
    const codes = parseSetCodesInput(raw.replace(/\s+/g, ','))
    if (codes.length === 0) return
    const merged = [...props.selected]
    for (const code of codes) {
      if (!merged.includes(code)) merged.push(code)
    }
    props.onChange(merged)
  }

  // Space and comma both finish the tag being typed; pasted text may contain
  // several separators, in which case every complete token becomes a tag and
  // any trailing partial token stays in the input as the new draft.
  const handleInput = (value: string) => {
    if (!/[\s,]/.test(value)) {
      setDraft(value)
      return
    }
    const endsWithSeparator = /[\s,]$/.test(value)
    const tokens = value.split(/[\s,]+/).filter(Boolean)
    const remainder = endsWithSeparator ? '' : (tokens.pop() ?? '')
    if (tokens.length > 0) addCodes(tokens.join(','))
    setDraft(remainder)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCodes(draft())
      setDraft('')
    } else if (e.key === 'Backspace' && draft().length === 0 && props.selected.length > 0) {
      props.onChange(props.selected.slice(0, -1))
    }
  }

  return (
    <div class="filter-tags">
      <For each={props.selected}>
        {(code) => (
          <span class="filter-tag">
            {code.toUpperCase()}
            <button
              type="button"
              class="filter-tag-remove"
              aria-label={`Remove ${code.toUpperCase()}`}
              onClick={() => props.onChange(props.selected.filter((c) => c !== code))}
            >
              ×
            </button>
          </span>
        )}
      </For>
      <input
        id="filter-sets"
        class="filter-tags-input"
        type="text"
        placeholder={props.selected.length === 0 ? 'Set codes…' : ''}
        value={draft()}
        onInput={(e) => handleInput(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <Show when={focused() && suggestions().length > 0}>
        <div class="filter-tags-suggestions" role="listbox" aria-label="Set code suggestions">
          <For each={suggestions()}>
            {(code) => (
              <button
                type="button"
                role="option"
                // preventDefault keeps the text input focused so the list stays open
                // for picking several sets in a row.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  addCodes(code)
                  setDraft('')
                }}
              >
                {code.toUpperCase()}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
