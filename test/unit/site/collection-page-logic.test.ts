import { describe, test, expect } from 'bun:test'
import {
  buildGroupIdIndex,
  duplicateGroupKey,
  groupCardIds,
  groupDuplicateEntries,
} from '../../../src/site/collection-page-logic'
import type { CollectionCardEntry } from '../../../src/list/site-data'
import { makeCollectionEntry } from '../../test-utils'

const entry = (over: Partial<CollectionCardEntry> = {}): CollectionCardEntry =>
  makeCollectionEntry({ name: 'Sol Ring', set: 'lea', collectorNumber: '270', price: 1, ...over })

// Each field that joins the key must split the group: merging a keep-marked,
// tagged or custom-art copy into a stack of tradable ones would mislabel it,
// show one copy's tags for all, or price a priceless copy at retail.
describe('duplicateGroupKey', () => {
  const splitting: [string, Partial<CollectionCardEntry>][] = [
    ['name', { name: 'Mox Pearl' }],
    ['set', { set: 'mkm' }],
    ['collectorNumber', { collectorNumber: '271' }],
    ['finish', { finish: 'foil' }],
    ['condition', { condition: 'LP' }],
    ['language', { language: 'ja' }],
    ['labels', { labels: ['keep'] }],
    ['tags', { tags: ['ramp'] }],
    ['customArt', { customArt: 'art/sol.png' }],
    ['hasCustomArt', { hasCustomArt: true }],
  ]

  // Tags are a set: the key canonicalizes, so two orders of one set share a tile.
  test('the same tags in another order do not split it', () => {
    expect(duplicateGroupKey(entry({ tags: ['staple', 'ramp'] }))).toBe(
      duplicateGroupKey(entry({ tags: ['ramp', 'staple'] })),
    )
  })

  for (const [field, over] of splitting) {
    test(`a differing ${field} splits the group`, () => {
      expect(duplicateGroupKey(entry(over))).not.toBe(duplicateGroupKey(entry()))
    })
  }

  // `section` is deliberately outside the identity: two copies of the same
  // printing filed in different sections are still the same physical card, and
  // grouping them apart would double the tile count for a purely display split.
  test('fields outside the identity — price, fileOrder, cardId, note, section — do not split it', () => {
    expect(
      duplicateGroupKey(
        entry({ price: 99, fileOrder: 7, cardId: 4, note: 'x', section: 'Trade Binder' }),
      ),
    ).toBe(duplicateGroupKey(entry()))
  })

  test('a bare language reads as English, so it merges with an explicit en copy', () => {
    expect(duplicateGroupKey(entry({ language: 'en' }))).toBe(duplicateGroupKey(entry()))
  })
})

describe('groupDuplicateEntries', () => {
  test('counts identical copies onto one representative, in first-appearance order', () => {
    const grouped = groupDuplicateEntries([
      entry({ fileOrder: 0, cardId: 1 }),
      entry({ name: 'Mox Pearl', fileOrder: 1, cardId: 2 }),
      entry({ fileOrder: 2, cardId: 3 }),
    ])
    expect(grouped.map((g) => [g.entry.name, g.count])).toEqual([
      ['Sol Ring', 2],
      ['Mox Pearl', 1],
    ])
  })

  test('keeps the first entry of a group as its representative', () => {
    const grouped = groupDuplicateEntries([
      entry({ fileOrder: 5, cardId: 9 }),
      entry({ fileOrder: 6, cardId: 10 }),
    ])
    expect(grouped[0]?.entry.cardId).toBe(9)
  })

  test('an empty list groups to nothing', () => {
    expect(groupDuplicateEntries([])).toEqual([])
  })
})

describe('buildGroupIdIndex / groupCardIds', () => {
  const entries = [
    entry({ fileOrder: 0, cardId: 1 }),
    entry({ fileOrder: 1, cardId: 2 }),
    entry({ name: 'Mox Pearl', fileOrder: 2, cardId: 3 }),
    entry({ fileOrder: 3 }),
  ]
  const index = buildGroupIdIndex(entries)

  test('the index keys ids by group, in entry order, skipping entries with no &N', () => {
    expect([...index.entries()]).toEqual([
      [duplicateGroupKey(entries[0]!), [1, 2]],
      [duplicateGroupKey(entries[2]!), [3]],
    ])
  })

  test('a grouped tile carries every entry it visually represents', () => {
    expect(groupCardIds(index, entries[0]!, true)).toEqual([1, 2])
  })

  test('an ungrouped tile carries only its own entry', () => {
    expect(groupCardIds(index, entries[0]!, false)).toEqual([1])
  })

  test('an entry with no &N yet contributes no id', () => {
    expect(groupCardIds(index, entries[3]!, false)).toEqual([])
  })

  test('a group whose every copy still lacks an &N answers with no ids', () => {
    const idless = [entry({ name: 'Black Lotus', fileOrder: 0 })]
    expect(groupCardIds(buildGroupIdIndex(idless), idless[0]!, true)).toEqual([])
  })
})
