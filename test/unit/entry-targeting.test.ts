import { describe, expect, test } from 'bun:test'
import type { TargetableEntry, TargetingChange } from '../../src/editor/entry-targeting'
import { findTargetEntryIndex } from '../../src/editor/entry-targeting'

function entry(overrides: Partial<TargetableEntry> & { name: string }): TargetableEntry {
  return { ...overrides }
}

function change(overrides: Partial<TargetingChange> & { cardName: string }): TargetingChange {
  return { ...overrides }
}

describe('findTargetEntryIndex', () => {
  const entries: TargetableEntry[] = [
    entry({ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', fileOrder: 0, cardId: 10 }),
    entry({ name: 'Dark Ritual', set: 'lea', collectorNumber: '98', fileOrder: 1, cardId: 20 }),
    entry({ name: 'Counterspell', set: 'lea', collectorNumber: '54', fileOrder: 2 }),
    entry({ name: 'Lightning Bolt', set: '2xm', collectorNumber: '117', fileOrder: 3, cardId: 30 }),
  ]

  describe('Tier 1: cardId match', () => {
    test('finds entry by cardId', () => {
      const idx = findTargetEntryIndex(entries, change({ cardName: 'Anything', cardId: 20 }))
      expect(idx).toBe(1)
    })

    test('cardId takes priority over fileOrder and attribute match', () => {
      const idx = findTargetEntryIndex(
        entries,
        change({
          cardName: 'Lightning Bolt',
          cardId: 30,
          fileOrder: 0,
          set: 'lea',
          collectorNumber: '161',
        }),
      )
      expect(idx).toBe(3)
    })

    test('cardId mismatch falls through to other tiers', () => {
      const idx = findTargetEntryIndex(
        entries,
        change({
          cardName: 'Counterspell',
          cardId: 999,
          set: 'lea',
          collectorNumber: '54',
        }),
      )
      // cardId 999 not found → no fileOrder → attribute fallback matches index 2
      expect(idx).toBe(2)
    })

    test('cardId mismatch falls through to fileOrder', () => {
      const idx = findTargetEntryIndex(
        entries,
        change({
          cardName: 'Whatever',
          cardId: 999,
          fileOrder: 1,
        }),
      )
      // cardId 999 not found → fileOrder 1 matches index 1
      expect(idx).toBe(1)
    })
  })

  describe('Tier 2: fileOrder fallback', () => {
    test('finds entry by fileOrder when no cardId', () => {
      const idx = findTargetEntryIndex(entries, change({ cardName: 'Anything', fileOrder: 2 }))
      expect(idx).toBe(2)
    })

    test('fileOrder is terminal — returns -1 without falling through to attributes', () => {
      const idx = findTargetEntryIndex(
        entries,
        change({
          cardName: 'Lightning Bolt',
          fileOrder: 99,
        }),
      )
      // fileOrder 99 not found → does NOT fall through to attribute match
      expect(idx).toBe(-1)
    })
  })

  describe('Tier 3: attribute fallback', () => {
    test('matches by name only', () => {
      const idx = findTargetEntryIndex(entries, change({ cardName: 'Counterspell' }))
      expect(idx).toBe(2)
    })

    test('matches by name + set (case-insensitive)', () => {
      const idx = findTargetEntryIndex(
        entries,
        change({
          cardName: 'Lightning Bolt',
          set: '2XM',
        }),
      )
      expect(idx).toBe(3)
    })

    test('matches by name + set + collectorNumber', () => {
      const idx = findTargetEntryIndex(
        entries,
        change({
          cardName: 'Lightning Bolt',
          set: 'lea',
          collectorNumber: '161',
        }),
      )
      expect(idx).toBe(0)
    })

    test('name mismatch returns -1', () => {
      const idx = findTargetEntryIndex(entries, change({ cardName: 'Nonexistent Card' }))
      expect(idx).toBe(-1)
    })

    test('set mismatch narrows and returns -1', () => {
      const idx = findTargetEntryIndex(
        entries,
        change({
          cardName: 'Counterspell',
          set: 'mkm',
        }),
      )
      expect(idx).toBe(-1)
    })

    test('collectorNumber mismatch returns -1', () => {
      const idx = findTargetEntryIndex(
        entries,
        change({
          cardName: 'Lightning Bolt',
          set: 'lea',
          collectorNumber: '999',
        }),
      )
      expect(idx).toBe(-1)
    })
  })

  describe('edge cases', () => {
    test('empty entries returns -1', () => {
      const idx = findTargetEntryIndex([], change({ cardName: 'Lightning Bolt' }))
      expect(idx).toBe(-1)
    })

    test('entry with undefined set matches when change has no set filter', () => {
      const sparse: TargetableEntry[] = [entry({ name: 'Opt' })]
      const idx = findTargetEntryIndex(sparse, change({ cardName: 'Opt' }))
      expect(idx).toBe(0)
    })

    test('entry with undefined set does not match when change specifies set', () => {
      const sparse: TargetableEntry[] = [entry({ name: 'Opt' })]
      const idx = findTargetEntryIndex(sparse, change({ cardName: 'Opt', set: 'xln' }))
      expect(idx).toBe(-1)
    })
  })
})
