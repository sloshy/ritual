/**
 * The add dialog's footer hints, one set per step. Mirrors the public site's
 * quick-switch dialog: each step advertises its own navigation — a flat result
 * list, a card grid (row-wise ↑/↓, card-wise ←/→), and the finish/condition
 * radio groups.
 */

import type { KeyHint, KeyLabel } from '../../ui/KeyHints'
import type { CardSearchStep } from './dialog-state'

/**
 * The keys that confirm a step — continue past the language notice, add or
 * update the card. The step's button shows them as chips, so the button and the
 * footer hint advertise one binding from one place.
 */
export const CONFIRM_KEYS: readonly KeyLabel[] = ['Enter']

/** The keys that add the card and reopen the search for another, as the button and the footer show them. */
export const ADD_ANOTHER_KEYS: readonly KeyLabel[] = ['Ctrl', 'Enter']

/** What decides which hints the finish/condition step shows. */
export type CardSearchHintFlags = {
  step: CardSearchStep
  /** The normal add flow (vs change-printing mode, which updates one card). */
  isAddFlow: boolean
  usesQuantity: boolean
  canAddAnother: boolean
}

export function keyHintsFor(flags: CardSearchHintFlags): KeyHint[] {
  switch (flags.step) {
    case 'search':
      return [
        { keys: ['↑', '↓'], label: 'ui.hint.navigate' },
        { keys: ['Enter'], label: 'ui.hint.select' },
        { keys: ['Esc'], label: 'ui.hint.close' },
      ]
    case 'printing':
      return [
        { keys: ['←', '→'], label: 'ui.hint.printing' },
        { keys: ['↑', '↓'], label: 'ui.hint.row' },
        { keys: ['A–Z', '0–9'], label: 'ui.hint.filterPrintings' },
        { keys: ['Enter'], label: 'ui.hint.select' },
        { keys: ['Esc'], label: 'ui.hint.close' },
      ]
    case 'language-notice':
      return [
        { keys: CONFIRM_KEYS, label: 'ui.hint.continue' },
        { keys: ['Esc'], label: 'ui.hint.close' },
      ]
    case 'finish-condition': {
      const shown: KeyHint[] = [
        { keys: ['←', '→'], label: 'ui.hint.choose' },
        { keys: ['↑', '↓', 'Tab'], label: 'ui.hint.nextGroup' },
      ]
      if (flags.usesQuantity) shown.push({ keys: ['+', '-'], label: 'ui.hint.quantity' })
      shown.push({
        keys: CONFIRM_KEYS,
        label: flags.isAddFlow ? 'ui.hint.addCard' : 'ui.hint.updateCard',
      })
      if (flags.canAddAnother) shown.push({ keys: ADD_ANOTHER_KEYS, label: 'ui.hint.addAnother' })
      shown.push({ keys: ['Esc'], label: 'ui.hint.close' })
      return shown
    }
    default: {
      const unreachable: never = flags.step
      return unreachable
    }
  }
}
