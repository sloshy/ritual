/**
 * A module-level "one dialog request at a time" signal.
 *
 * The card context menus that open a prompt are unmounted the moment they act,
 * so the request has to outlive them: it lives here, and one dialog mounted in
 * the editor shell renders whatever is pending. Stated once so each prompt module
 * (tags, categories, …) is its type plus three lines rather than a fourth copy of
 * the same accessor/open/close trio.
 */

import { createSignal, type Accessor } from 'solid-js'

/** The three functions a prompt module re-exports under its own names. */
export type PromptSingleton<T> = {
  /** The request currently awaiting the user, or null. */
  pending: Accessor<T | null>
  /** Open the dialog, replacing any request already open. */
  open: (prompt: T) => void
  /** Dismiss the dialog without saving. */
  close: () => void
}

export function createPromptSingleton<T>(): PromptSingleton<T> {
  const [pending, setPending] = createSignal<T | null>(null)
  return {
    pending,
    open: (prompt) => setPending(() => prompt),
    close: () => setPending(null),
  }
}
