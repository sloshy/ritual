/**
 * The add dialog's footer hints, one set per step. Mirrors the public site's
 * quick-switch dialog: each step advertises its own navigation — a flat result
 * list, a card grid (row-wise ↑/↓, card-wise ←/→), and the finish/condition
 * radio groups.
 */

import type { KeyHint } from '../../ui/KeyHints'
import type { CardSearchStep } from './dialog-state'

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
        { keys: ['Enter'], label: 'ui.hint.continue' },
        { keys: ['Esc'], label: 'ui.hint.close' },
      ]
    case 'finish-condition': {
      const hints: KeyHint[] = [
        { keys: ['←', '→'], label: 'ui.hint.choose' },
        { keys: ['↑', '↓', 'Tab'], label: 'ui.hint.nextGroup' },
      ]
      if (flags.usesQuantity) hints.push({ keys: ['+', '-'], label: 'ui.hint.quantity' })
      hints.push({
        keys: ['Enter'],
        label: flags.isAddFlow ? 'ui.hint.addCard' : 'ui.hint.updateCard',
      })
      if (flags.canAddAnother) hints.push({ keys: ['Ctrl', 'Enter'], label: 'ui.hint.addAnother' })
      hints.push({ keys: ['Esc'], label: 'ui.hint.close' })
      return hints
    }
    default: {
      const unreachable: never = flags.step
      return unreachable
    }
  }
}
