import { describe, expect, test } from 'bun:test'
import {
  buildSelectionEditActions,
  type BulkEditBundle,
  type SelectionEditActions,
} from '../../../src/list-view/selection-edit-actions'
import type { CardSelectionControl, SelectedCard } from '../../../src/list-view/useCardSelection'
import type { Finish } from '../../../src/card/finish-condition'
import { makeSelectedCard } from '../../test-utils'

type Call = { name: string; cards: SelectedCard[]; arg?: unknown }

/** What a harness may vary; every field defaults to the richest bundle (a deck's). */
type HarnessOptions = {
  /** Decks only. */
  withCommander?: boolean
  /** What the bundle answers when asked whether the finish applies to everything. */
  canSetFinish?: boolean
  /** Deck and collection editors only; a wanted list has nothing to swap. */
  withSwap?: boolean
  /** Whether the selected tile names a printing. */
  pinned?: boolean
}

type Harness = {
  actions: SelectionEditActions
  /** Every bundle call in order, with the cards and extra argument it got. */
  calls: Call[]
  /** The exact array the actions must forward, so identity can be asserted. */
  cards: SelectedCard[]
  /** How many times the selection has been cleared. */
  cleared: () => number
}

function harness(options: HarnessOptions = {}): Harness {
  const { withCommander = true, canSetFinish = true, withSwap = true, pinned = true } = options
  const calls: Call[] = []
  let cleared = 0
  const record = (name: string) => (cards: SelectedCard[], arg?: unknown) =>
    calls.push({ name, cards, arg })

  const bundle: BulkEditBundle = {
    addCopy: record('addCopy'),
    removeCopy: record('removeCopy'),
    removeAll: record('removeAll'),
    setFinish: (cards, finish: Finish) => calls.push({ name: 'setFinish', cards, arg: finish }),
    canSetFinish: (cards, finish: Finish) => {
      calls.push({ name: 'canSetFinish', cards, arg: finish })
      return canSetFinish
    },
    setLanguage: (cards, language) => calls.push({ name: 'setLanguage', cards, arg: language }),
    changePrinting: record('changePrinting'),
    swapPrintings: withSwap ? record('swapPrintings') : undefined,
    setCommander: withCommander ? record('setCommander') : undefined,
    moveToSection: (cards, section) => calls.push({ name: 'moveToSection', cards, arg: section }),
    promptNewSection: record('promptNewSection'),
    sections: () => ['Main', 'Sideboard'],
    moveToList: (cards, dest) => calls.push({ name: 'moveToList', cards, arg: dest }),
    moveTargets: () => [{ type: 'collection', name: 'Binder' }],
  }

  const cards: SelectedCard[] = [
    makeSelectedCard({
      key: 'a',
      name: 'Sol Ring',
      sourceName: 'Deck',
      cardIds: [1],
      ...(pinned ? { set: 'c21', collectorNumber: '263' } : {}),
    }),
  ]
  // A real literal, not a cast: only `selected` and `clear` are exercised, but
  // the rest are the honest no-ops a control with nothing selected would give,
  // so a new member of the interface shows up here instead of being erased.
  const selection: CardSelectionControl = {
    selected: () => cards,
    count: () => cards.length,
    value: () => 0,
    state: () => 'none',
    toggle: () => {},
    removeOne: () => {},
    clear: () => {
      cleared++
    },
  }

  return {
    actions: buildSelectionEditActions(bundle, selection),
    calls,
    cards,
    cleared: () => cleared,
  }
}

describe('buildSelectionEditActions', () => {
  test('each action forwards the live selection then clears it', () => {
    const h = harness()
    h.actions.addCopy()
    h.actions.removeCopy()
    h.actions.removeAll()
    h.actions.changePrinting()
    h.actions.promptNewSection()
    expect(h.calls.map((c) => c.name)).toEqual([
      'addCopy',
      'removeCopy',
      'removeAll',
      'changePrinting',
      'promptNewSection',
    ])
    for (const call of h.calls) expect(call.cards).toBe(h.cards)
    expect(h.cleared()).toBe(5)
  })

  test('setFoil/setNonfoil pass the finish', () => {
    const h = harness()
    h.actions.setFoil()
    h.actions.setNonfoil()
    expect(h.calls).toEqual([
      { name: 'setFinish', cards: h.cards, arg: 'foil' },
      { name: 'setFinish', cards: h.cards, arg: 'nonfoil' },
    ])
    expect(h.cleared()).toBe(2)
  })

  test('canSetFoil asks the bundle about the live selection without clearing it', () => {
    const h = harness()
    // The menu calls this on every render to decide whether the row is dead;
    // clearing the selection there would deselect the cards it is describing.
    expect(h.actions.canSetFoil()).toBe(true)
    expect(h.calls).toEqual([{ name: 'canSetFinish', cards: h.cards, arg: 'foil' }])
    expect(h.cleared()).toBe(0)
  })

  test('canSetFoil reports the bundle’s refusal', () => {
    const h = harness({ canSetFinish: false })
    expect(h.actions.canSetFoil()).toBe(false)
  })

  test('setLanguage passes the language and clears', () => {
    const h = harness()
    h.actions.setLanguage!('ja')
    expect(h.calls).toEqual([{ name: 'setLanguage', cards: h.cards, arg: 'ja' }])
    expect(h.cleared()).toBe(1)
  })

  test('moveToSection passes the section name and clears', () => {
    const h = harness()
    h.actions.moveToSection('Sideboard')
    expect(h.calls).toEqual([{ name: 'moveToSection', cards: h.cards, arg: 'Sideboard' }])
    expect(h.cleared()).toBe(1)
  })

  test('setCommander forwards the selection and clears when the bundle has one', () => {
    const h = harness()
    h.actions.setCommander!()
    expect(h.calls).toEqual([{ name: 'setCommander', cards: h.cards, arg: undefined }])
    expect(h.cleared()).toBe(1)
  })

  test('omits setCommander when the bundle has none (flat lists)', () => {
    const h = harness({ withCommander: false })
    expect(h.actions.setCommander).toBeUndefined()
  })

  test('swapPrintings forwards the selection and clears when the bundle has one', () => {
    const h = harness()
    h.actions.swapPrintings!()
    expect(h.calls).toEqual([{ name: 'swapPrintings', cards: h.cards, arg: undefined }])
    expect(h.cleared()).toBe(1)
  })

  test('omits swapPrintings when the bundle has none (wanted lists)', () => {
    const h = harness({ withSwap: false })
    expect(h.actions.swapPrintings).toBeUndefined()
  })

  test('offers swapPrintings for a name-only selection (the wizard sets its printing)', () => {
    const h = harness({ pinned: false })
    h.actions.swapPrintings!()
    expect(h.calls).toEqual([{ name: 'swapPrintings', cards: h.cards, arg: undefined }])
  })

  test('exposes the bundle sections accessor', () => {
    const h = harness()
    expect(h.actions.sections()).toEqual(['Main', 'Sideboard'])
  })

  test('moveToList forwards the live selection plus destination and clears', () => {
    const h = harness()
    const dest = { type: 'collection' as const, name: 'Binder' }
    h.actions.moveToList(dest)
    expect(h.calls).toEqual([{ name: 'moveToList', cards: h.cards, arg: dest }])
    expect(h.cleared()).toBe(1)
  })

  test('exposes the bundle moveTargets accessor without clearing', () => {
    const h = harness()
    expect(h.actions.moveTargets()).toEqual([{ type: 'collection', name: 'Binder' }])
    expect(h.cleared()).toBe(0)
  })
})
