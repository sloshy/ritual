import type { Component } from 'solid-js'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { useT } from '../ui/i18n'

export type TagsInputScan = {
  /** Completed tags to commit (canonical internal form). */
  tags: string[]
  /** The trailing token still being typed, kept verbatim as the new draft. */
  remainder: string
}

export type TagsInputProps = {
  /** Currently selected values, in canonical internal form (e.g. lowercase). */
  selected: string[]
  /** All values available for autocomplete, in the same canonical form. */
  options: string[]
  onChange: (values: string[]) => void
  /** id applied to the text input, so a `<label for>` can target it. */
  inputId: string
  /** Placeholder shown while nothing is selected. */
  placeholder: string
  /** aria-label for the suggestions listbox. */
  suggestionsLabel: string
  /** Render a stored value for display in chips and suggestions. */
  format: (value: string) => string
  /** Derive the autocomplete query from the current draft text. */
  query: (draft: string) => string
  /** Whether an option matches the (already-normalized) query. */
  matches: (option: string, query: string) => boolean
  /** Split a raw input value into completed tags plus a trailing draft remainder. */
  scan: (value: string) => TagsInputScan
  /** Fully parse the draft into tags when committing without a highlighted suggestion. */
  parse: (value: string) => string[]
}

/**
 * A tag input with autocomplete shared by the set-code and card-type filters. Tags
 * commit as you type (per the injected `scan`), the suggestion list is navigable with
 * the arrow keys, and Enter either accepts the highlighted suggestion or — when none is
 * highlighted — commits the typed text via the injected `parse`.
 */
export const TagsInput: Component<TagsInputProps> = (props) => {
  const t = useT()
  const [draft, setDraft] = createSignal('')
  const [focused, setFocused] = createSignal(false)
  const [activeIndex, setActiveIndex] = createSignal(-1)
  // Keyed by option value rather than list index: <For> does not re-run ref
  // callbacks for surviving rows when the list shrinks, so index-based refs go stale.
  const itemRefs = new Map<string, HTMLButtonElement>()

  const suggestions = createMemo(() => {
    const query = props.query(draft())
    return props.options.filter(
      (option) => !props.selected.includes(option) && props.matches(option, query),
    )
  })

  // Reset the highlight whenever the suggestion set changes, so Enter defaults to
  // committing the typed text until the user arrows into the list.
  createEffect(() => {
    suggestions()
    setActiveIndex(-1)
  })

  // Keep the highlighted suggestion scrolled into view as it moves.
  createEffect(() => {
    const option = suggestions()[activeIndex()]
    if (option !== undefined) itemRefs.get(option)?.scrollIntoView({ block: 'nearest' })
  })

  const addValues = (values: string[]) => {
    if (values.length === 0) return
    const merged = [...props.selected]
    for (const value of values) {
      if (!merged.includes(value)) merged.push(value)
    }
    props.onChange(merged)
  }

  const handleInput = (value: string) => {
    const scan = props.scan(value)
    if (scan.tags.length > 0) addValues(scan.tags)
    setDraft(scan.remainder)
  }

  const moveActive = (delta: number) => {
    const count = suggestions().length
    if (count === 0) return
    const next = activeIndex() + delta
    setActiveIndex(next < 0 ? count - 1 : next >= count ? 0 : next)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveActive(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveActive(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const highlighted = suggestions()[activeIndex()]
      if (highlighted !== undefined) {
        addValues([highlighted])
      } else {
        addValues(props.parse(draft()))
      }
      setDraft('')
    } else if (e.key === 'Escape') {
      setActiveIndex(-1)
    } else if (e.key === 'Backspace' && draft().length === 0 && props.selected.length > 0) {
      props.onChange(props.selected.slice(0, -1))
    }
  }

  return (
    <div class="filter-tags">
      <For each={props.selected}>
        {(value) => (
          <span class="filter-tag">
            {props.format(value)}
            <button
              type="button"
              class="filter-tag-remove"
              aria-label={t('site.filter.removeTag', { value: props.format(value) })}
              onClick={() => props.onChange(props.selected.filter((v) => v !== value))}
            >
              ×
            </button>
          </span>
        )}
      </For>
      <input
        id={props.inputId}
        class="filter-tags-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={focused() && suggestions().length > 0}
        placeholder={props.selected.length === 0 ? props.placeholder : ''}
        value={draft()}
        onInput={(e) => handleInput(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <Show when={focused() && suggestions().length > 0}>
        <div class="filter-tags-suggestions" role="listbox" aria-label={props.suggestionsLabel}>
          <For each={suggestions()}>
            {(option, index) => (
              <button
                type="button"
                role="option"
                ref={(el) => itemRefs.set(option, el)}
                aria-selected={activeIndex() === index()}
                classList={{ active: activeIndex() === index() }}
                onMouseEnter={() => setActiveIndex(index())}
                // preventDefault keeps the text input focused so the list stays open
                // for picking several values in a row.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  addValues([option])
                  setDraft('')
                }}
              >
                {props.format(option)}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
