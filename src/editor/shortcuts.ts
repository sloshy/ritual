import type { KeyHint } from '../ui/KeyHints'
import { ADD_ANOTHER_KEYS, CONFIRM_KEYS } from './card-search/key-hints'
import type { ParameterlessKey } from '../i18n/t'

/**
 * A titled set of related shortcuts, as listed in the shortcuts dialog.
 *
 * Both `title` and each binding's label are {@link MessageKey}s rather than
 * rendered text: this table is evaluated once at module load, so a rendered
 * string would freeze the whole reference in whichever language happened to be
 * active when the bundle booted.
 */
export type ShortcutGroup = {
  title: ParameterlessKey
  bindings: readonly KeyHint[]
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
    title: 'ui.shortcuts.groupEditor',
    bindings: [
      { keys: ['Ctrl', 'Enter'], label: 'ui.shortcuts.addCard' },
      { keys: ['Ctrl', 'B'], label: 'ui.shortcuts.focusActionBar' },
      { keys: ['?'], label: 'ui.shortcuts.showThisList' },
    ],
  },
  {
    title: 'ui.shortcuts.groupActionBar',
    bindings: [
      { keys: ['←', '→', 'Tab'], label: 'ui.shortcuts.moveBetweenButtons' },
      { keys: ['Enter'], label: 'ui.shortcuts.activateButton' },
      { keys: ['Esc'], label: 'ui.shortcuts.returnFocus' },
    ],
  },
  {
    title: 'ui.shortcuts.groupAddCardSearch',
    bindings: [
      { keys: ['↑', '↓'], label: 'ui.shortcuts.moveThroughResults' },
      { keys: ['Enter'], label: 'ui.shortcuts.chooseCard' },
    ],
  },
  {
    title: 'ui.shortcuts.groupAddCardPrintings',
    bindings: [
      { keys: ['←', '→'], label: 'ui.shortcuts.prevNextPrinting' },
      { keys: ['↑', '↓'], label: 'ui.shortcuts.prevNextRow' },
      { keys: ['A–Z', '0–9'], label: 'ui.shortcuts.filterPrintings' },
      { keys: ['Enter'], label: 'ui.shortcuts.choosePrinting' },
    ],
  },
  {
    title: 'ui.shortcuts.groupAddCardFinish',
    bindings: [
      { keys: ['←', '→'], label: 'ui.shortcuts.changeGroupValue' },
      { keys: ['↑', '↓', 'Tab'], label: 'ui.shortcuts.nextGroup' },
      { keys: ['+', '-'], label: 'ui.shortcuts.adjustQuantity' },
      { keys: CONFIRM_KEYS, label: 'ui.shortcuts.addTheCard' },
      { keys: ADD_ANOTHER_KEYS, label: 'ui.shortcuts.addThenAnother' },
    ],
  },
  {
    title: 'ui.shortcuts.groupAnyDialog',
    bindings: [{ keys: ['Esc'], label: 'ui.shortcuts.close' }],
  },
]
