import { describe, expect, test } from 'bun:test'
import {
  deckLineQuantities,
  entryLineQuantities,
  removedArtCardIds,
  replayLineCopies,
} from '../../src/changes/line-copies'
import {
  createAddChange,
  createMoveFromChange,
  createMoveToChange,
  createRemoveChange,
  createSetLabelChange,
} from '../../src/changes/change-event'
import type { DeckData } from '../../src/list/deck'

/**
 * The art half of a save: which `&N` ids stop having custom art because the
 * save's *changes* took their line out of the list. Read from the changes, not
 * from the file that was written — a removal and a re-add of the same card
 * produce a file the diff cannot tell from an untouched one.
 */
describe('removedArtCardIds', () => {
  test('a removed line drops its art', () => {
    const changes = [createRemoveChange('Sol Ring', { cardId: 4 })]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([4])
  })

  test('a card removed and re-added under the same id does not keep it', () => {
    // The pool hands `&4` straight back, so the written file has a line at `&4`
    // either way: only the removal says the art's card is gone.
    const changes = [
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createAddChange('Sol Ring', { cardId: 4 }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([4])
  })

  test('a deck line that merely lost a copy keeps its art', () => {
    const changes = [createRemoveChange('Sol Ring', { cardId: 4 })]
    expect([...removedArtCardIds(changes, new Map([[4, 3]]))]).toEqual([])
  })

  test('a one-copy deck line incremented and decremented again keeps its art', () => {
    // Labels are part of a change's identity, so the increment and the
    // decrement around a label edit no longer cancel each other out and both
    // reach the save. Counted in order, the line never empties — netting the
    // removal against the baseline alone would delete the art of a line that is
    // still in the file, unchanged.
    const changes = [
      createAddChange('Sol Ring', { cardId: 4 }),
      createSetLabelChange('Sol Ring', { cardId: 4, labels: ['proxy'] }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([])
  })

  test('an added copy does not rescue a line whose every copy then goes', () => {
    const changes = [
      createAddChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([4])
  })

  test('removing every copy of a deck line drops it', () => {
    const changes = [
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 2]]))]).toEqual([4])
  })

  test('a card moved to another list takes its art out of this one', () => {
    const changes = [
      createMoveFromChange('Sol Ring', { cardId: 4, to: { type: 'collection', name: 'Binder' } }),
    ]
    expect([...removedArtCardIds(changes, new Map([[4, 1]]))]).toEqual([4])
  })

  test('an id the baseline never had is treated as a single line', () => {
    // A line this save created: whatever was filed under the id belonged to a
    // card that is already gone.
    expect([
      ...removedArtCardIds([createRemoveChange('Sol Ring', { cardId: 9 })], new Map()),
    ]).toEqual([9])
  })

  test('changes without a card id say nothing about the sidecar', () => {
    expect([...removedArtCardIds([createRemoveChange('Sol Ring')], new Map([[4, 1]]))]).toEqual([])
  })
})

describe('replayLineCopies', () => {
  test('replays gains and losses per line in order, reporting each step', () => {
    const changes = [
      createAddChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring', { cardId: 4 }),
      createRemoveChange('Sol Ring'),
    ]
    const steps = replayLineCopies(changes, new Map([[4, 1]]), { unknownIdHolds: 1 })
    expect(steps.map((s) => [s.change.action, s.cardId, s.before, s.after])).toEqual([
      ['add', 4, 1, 2],
      ['remove', 4, 2, 1],
      ['remove', 4, 1, 0],
    ])
  })

  test('a move-to pinning a line in place moves no copies; a split takes one off the pinned line first', () => {
    const inPlace = createMoveToChange('Sol Ring', {
      cardId: 4,
      replacesCardId: 4,
      from: { type: 'collection', name: 'Binder' },
    })
    const split = createMoveToChange('Sol Ring', {
      cardId: 9,
      replacesCardId: 4,
      from: { type: 'collection', name: 'Binder' },
    })
    const steps = replayLineCopies([inPlace, split], new Map([[4, 1]]), { unknownIdHolds: 0 })
    expect(steps.map((s) => [s.cardId, s.before, s.after])).toEqual([
      [4, 1, 0],
      [9, 0, 1],
    ])
    // So an in-place pin keeps the line's art, and a split that drains it drops it.
    expect([...removedArtCardIds([inPlace], new Map([[4, 1]]))]).toEqual([])
    expect([...removedArtCardIds([split], new Map([[4, 1]]))]).toEqual([4])
  })

  test('an id the baseline never had starts at unknownIdHolds', () => {
    const arrival = [createAddChange('Sol Ring', { cardId: 9 })]
    expect(replayLineCopies(arrival, new Map(), { unknownIdHolds: 0 })[0]).toMatchObject({
      before: 0,
      after: 1,
    })
    expect(replayLineCopies(arrival, new Map(), { unknownIdHolds: 1 })[0]).toMatchObject({
      before: 1,
      after: 2,
    })
  })
})

describe('line quantities', () => {
  test('a deck line counts every copy under its id', () => {
    const deck: DeckData = {
      name: 'Goblins',
      sections: [
        {
          name: 'Main',
          cards: [
            { name: 'Goblin Guide', quantity: 4, cardId: 1 },
            { name: 'Sol Ring', quantity: 1, cardId: 2 },
            { name: 'Unnumbered', quantity: 2 },
          ],
        },
      ],
    }
    expect([...deckLineQuantities(deck)]).toEqual([
      [1, 4],
      [2, 1],
    ])
  })

  test('a flat list holds one copy per line', () => {
    expect([...entryLineQuantities([{ cardId: 3 }, { cardId: 5 }, {}])]).toEqual([
      [3, 1],
      [5, 1],
    ])
  })
})
