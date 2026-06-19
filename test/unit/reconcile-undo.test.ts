import { describe, expect, test } from 'bun:test'
import { reconcileIdPoolForUndo } from '../../src/editor/reconcile-undo'
import { createMoveFromChange, createRemoveChange, createAddChange } from '../../src/change-event'
import type { UndoEntry } from '../../src/editor/useCardChanges'

function track() {
  const released: number[] = []
  const claimed: number[] = []
  return {
    release: (id: number) => released.push(id),
    claim: (id: number) => claimed.push(id),
    released,
    claimed,
  }
}

describe('reconcileIdPoolForUndo', () => {
  test('undoing an added move-from reclaims the card id (like undoing a removal)', () => {
    const t = track()
    const entry: UndoEntry = {
      addedChange: createMoveFromChange('Sol Ring', {
        cardId: 7,
        to: { type: 'collection', name: 'Binder' },
      }),
      cancelledChange: null,
    }
    reconcileIdPoolForUndo(t.release, t.claim, entry)
    expect(t.claimed).toEqual([7])
    expect(t.released).toEqual([])
  })

  test('undoing an added remove reclaims, undoing an added add releases', () => {
    const removeT = track()
    reconcileIdPoolForUndo(removeT.release, removeT.claim, {
      addedChange: createRemoveChange('Bolt', { cardId: 3 }),
      cancelledChange: null,
    })
    expect(removeT.claimed).toEqual([3])

    const addT = track()
    reconcileIdPoolForUndo(addT.release, addT.claim, {
      addedChange: createAddChange('Bolt', { cardId: 4 }),
      cancelledChange: null,
    })
    expect(addT.released).toEqual([4])
  })

  test('undoing a change that cancelled a prior add reclaims that add’s id', () => {
    const t = track()
    reconcileIdPoolForUndo(t.release, t.claim, {
      addedChange: null,
      cancelledChange: createAddChange('Bolt', { cardId: 9 }),
    })
    expect(t.claimed).toEqual([9])
    expect(t.released).toEqual([])
  })

  test('a move-from without a cardId touches neither pool', () => {
    const t = track()
    reconcileIdPoolForUndo(t.release, t.claim, {
      addedChange: createMoveFromChange('Bolt', { to: { type: 'collection', name: 'X' } }),
      cancelledChange: null,
    })
    expect(t.claimed).toEqual([])
    expect(t.released).toEqual([])
  })
})
