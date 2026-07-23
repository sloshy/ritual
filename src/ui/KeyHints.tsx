import { type Component, For } from 'solid-js'

/**
 * A key as it is spelled on screen. Closed so every surface renders the same
 * key the same way — the set is small, and a free-form string let "Enter" and
 * "⏎" drift apart between the shortcuts reference and a dialog's footer hints.
 */
export type KeyLabel =
  | 'Ctrl'
  | 'Cmd'
  | 'Enter'
  | 'Tab'
  | 'Esc'
  | '←'
  | '→'
  | '↑'
  | '↓'
  // Character keys, listed as bindings claim them.
  | '?'
  | 'B'

/** A keyboard affordance: the keys to press, and what pressing them does. */
export type KeyHint = { keys: readonly KeyLabel[]; label: string }

type KeyChipsProps = Pick<KeyHint, 'keys'>

/**
 * The keys of a {@link KeyHint} rendered as `<kbd>` chips. Shared so a dialog's
 * footer hints and the shortcuts reference render identical-looking keys.
 */
export const KeyChips: Component<KeyChipsProps> = (props) => (
  <For each={props.keys}>{(key) => <kbd>{key}</kbd>}</For>
)
