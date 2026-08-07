import { describe, expect, test } from 'bun:test'
import type { ExportEntry } from '../../src/export/entries'
import { diffLists, isDiffBy, isListDiffEmpty } from '../../src/list-diff'
import type { Finish } from '../../src/types'

/** Build an ExportEntry with the diff-relevant fields; list identity is noise here. */
type EntrySpec = {
  name: string
  quantity?: number
  set?: string
  collectorNumber?: string
  finish?: Finish
  language?: ExportEntry['language']
  section?: string
}

function entries(specs: EntrySpec[]): ExportEntry[] {
  return specs.map((spec, fileOrder) => ({
    listType: 'deck',
    listName: 'test',
    section: spec.section ?? 'Main',
    name: spec.name,
    quantity: spec.quantity ?? 1,
    set: spec.set,
    collectorNumber: spec.collectorNumber,
    finish: spec.finish,
    language: spec.language,
    fileOrder,
  }))
}

describe('diffLists by name', () => {
  test('splits identities into matches / onlyInA / onlyInB with summed quantities', () => {
    const a = entries([
      { name: 'Sol Ring', quantity: 1 },
      { name: 'Lightning Bolt', quantity: 2, set: 'lea', collectorNumber: '161' },
      { name: 'Lightning Bolt', quantity: 1, set: '2xm', collectorNumber: '157' },
    ])
    const b = entries([
      { name: 'Lightning Bolt', quantity: 1, set: 'lea', collectorNumber: '161' },
      { name: 'Brainstorm', quantity: 3 },
    ])

    const result = diffLists(a, b, 'name')

    expect(result.by).toBe('name')
    expect(result.matches).toEqual([
      {
        name: 'Lightning Bolt',
        a: {
          quantity: 3,
          printings: [
            { set: 'lea', collectorNumber: '161', finish: 'nonfoil', quantity: 2 },
            { set: '2xm', collectorNumber: '157', finish: 'nonfoil', quantity: 1 },
          ],
        },
        b: {
          quantity: 1,
          printings: [{ set: 'lea', collectorNumber: '161', finish: 'nonfoil', quantity: 1 }],
        },
      },
    ])
    expect(result.onlyInA).toEqual([
      {
        name: 'Sol Ring',
        quantity: 1,
        printings: [{ set: undefined, collectorNumber: undefined, finish: 'nonfoil', quantity: 1 }],
      },
    ])
    expect(result.onlyInB.map((o) => o.name)).toEqual(['Brainstorm'])
    expect(isListDiffEmpty(result)).toBe(false)
  })

  test('matches names across case, accents, and punctuation', () => {
    const a = entries([{ name: "Jace's Archivist" }])
    const b = entries([{ name: 'jaces archivist' }])

    const result = diffLists(a, b, 'name')

    expect(result.onlyInA).toEqual([])
    expect(result.onlyInB).toEqual([])
    // Display keeps side A's first-seen raw spelling.
    expect(result.matches.map((m) => m.name)).toEqual(["Jace's Archivist"])
    expect(isListDiffEmpty(result)).toBe(true)
  })

  test('different printings of the same name are one identity', () => {
    const a = entries([{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', finish: 'foil' }])
    const b = entries([{ name: 'Sol Ring', set: 'ltc', collectorNumber: '284' }])

    const result = diffLists(a, b, 'name')

    expect(result.matches).toHaveLength(1)
    expect(result.onlyInA).toEqual([])
    expect(result.onlyInB).toEqual([])
    expect(isListDiffEmpty(result)).toBe(true)
  })

  test('aggregates across sections (Maybeboard extras count)', () => {
    const a = entries([
      { name: 'Sol Ring', quantity: 1, section: 'Main' },
      { name: 'Sol Ring', quantity: 1, section: 'Maybeboard' },
    ])
    const b = entries([{ name: 'Sol Ring', quantity: 2 }])

    const result = diffLists(a, b, 'name')

    expect(result.matches[0]?.a.quantity).toBe(2)
    expect(isListDiffEmpty(result)).toBe(true)
  })

  test('orders results by first-seen file order, side A before side B', () => {
    const a = entries([{ name: 'Zebra Unicorn' }, { name: 'Aetherflux Reservoir' }])
    const b = entries([{ name: 'Mox Opal' }, { name: 'Black Lotus' }])

    const result = diffLists(a, b, 'name')

    expect(result.onlyInA.map((o) => o.name)).toEqual(['Zebra Unicorn', 'Aetherflux Reservoir'])
    expect(result.onlyInB.map((o) => o.name)).toEqual(['Mox Opal', 'Black Lotus'])
  })
})

describe('diffLists by printing', () => {
  test('an unmarked line matches an explicit [nonfoil] line (finish folding)', () => {
    const a = entries([{ name: 'Sol Ring', set: 'c21', collectorNumber: '263' }])
    const b = entries([{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', finish: 'nonfoil' }])

    const result = diffLists(a, b, 'printing')

    expect(result.matches).toHaveLength(1)
    expect(result.onlyInA).toEqual([])
    expect(result.onlyInB).toEqual([])
    expect(isListDiffEmpty(result)).toBe(true)
  })

  test('the same printing in different finishes is two identities', () => {
    const a = entries([{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', finish: 'foil' }])
    const b = entries([{ name: 'Sol Ring', set: 'c21', collectorNumber: '263' }])

    const result = diffLists(a, b, 'printing')

    expect(result.matches).toEqual([])
    expect(result.onlyInA[0]?.printings).toEqual([
      { set: 'c21', collectorNumber: '263', finish: 'foil', quantity: 1 },
    ])
    expect(result.onlyInB[0]?.printings).toEqual([
      { set: 'c21', collectorNumber: '263', finish: 'nonfoil', quantity: 1 },
    ])
  })

  test('name-only lines form their own no-printing bucket, apart from pinned printings', () => {
    const a = entries([{ name: 'Sol Ring' }])
    const b = entries([
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263' },
      { name: 'Sol Ring' },
    ])

    const result = diffLists(a, b, 'printing')

    // The two name-only lines match each other; the pinned printing is B-only.
    expect(result.matches).toEqual([
      {
        name: 'Sol Ring',
        a: {
          quantity: 1,
          printings: [
            { set: undefined, collectorNumber: undefined, finish: 'nonfoil', quantity: 1 },
          ],
        },
        b: {
          quantity: 1,
          printings: [
            { set: undefined, collectorNumber: undefined, finish: 'nonfoil', quantity: 1 },
          ],
        },
      },
    ])
    expect(result.onlyInB).toEqual([
      {
        name: 'Sol Ring',
        quantity: 1,
        printings: [{ set: 'c21', collectorNumber: '263', finish: 'nonfoil', quantity: 1 }],
      },
    ])
    expect(isListDiffEmpty(result)).toBe(false)
  })

  test('an unmarked line matches an explicit [en] line (language folding)', () => {
    const a = entries([{ name: 'Sol Ring', set: 'c21', collectorNumber: '263' }])
    const b = entries([{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', language: 'en' }])

    const result = diffLists(a, b, 'printing')

    expect(result.matches).toHaveLength(1)
    expect(isListDiffEmpty(result)).toBe(true)
  })

  test('the same printing in different languages is two identities', () => {
    const a = entries([{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', language: 'ja' }])
    const b = entries([{ name: 'Sol Ring', set: 'c21', collectorNumber: '263' }])

    const result = diffLists(a, b, 'printing')

    expect(result.matches).toEqual([])
    expect(result.onlyInA).toHaveLength(1)
    expect(result.onlyInB).toHaveLength(1)
  })

  test('reports quantity mismatches on a matched printing', () => {
    const a = entries([{ name: 'Lightning Bolt', quantity: 3, set: 'lea', collectorNumber: '161' }])
    const b = entries([{ name: 'Lightning Bolt', quantity: 1, set: 'lea', collectorNumber: '161' }])

    const result = diffLists(a, b, 'printing')

    expect(result.matches[0]?.a.quantity).toBe(3)
    expect(result.matches[0]?.b.quantity).toBe(1)
    expect(isListDiffEmpty(result)).toBe(false)
  })
})

describe('isDiffBy', () => {
  test('accepts only the two modes', () => {
    expect(isDiffBy('name')).toBe(true)
    expect(isDiffBy('printing')).toBe(true)
    expect(isDiffBy('Name')).toBe(false)
    expect(isDiffBy('set')).toBe(false)
  })
})
