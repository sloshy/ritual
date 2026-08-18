import type { Component } from 'solid-js'
import { Show, createEffect, createSignal, on } from 'solid-js'
import { useDebouncedInput } from './useDebouncedInput'
import type { CardFiltersControl } from './useCardFilters'
import { isKeyboardClaimed, isPlainTypingKey, useDocumentKeydown } from '../ui/useDocumentKeydown'
import { useT } from '../ui/i18n'

type QuickFilterProps = {
  /** The page's filter state — the same store the Filters menu writes to. */
  filters: CardFiltersControl
}

/**
 * Printable keys that a page-level shortcut has already claimed, so pressing one
 * would both fire the shortcut and start a filter with it. `?` opens the
 * editor's shortcut list ({@link import('../editor/useEditorShortcuts')}), which
 * the list pages mount in edit mode.
 */
const RESERVED_KEYS = new Set(['?'])

/**
 * Type-anywhere name filtering for the list pages: a printable key pressed
 * while nothing else has the keyboard reveals a small tab hanging off the
 * bottom-right of the toolbar and starts a name filter with that key.
 *
 * It is a second view of the Filters menu's **Name** field — one store value,
 * one debounce — not a filter of its own, so a query typed here shows up in the
 * panel, counts toward the active-filter badge, and rides along in the shared
 * URL. The tab exists only while that query does: blanking the field (or
 * clearing filters from the panel) puts it away again.
 *
 * The input is focused as soon as it appears, so everything after the first
 * keystroke is ordinary native editing — selection, repeat-backspace, paste.
 * That focus is only ever granted in response to a keypress, which means a
 * touch device with no keyboard attached can never be made to raise one.
 *
 * Contrast {@link import('../ui/useTypeToFilter')}, which serves the printing
 * pickers: there the grid keeps focus for its own arrow navigation, so the hook
 * has to re-implement text editing and hold every key for the life of the
 * query. Here nothing else on the page wants the keyboard, so handing the field
 * focus after one key is both simpler and better behaved.
 */
export const QuickFilter: Component<QuickFilterProps> = (props) => {
  const t = useT()
  const [open, setOpen] = createSignal(false)
  let inputEl: HTMLInputElement | undefined

  const name = (): string => props.filters.filters.name
  const input = useDebouncedInput(name, (value) => props.filters.update({ name: value }))

  // "Clear all" resets a store value this field may already have written its
  // own default into, so the field's external-sync effect can't see it. Drop
  // the pending commit here instead, or it would re-apply the cleared query.
  createEffect(on(() => props.filters.resetEpoch(), input.reset, { defer: true }))

  // Put the tab away when the query is gone from both ends — the committed
  // store value and the not-yet-committed draft. That covers "Clear all" and a
  // shared-URL restore as well as backspacing the field empty, while a query
  // still within its debounce window (draft set, store not yet) keeps it up.
  // `open` is deliberately untracked: were it a dependency, revealing the tab
  // before its first character was drafted would immediately close it again.
  createEffect(
    on([name, input.draft], ([committed, draft]) => {
      if (committed === '' && draft === '') setOpen(false)
    }),
  )

  const clear = (): void => {
    // Committed rather than debounced: the tab disappears with the query, so
    // the cards must already be back by the time it goes.
    input.commit('')
    setOpen(false)
  }

  const handleInput = (raw: string): void => {
    if (raw === '') {
      clear()
      return
    }
    input.onInput(raw)
  }

  /** Whether this key is the user starting (or continuing) a quick filter. */
  const isFilterKey = (e: KeyboardEvent): boolean => {
    if (!isPlainTypingKey(e)) return false
    // Space scrolls the page and activates a focused button; it can still be
    // typed into the field once it is open, as a term separator.
    if (e.key === ' ') return false
    if (RESERVED_KEYS.has(e.key)) return false
    return !isKeyboardClaimed()
  }

  useDocumentKeydown((e) => {
    if (!isFilterKey(e)) return
    e.preventDefault()
    input.onInput(input.draft() + e.key)
    // A query already in the field (typed here, set in the Filters panel, or
    // restored from a shared URL) is continued rather than replaced — the two
    // are one value, and silently dropping the panel's query would be worse
    // than a tab that opens mid-word.
    setOpen(true)
    // Solid flushes the render synchronously, so the field is already mounted.
    // Assigning its value leaves the caret at the end, which is where typing
    // should continue from.
    inputEl?.focus()
  })

  return (
    <Show when={open()}>
      <div class="quick-filter">
        <span class="quick-filter-label">{t('site.quickFilter.label')}</span>
        <input
          ref={inputEl}
          class="filter-input quick-filter-input"
          type="text"
          aria-label={t('site.quickFilter.ariaLabel')}
          value={input.draft()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          onBlur={input.flush}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            // Claimed before it reaches the page's other Escape handlers —
            // dismissing the query is this press's whole job.
            e.preventDefault()
            e.stopPropagation()
            clear()
            e.currentTarget.blur()
          }}
        />
        <button
          type="button"
          class="quick-filter-clear"
          aria-label={t('site.quickFilter.clear')}
          title={t('site.quickFilter.clear')}
          onClick={clear}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </Show>
  )
}
