import { describe, expect, test } from 'bun:test'
import { useCardChanges } from '../../src/editor/useCardChanges'

/**
 * What `addCard` reports back. The stack bookkeeping itself is pinned by the
 * change-event tests (`areOppositeChanges`) and by the undo tests — this covers
 * the one thing the hook's *result* adds: naming the line that survives when an
 * add cancels a pending removal, which is the handle its caller needs to put
 * carried custom art on the right `&N`.
 *
 * Signals work under `bun test`; memos resolve against solid's server build and
 * never recompute, so assertions read the raw `changes` signal.
 */

const RING = { set: 'c21', collectorNumber: '263', finish: 'nonfoil' } as const

describe('useCardChanges — addCard result', () => {
  test('a recorded add reports the event it pushed', () => {
    const changes = useCardChanges()
    const result = changes.addCard('Sol Ring', { ...RING, cardId: 4 })

    expect(result.kind).toBe('added')
    if (result.kind !== 'added') throw new Error('unreachable')
    expect(result.change).toMatchObject({ action: 'add', cardName: 'Sol Ring', cardId: 4 })
    expect(changes.changes()).toHaveLength(1)
  })

  test('an add that cancels a removal reports the removal, which names the surviving line', () => {
    const changes = useCardChanges()
    changes.removeCard('Sol Ring', { ...RING, cardId: 4 })
    // The pool hands the re-add the number the removal released, which is what
    // makes the two opposites in the first place.
    const result = changes.addCard('Sol Ring', { ...RING, cardId: 4 })

    expect(result.kind).toBe('cancelled')
    if (result.kind !== 'cancelled') throw new Error('unreachable')
    // The `&N` of the line the file keeps — art carried by the add belongs here.
    expect(result.cancelled).toMatchObject({ action: 'remove', cardName: 'Sol Ring', cardId: 4 })
    // And nothing is left to save: the session leaves the line as it was.
    expect(changes.changes()).toEqual([])
  })

  test('a re-add under a different label override is not a cancellation', () => {
    const changes = useCardChanges()
    changes.removeCard('Sol Ring', { ...RING, cardId: 4 })
    const result = changes.addCard('Sol Ring', { ...RING, cardId: 4, labels: ['proxy'] })

    // Labels are part of a card's identity, so this re-adds rather than cancels
    // — and the caller's art therefore belongs to the *new* line's id.
    expect(result.kind).toBe('added')
    expect(changes.changes()).toHaveLength(2)
  })
})
