import { describe, expect, test } from 'bun:test'
import type { TargetableEntry, TargetingChange } from '../../src/changes/entry-targeting'
import { findEntryByIdOrName, findTargetEntryIndex } from '../../src/changes/entry-targeting'

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

    test('language is deliberately not part of targeting', () => {
      // A set-language change targets like set-finish: by cardId/fileOrder/
      // name+printing. An entry's language is an attribute the change edits,
      // never a filter — a [ja] entry is found by a plain name match, and two
      // same-printing entries differing only by language are disambiguated by
      // cardId, exactly like two same-printing copies are.
      const multilingual: (TargetableEntry & { language?: string })[] = [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '1', language: 'ja', cardId: 1 },
        { name: 'Sol Ring', set: 'c21', collectorNumber: '1', cardId: 2 },
      ]
      expect(findTargetEntryIndex(multilingual, change({ cardName: 'Sol Ring' }))).toBe(0)
      expect(findTargetEntryIndex(multilingual, change({ cardName: 'Sol Ring', cardId: 2 }))).toBe(
        1,
      )
    })
  })
})

describe('findEntryByIdOrName', () => {
  // The list holds the same card twice: a pinned copy and a name-only line.
  const entries: TargetableEntry[] = [
    { name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 },
    { name: 'Sol Ring', cardId: 2 },
  ]

  test('the id match wins outright over the first same-name entry', () => {
    expect(findEntryByIdOrName(entries, 'Sol Ring', 2)?.cardId).toBe(2)
    expect(findEntryByIdOrName(entries, 'Sol Ring', 1)?.cardId).toBe(1)
  })

  test('falls back to the name when no id is given', () => {
    expect(findEntryByIdOrName(entries, 'Sol Ring')?.cardId).toBe(1)
  })

  test('falls back to the name when the id matches nothing', () => {
    // A tile whose entry has not been saved yet carries an id the data lacks.
    expect(findEntryByIdOrName(entries, 'Sol Ring', 99)?.cardId).toBe(1)
  })

  test('returns undefined when neither id nor name matches', () => {
    expect(findEntryByIdOrName(entries, 'Lightning Bolt', 99)).toBeUndefined()
  })

  test('an id naming a different card does not answer for it', () => {
    // `&N` is recycled, so the id a change carries can belong to another card in
    // the on-disk baseline — these lookups run against both that and live data.
    const recycled: TargetableEntry[] = [
      { name: 'Sol Ring', cardId: 1 },
      { name: 'Lightning Bolt', cardId: 2 },
    ]
    expect(findEntryByIdOrName(recycled, 'Lightning Bolt', 1)?.cardId).toBe(2)
    expect(findEntryByIdOrName(recycled, 'Brainstorm', 1)).toBeUndefined()
  })
})
