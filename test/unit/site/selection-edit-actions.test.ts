import { describe, expect, test } from 'bun:test'
import {
  buildSelectionEditActions,
  type BulkEditBundle,
} from '../../../src/site/selection-edit-actions'
import type { CardSelectionControl, SelectedCard } from '../../../src/site/useCardSelection'
import type { Finish } from '../../../src/types'

type Call = { name: string; cards: SelectedCard[]; arg?: unknown }

function harness(withCommander = true) {
  const calls: Call[] = []
  let cleared = 0
  const record = (name: string) => (cards: SelectedCard[], arg?: unknown) =>
    calls.push({ name, cards, arg })

  const bundle: BulkEditBundle = {
    addCopy: record('addCopy'),
    removeCopy: record('removeCopy'),
    removeAll: record('removeAll'),
    setFinish: (cards, finish: Finish) => calls.push({ name: 'setFinish', cards, arg: finish }),
    changePrinting: record('changePrinting'),
    setCommander: withCommander ? record('setCommander') : undefined,
    moveToSection: (cards, section) => calls.push({ name: 'moveToSection', cards, arg: section }),
    promptNewSection: record('promptNewSection'),
    sections: () => ['Main', 'Sideboard'],
    moveToList: (cards, dest) => calls.push({ name: 'moveToList', cards, arg: dest }),
    moveTargets: () => [{ type: 'collection', name: 'Binder' }],
  }

  const cards: SelectedCard[] = [
    {
      key: 'a',
      name: 'Sol Ring',
      quantity: 1,
      groupSize: 1,
      scryfallCard: null,
      sourceName: 'Deck',
      sourceKind: 'deck',
      maxQty: 1,
      cardIds: [1],
    },
  ]
  const selection = {
    selected: () => cards,
    clear: () => {
      cleared++
    },
  } as unknown as CardSelectionControl

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
    const h = harness(false)
    expect(h.actions.setCommander).toBeUndefined()
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
