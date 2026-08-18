import { createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'

export type DebouncedInput = {
  /** The value to bind to the input; updates instantly on every keystroke. */
  draft: Accessor<string>
  /** Handle an input event: update the draft now, commit after the debounce pause. */
  onInput: (raw: string) => void
  /** Commit any pending value immediately (e.g. on blur), cancelling the timer. */
  flush: () => void
  /**
   * Set the draft to `value` and commit it now, cancelling any pending commit.
   * For edits that must not wait out the debounce because the field is going
   * away with them (a Clear button, an emptied quick filter).
   */
  commit: (value: string) => void
  /**
   * Drop any pending commit and re-sync the draft to `external`. Call this when the
   * downstream value is reset directly (e.g. "Clear all"), since that reset may not
   * change `external` — a debounced value not yet committed leaves the store already
   * at its default — so the on-change re-sync wouldn't otherwise fire.
   */
  reset: () => void
}

/**
 * Bridges a text input to a slower downstream update (here, the card-filter store,
 * which re-filters and re-renders the whole grid on every change). The input reflects
 * keystrokes instantly via {@link DebouncedInput.draft}, while `commit` runs only once
 * the user pauses for `delayMs`, so fast typing no longer fires a filter pass per key.
 *
 * `external` is the authoritative value the field mirrors (the store, as a string).
 * When it changes from outside — a "Clear all", a shared-URL restore, a currency reset
 * that clears the price — the draft re-syncs to it and any pending commit is dropped so
 * a just-cleared value can't be re-applied. A commit still pending when the field
 * unmounts (the Filters menu closes mid-type) is flushed, not lost.
 */
export function useDebouncedInput(
  external: Accessor<string>,
  commit: (value: string) => void,
  delayMs = 250,
): DebouncedInput {
  const [draft, setDraft] = createSignal(external())
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const flush = (): void => {
    if (timer === null) return
    cancel()
    commit(draft())
  }

  onCleanup(flush)

  // Re-sync to an external change (reset, URL restore, currency reset), dropping any
  // commit still pending for the now-stale draft. `defer` skips the initial run so the
  // draft keeps its constructor-time seed.
  createEffect(
    on(
      external,
      (value) => {
        cancel()
        setDraft(value)
      },
      { defer: true },
    ),
  )

  const reset = (): void => {
    cancel()
    setDraft(external())
  }

  const onInput = (raw: string): void => {
    setDraft(raw)
    cancel()
    timer = setTimeout(() => {
      timer = null
      commit(raw)
    }, delayMs)
  }

  const commitNow = (value: string): void => {
    cancel()
    setDraft(value)
    commit(value)
  }

  return { draft, onInput, flush, reset, commit: commitNow }
}
