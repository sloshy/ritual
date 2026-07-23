import type { KeyHint } from '../ui/KeyHints'

/** A titled set of related shortcuts, as listed in the shortcuts dialog. */
export type ShortcutGroup = {
  title: string
  hints: readonly KeyHint[]
}

/**
 * Every keyboard affordance the list editors offer, grouped by where it applies.
 *
 * This is the single source the shortcuts dialog renders, so a new binding is
 * advertised by adding it here alongside its handler. The add-card dialog's
 * own footer hints are step-specific and stay with that component; the entries
 * below summarize them for someone who hasn't opened it yet.
 */
export const EDITOR_SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Editor',
    hints: [
      { keys: ['Ctrl', 'Enter'], label: 'Add a card' },
      { keys: ['Ctrl', 'B'], label: 'Focus the action bar' },
      { keys: ['?'], label: 'Show this list' },
    ],
  },
  {
    title: 'In the action bar',
    hints: [
      { keys: ['←', '→', 'Tab'], label: 'Move between buttons' },
      { keys: ['Enter'], label: 'Activate the focused button' },
      { keys: ['Esc'], label: 'Return focus to the list' },
    ],
  },
  {
    title: 'Add card — search',
    hints: [
      { keys: ['↑', '↓'], label: 'Move through results' },
      { keys: ['Enter'], label: 'Choose the highlighted card' },
    ],
  },
  {
    title: 'Add card — printings',
    hints: [
      { keys: ['←', '→'], label: 'Previous / next printing' },
      { keys: ['↑', '↓'], label: 'Previous / next row' },
      { keys: ['Enter'], label: 'Choose the highlighted printing' },
    ],
  },
  {
    title: 'Add card — finish & condition',
    hints: [
      { keys: ['↑', '↓', '←', '→'], label: 'Change the selected option' },
      { keys: ['Tab'], label: 'Move to the next group' },
      { keys: ['Enter'], label: 'Add the card' },
      { keys: ['Ctrl', 'Enter'], label: 'Add the card, then start another' },
    ],
  },
  {
    title: 'Any dialog',
    hints: [{ keys: ['Esc'], label: 'Close' }],
  },
]
