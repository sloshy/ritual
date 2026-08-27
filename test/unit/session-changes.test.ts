import { describe, expect, test } from 'bun:test'
import {
  addedCardNamesFrom,
  refusedToConflicts,
  usedIdsAfterRestore,
} from '../../src/editor/session-changes'
import {
  createAddChange,
  createMoveFromChange,
  createRemoveChange,
  createSetFinishChange,
  type ChangeEvent,
} from '../../src/changes/change-event'

const ORIGINAL_IDS = new Map<string, number>([['Sol Ring', 1]])
const findOriginalId = (name: string): number | undefined => ORIGINAL_IDS.get(name)

const changes: ChangeEvent[] = [
  createAddChange('Sol Ring', { cardId: 1 }),
  createAddChange('Counterspell', { cardId: 2 }),
  createAddChange('Counterspell', { cardId: 3 }),
  createMoveFromChange('Lightning Bolt', { cardId: 4, to: { type: 'collection', name: 'Binder' } }),
  createRemoveChange('Fog', { cardId: 5 }),
  createSetFinishChange('Sol Ring', { finish: 'foil', cardId: 1 }),
  // A change with no `&N` at all claims no id.
  createRemoveChange('Fog'),
]

describe('addedCardNamesFrom', () => {
  test('names each card added that the original did not hold, once', () => {
    expect(addedCardNamesFrom(changes, findOriginalId)).toEqual(['Counterspell'])
  })

  test('with no original every add counts', () => {
    expect(addedCardNamesFrom(changes, () => undefined)).toEqual(['Sol Ring', 'Counterspell'])
  })
})

describe('usedIdsAfterRestore', () => {
  test('unions the original ids with every id the restored changes reference, skipping id-less changes', () => {
    expect(usedIdsAfterRestore([1, 9], changes)).toEqual([1, 9, 2, 3, 4, 5])
  })
})

describe('refusedToConflicts', () => {
  test('reports a refusal under the import-side name of its reason', () => {
    const change = createAddChange('Fog', { cardId: 5 })
    expect(
      refusedToConflicts([
        { change, reason: 'no-target' },
        { change, reason: 'needs-printing' },
      ]),
    ).toEqual([
      { change, reason: 'target-not-found' },
      { change, reason: 'needs-printing' },
    ])
  })
})
