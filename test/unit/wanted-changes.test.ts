import { describe, expect, test } from 'bun:test'
import { applyChangeToWantedList } from '../../src/editor/wanted-changes'
import type { WantedListCardEntry } from '../../src/site/data-types'
import { runMissMatrix, type MissMatrixCase } from '../test-utils'

function makeEntry(overrides: Partial<WantedListCardEntry> = {}): WantedListCardEntry {
  return {
    name: 'Lightning Bolt',
    price: 1.0,
    fileOrder: 0,
    state: 'name-only',
    section: 'Main',
    ...overrides,
  }
}

describe('applyChangeToWantedList', () => {
  describe('add', () => {
    test('adds a name-only entry', () => {
      const result = applyChangeToWantedList([], {
        action: 'add',
        cardName: 'Sol Ring',
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Sol Ring')
      expect(result[0]!.state).toBe('name-only')
      expect(result[0]!.set).toBeUndefined()
      expect(result[0]!.collectorNumber).toBeUndefined()
      expect(result[0]!.finish).toBeUndefined()
    })

    test('adds a printing entry (state 2)', () => {
      const result = applyChangeToWantedList([], {
        action: 'add',
        cardName: 'Sol Ring',
        set: 'c19',
        collectorNumber: '221',
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.state).toBe('printing')
      expect(result[0]!.set).toBe('c19')
      expect(result[0]!.collectorNumber).toBe('221')
    })

    test('adds a fully-specified entry (state 3)', () => {
      const result = applyChangeToWantedList([], {
        action: 'add',
        cardName: 'Sol Ring',
        set: 'c19',
        collectorNumber: '221',
        finish: 'foil',
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.state).toBe('fully-specified')
      expect(result[0]!.finish).toBe('foil')
    })

    test('appends to existing entries', () => {
      const existing = [makeEntry()]
      const result = applyChangeToWantedList(existing, {
        action: 'add',
        cardName: 'Sol Ring',
      })
      expect(result).toHaveLength(2)
      expect(result[0]!.name).toBe('Lightning Bolt')
      expect(result[1]!.name).toBe('Sol Ring')
    })

    test('sets fileOrder to current entries length', () => {
      const existing = [makeEntry(), makeEntry({ name: 'Sol Ring', fileOrder: 1 })]
      const result = applyChangeToWantedList(existing, {
        action: 'add',
        cardName: 'Mana Crypt',
      })
      expect(result[2]!.fileOrder).toBe(2)
    })
  })

  describe('remove', () => {
    test('removes entry by name match when no fileOrder', () => {
      const entries = [makeEntry(), makeEntry({ name: 'Sol Ring', fileOrder: 1 })]
      const result = applyChangeToWantedList(entries, {
        action: 'remove',
        cardName: 'Lightning Bolt',
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Sol Ring')
    })

    test('returns unchanged array when entry not found', () => {
      const entries = [makeEntry()]
      const result = applyChangeToWantedList(entries, {
        action: 'remove',
        cardName: 'Sol Ring',
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Lightning Bolt')
    })
  })

  describe('set-finish', () => {
    test('sets finish on matching entries', () => {
      const entries = [
        makeEntry({ state: 'name-only' }),
        makeEntry({ name: 'Sol Ring', fileOrder: 1, state: 'name-only' }),
      ]
      const result = applyChangeToWantedList(entries, {
        action: 'set-finish',
        cardName: 'Lightning Bolt',
        finish: 'foil',
      })
      expect(result[0]!.finish).toBe('foil')
      expect(result[1]!.finish).toBeUndefined()
    })

    test('updates state to fully-specified when entry has set and finish', () => {
      const entries = [makeEntry({ set: 'lea', collectorNumber: '161', state: 'printing' })]
      const result = applyChangeToWantedList(entries, {
        action: 'set-finish',
        cardName: 'Lightning Bolt',
        finish: 'foil',
      })
      expect(result[0]!.state).toBe('fully-specified')
    })

    test('updates state to fully-specified when nonfoil is set on entry with set', () => {
      const entries = [
        makeEntry({
          set: 'lea',
          collectorNumber: '161',
          finish: 'foil',
          state: 'fully-specified',
        }),
      ]
      const result = applyChangeToWantedList(entries, {
        action: 'set-finish',
        cardName: 'Lightning Bolt',
        finish: 'nonfoil',
      })
      expect(result[0]!.state).toBe('fully-specified')
      expect(result[0]!.finish).toBe('nonfoil')
    })
  })

  describe('set-printing', () => {
    test('retargets the entry by cardId and recomputes state to fully-specified', () => {
      const entries = [makeEntry({ cardId: 7, state: 'name-only' })]
      const result = applyChangeToWantedList(entries, {
        action: 'set-printing',
        cardName: 'Lightning Bolt',
        cardId: 7,
        set: 'm10',
        collectorNumber: '146',
        finish: 'foil',
      })
      expect(result[0]!.set).toBe('m10')
      expect(result[0]!.collectorNumber).toBe('146')
      expect(result[0]!.finish).toBe('foil')
      expect(result[0]!.state).toBe('fully-specified')
    })

    test('printing without finish yields the "printing" state', () => {
      const entries = [makeEntry({ cardId: 7, state: 'name-only' })]
      const result = applyChangeToWantedList(entries, {
        action: 'set-printing',
        cardName: 'Lightning Bolt',
        cardId: 7,
        set: 'm10',
        collectorNumber: '146',
      })
      expect(result[0]!.state).toBe('printing')
    })

    test('clearing the printing reverts to name-only state', () => {
      const entries = [
        makeEntry({
          cardId: 7,
          set: 'm10',
          collectorNumber: '146',
          finish: 'foil',
          state: 'fully-specified',
        }),
      ]
      const result = applyChangeToWantedList(entries, {
        action: 'set-printing',
        cardName: 'Lightning Bolt',
        cardId: 7,
      })
      expect(result[0]!.set).toBeUndefined()
      expect(result[0]!.collectorNumber).toBeUndefined()
      expect(result[0]!.finish).toBeUndefined()
      expect(result[0]!.state).toBe('name-only')
    })
  })

  describe('set-note', () => {
    test('sets note on matching entry', () => {
      const entries = [makeEntry({ cardId: 3 })]
      const result = applyChangeToWantedList(entries, {
        action: 'set-note',
        cardName: 'Lightning Bolt',
        cardId: 3,
        note: 'looking for a foil',
      })
      expect(result[0]!.note).toBe('looking for a foil')
    })

    test('clears note when given an empty string', () => {
      const entries = [makeEntry({ cardId: 3, note: 'old' })]
      const result = applyChangeToWantedList(entries, {
        action: 'set-note',
        cardName: 'Lightning Bolt',
        cardId: 3,
        note: '',
      })
      expect(result[0]!.note).toBeUndefined()
    })
  })

  describe('set-commander', () => {
    test('returns entries unchanged', () => {
      const entries = [makeEntry()]
      const result = applyChangeToWantedList(entries, {
        action: 'set-commander',
        cardName: 'Lightning Bolt',
      })
      expect(result).toEqual(entries)
    })
  })

  describe('moves', () => {
    test('move-from removes the matched entry', () => {
      const entries = [makeEntry({ cardId: 1 }), makeEntry({ name: 'Brainstorm', cardId: 2 })]
      const result = applyChangeToWantedList(entries, {
        action: 'move-from',
        cardName: 'Lightning Bolt',
        cardId: 1,
        to: { type: 'collection', name: 'Binder' },
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Brainstorm')
    })

    test('move-to adds the card', () => {
      const result = applyChangeToWantedList([], {
        action: 'move-to',
        cardName: 'Brainstorm',
        from: { type: 'deck', name: 'Mono-U' },
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Brainstorm')
    })
  })
})

describe('applyChangeToWantedList — onMiss reporting', () => {
  type WantedChange = Parameters<typeof applyChangeToWantedList>[1]
  const cases: MissMatrixCase<WantedChange>[] = [
    ['remove of an absent entry misses', { action: 'remove', cardName: 'Sol Ring' }, 'no-target'],
    [
      'remove with a wrong-case name misses (matching is case-sensitive)',
      { action: 'remove', cardName: 'lightning bolt' },
      'no-target',
    ],
    ['remove of a present entry applies', { action: 'remove', cardName: 'Lightning Bolt' }, null],
    [
      'remove with a stale cardId and a valid name applies via the name tier',
      { action: 'remove', cardName: 'Lightning Bolt', cardId: 999 },
      null,
    ],
    [
      'set-finish on an absent entry misses',
      { action: 'set-finish', cardName: 'Sol Ring', finish: 'foil' },
      'no-target',
    ],
    [
      'set-printing on an absent entry misses',
      { action: 'set-printing', cardName: 'Sol Ring', set: 'c21', collectorNumber: '1' },
      'no-target',
    ],
    [
      'set-note on an absent entry misses',
      { action: 'set-note', cardName: 'Sol Ring', note: 'x' },
      'no-target',
    ],
    [
      'set-section on an absent entry misses',
      { action: 'set-section', cardName: 'Sol Ring', section: 'Box' },
      'no-target',
    ],
    [
      'move-from of an absent entry misses',
      { action: 'move-from', cardName: 'Sol Ring', to: { type: 'deck', name: 'd' } },
      'no-target',
    ],
    [
      'unset-commander never applies to a wanted list and reports not-applicable',
      { action: 'unset-commander', cardName: 'Lightning Bolt' },
      'not-applicable',
    ],
    ['add never misses', { action: 'add', cardName: 'Sol Ring' }, null],
  ]

  runMissMatrix(applyChangeToWantedList, () => [makeEntry()], cases)
})
