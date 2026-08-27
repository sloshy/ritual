import { describe, test, expect } from 'bun:test'
import {
  GROUP_BY_LABELS,
  collectionGroupByOptions,
  combinedGroupByOptions,
  deckGroupByOptions,
  wantedGroupByOptions,
} from '../../../src/site/list-page-options'

const values = (options: readonly { value: string }[]): string[] => options.map((o) => o.value)

// The `value` half of every option is a persisted URL token: `group=` carries it
// in a shared link, and the URL sync validates an incoming value against exactly
// the set these builders return with `sellMode: true`. The order is what the
// dropdown shows, so every row below asserts the whole array rather than
// membership — a reordering is as visible a change as a missing option.
//
// The `label` half is a message key, resolved through `GROUP_BY_LABELS`; the
// labels are checked once, on the deck's set, since every builder draws from
// that one table.
describe('deckGroupByOptions', () => {
  test('offers the deck fields in order, with none last', () => {
    expect(values(deckGroupByOptions(false))).toEqual([
      'type',
      'section',
      'cmc',
      'color-identity',
      'price',
      'printing',
      'none',
    ])
  })

  test('sell mode inserts the buylist fields before none, keeping none last', () => {
    expect(values(deckGroupByOptions(true))).toEqual([
      'type',
      'section',
      'cmc',
      'color-identity',
      'price',
      'printing',
      'buylist-price',
      'on-buylist',
      'none',
    ])
  })

  test('labels are message keys, not rendered text, so the table survives a locale switch', () => {
    expect(deckGroupByOptions(true).map((o) => o.label)).toEqual([
      'site.groupBy.type',
      'site.groupBy.section',
      'site.groupBy.cmc',
      'site.groupBy.colorIdentity',
      'site.groupBy.price',
      'site.groupBy.printing',
      'domain.groupBy.buylistPrice',
      'domain.groupBy.onBuylist',
      'site.groupBy.none',
    ])
  })
})

describe('collectionGroupByOptions', () => {
  test('omits printing (every collection card is pinned) and section without sections', () => {
    expect(values(collectionGroupByOptions(false, false))).toEqual([
      'type',
      'cmc',
      'color-identity',
      'price',
      'none',
    ])
  })

  test('section leads the list once the collection has more than one section', () => {
    expect(values(collectionGroupByOptions(false, true))).toEqual([
      'section',
      'type',
      'cmc',
      'color-identity',
      'price',
      'none',
    ])
  })

  test('sell mode appends the buylist fields before none', () => {
    expect(values(collectionGroupByOptions(true, false))).toEqual([
      'type',
      'cmc',
      'color-identity',
      'price',
      'buylist-price',
      'on-buylist',
      'none',
    ])
  })
})

describe('wantedGroupByOptions', () => {
  test('is the collection set plus printing, which a wanted line may leave open', () => {
    expect(values(wantedGroupByOptions(false, false))).toEqual([
      'type',
      'cmc',
      'color-identity',
      'price',
      'printing',
      'none',
    ])
  })

  test('section leads the list once the wanted list has more than one section', () => {
    expect(values(wantedGroupByOptions(true, true))).toEqual([
      'section',
      'type',
      'cmc',
      'color-identity',
      'price',
      'printing',
      'buylist-price',
      'on-buylist',
      'none',
    ])
  })
})

describe('combinedGroupByOptions', () => {
  test('leads with source and offers printing while no collection is mixed in', () => {
    expect(values(combinedGroupByOptions(false, false, false))).toEqual([
      'source',
      'type',
      'cmc',
      'color-identity',
      'price',
      'printing',
      'none',
    ])
  })

  test('a mixed-in collection drops printing, since every collection card is pinned', () => {
    expect(values(combinedGroupByOptions(false, false, true))).toEqual([
      'source',
      'type',
      'cmc',
      'color-identity',
      'price',
      'none',
    ])
  })

  test('sections and sell mode both widen the set', () => {
    expect(values(combinedGroupByOptions(true, true, true))).toEqual([
      'source',
      'section',
      'type',
      'cmc',
      'color-identity',
      'price',
      'buylist-price',
      'on-buylist',
      'none',
    ])
  })
})

/**
 * Every member of `GroupBy`. `satisfies Record<GroupBy, GroupByMessageKey>` on
 * the table already makes it total at compile time; restating the union here
 * makes adding a grouping a visible decision at runtime too, and lets the
 * builders below be checked for reachability.
 */
const ALL_GROUP_BYS = [
  'buylist-price',
  'cmc',
  'color-identity',
  'none',
  'on-buylist',
  'price',
  'printing',
  'section',
  'source',
  'type',
]

describe('GROUP_BY_LABELS', () => {
  test('labels every grouping, so no dropdown row can fall back to its raw token', () => {
    expect(Object.keys(GROUP_BY_LABELS).sort()).toEqual(ALL_GROUP_BYS)
  })

  test('every labelled grouping is reachable from some page, so no label is dead', () => {
    const offered = new Set([
      ...values(deckGroupByOptions(true)),
      ...values(collectionGroupByOptions(true, true)),
      ...values(wantedGroupByOptions(true, true)),
      ...values(combinedGroupByOptions(true, true, false)),
    ])
    expect([...offered].sort()).toEqual(ALL_GROUP_BYS)
  })
})
