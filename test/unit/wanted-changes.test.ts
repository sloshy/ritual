import { describe, expect, test } from 'bun:test'
import { applyChangeToWantedList } from '../../src/admin/site/types/wanted-changes'
import type { WantedListCardEntry } from '../../src/site/data-types'

function makeEntry(overrides: Partial<WantedListCardEntry> = {}): WantedListCardEntry {
  return {
    name: 'Lightning Bolt',
    price: 1.0,
    fileOrder: 0,
    state: 'name-only',
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
        set: 'C19',
        collectorNumber: '221',
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.state).toBe('printing')
      expect(result[0]!.set).toBe('C19')
      expect(result[0]!.collectorNumber).toBe('221')
    })

    test('adds a fully-specified entry (state 3)', () => {
      const result = applyChangeToWantedList([], {
        action: 'add',
        cardName: 'Sol Ring',
        set: 'C19',
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
    test('removes entry by fileOrder', () => {
      const entries = [makeEntry({ fileOrder: 0 }), makeEntry({ name: 'Sol Ring', fileOrder: 1 })]
      const result = applyChangeToWantedList(entries, {
        action: 'remove',
        cardName: 'Lightning Bolt',
        fileOrder: 0,
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Sol Ring')
    })

    test('removes entry by name match when no fileOrder', () => {
      const entries = [makeEntry(), makeEntry({ name: 'Sol Ring', fileOrder: 1 })]
      const result = applyChangeToWantedList(entries, {
        action: 'remove',
        cardName: 'Lightning Bolt',
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Sol Ring')
    })

    test('removes entry by name and set match', () => {
      const entries = [
        makeEntry({ set: 'LEA', collectorNumber: '161', fileOrder: 0 }),
        makeEntry({ set: 'M20', collectorNumber: '152', fileOrder: 1 }),
      ]
      const result = applyChangeToWantedList(entries, {
        action: 'remove',
        cardName: 'Lightning Bolt',
        set: 'LEA',
        collectorNumber: '161',
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.set).toBe('M20')
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
      const entries = [makeEntry({ set: 'LEA', collectorNumber: '161', state: 'printing' })]
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
          set: 'LEA',
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
})
