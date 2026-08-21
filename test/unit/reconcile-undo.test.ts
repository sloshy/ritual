import { describe, expect, test } from 'bun:test'
import { reconcileIdPoolForUndo, replayChanges } from '../../src/editor/reconcile-undo'
import { createMoveFromChange, createRemoveChange, createAddChange } from '../../src/change-event'
import type { UndoEntry } from '../../src/editor/useCardChanges'
import type { ChangeEvent } from '../../src/change-event'
import { applyChangeToDeck } from '../../src/editor/deck-changes'
import type { DeckData } from '../../src/types'

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

  test('undoing one copy of a multi-copy add keeps the shared id until the last copy goes', () => {
    // A 3-copy deck add: three events under one card id, undone one at a time.
    const copies = [1, 2, 3].map(() => createAddChange('Bolt', { cardId: 5 }))

    const guarded = track()
    reconcileIdPoolForUndo(
      guarded.release,
      guarded.claim,
      { addedChange: copies[2]!, cancelledChange: null },
      [copies[0]!, copies[1]!],
    )
    expect(guarded.released).toEqual([])

    const last = track()
    reconcileIdPoolForUndo(
      last.release,
      last.claim,
      { addedChange: copies[0]!, cancelledChange: null },
      [],
    )
    expect(last.released).toEqual([5])
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

describe('replayChanges', () => {
  /** A deck line that pins no printing, so a foil token has nothing to describe. */
  const nameOnlyDeck = (): DeckData => ({
    name: 'Test Deck',
    sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 9 }] }],
  })

  const change = (overrides: Partial<ChangeEvent> & { action: string }): ChangeEvent =>
    ({
      id: `c-${overrides.action}`,
      timestamp: 1,
      cardName: 'Sol Ring',
      ...overrides,
    }) as ChangeEvent

  test('reports a change the engine refused, with its reason, and leaves the data without it', () => {
    // The undo case the refusal exists for: the set-printing that pinned the
    // card has been taken back, so replaying the set-finish over the on-disk
    // baseline can no longer apply.
    const setFoil = change({ action: 'set-finish', cardId: 9, finish: 'foil' })
    const result = replayChanges(nameOnlyDeck(), [setFoil], applyChangeToDeck)

    expect(result.refused).toEqual([{ change: setFoil, reason: 'needs-printing' }])
    expect(result.data.sections[0]!.cards[0]!.finish).toBeUndefined()
  })

  test('applies a change the earlier ones made possible', () => {
    // Interleaved, not validated up front: the pin lands first, so the finish
    // that follows it is fine.
    const changes = [
      change({ action: 'set-printing', cardId: 9, set: 'c19', collectorNumber: '221' }),
      change({ action: 'set-finish', cardId: 9, finish: 'foil' }),
    ]
    const result = replayChanges(nameOnlyDeck(), changes, applyChangeToDeck)

    expect(result.refused).toEqual([])
    expect(result.data.sections[0]!.cards[0]!.finish).toBe('foil')
  })
})
