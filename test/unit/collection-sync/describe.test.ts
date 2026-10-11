import { afterEach, describe, expect, test } from 'bun:test'
import {
  collectionChangeCounts,
  collectionChangePlace,
  collectionListLines,
  collectionRunLines,
  describeAmbiguousLists,
  describeAmbiguousRemoval,
  describeCollectionCardChange,
  describeCollectionChangesLine,
  type CollectionKeyParts,
} from '../../../src/collection-sync/describe'
import { describeSyncCard } from '../../../src/sync/describe'
import type {
  CollectionSyncCardAdded,
  CollectionSyncCardChange,
} from '../../../src/collection-sync/types'
import { DEFAULT_LOCALE, resetI18nRuntime } from '../../../src/i18n/runtime'
import {
  english,
  englishLines,
  loadSyntheticLocale,
  withSyntheticLocale,
} from '../../helpers/sync-text'

/**
 * The sentences a collection sync produces twice — once by the engine as it
 * streams, once by the admin page replaying a finished report. Pinned here so
 * both sides keep saying the same thing.
 */

function parts(overrides: Partial<CollectionKeyParts> = {}): CollectionKeyParts {
  return { set: 'clb', collectorNumber: '507', finish: 'nonfoil', condition: 'NM', ...overrides }
}

describe('describeSyncCard', () => {
  test('uppercases the set code and omits the default finish and condition', () => {
    expect(describeSyncCard('Sol Ring', parts({ set: 'ltc', collectorNumber: '284' }))).toBe(
      'Sol Ring (LTC:284)',
    )
  })

  test('names a non-default finish and condition, in that order', () => {
    expect(
      describeSyncCard('Karlach, Fury of Avernus', parts({ finish: 'etched', condition: 'LP' })),
    ).toBe('Karlach, Fury of Avernus (CLB:507) [etched] [LP]')
  })
})

describe('describeAmbiguousRemoval', () => {
  test('says "ambiguous", and names every list with the copies it holds', () => {
    expect(
      english(
        describeAmbiguousRemoval({
          key: 'lea|161|nonfoil|NM|en',
          parts: parts({ set: 'lea', collectorNumber: '161' }),
          name: 'Lightning Bolt',
          quantity: 2,
          lists: [
            { list: 'Blue Binder', copies: 1 },
            { list: 'Long Box', copies: 2 },
          ],
        }),
      ),
    ).toBe(
      'Not removing 2 × Lightning Bolt (LEA:161): ambiguous — copies live in "Blue Binder" (1) and "Long Box" (2).',
    )
  })
})

describe('describeAmbiguousLists', () => {
  const BLUE = { list: 'Blue Binder', copies: 1 }
  const LONG = { list: 'Long Box', copies: 2 }
  const SHOP = { list: 'Card Shop', copies: 3 }

  test('names a single list on its own', () => {
    expect(describeAmbiguousLists([BLUE], DEFAULT_LOCALE)).toBe('"Blue Binder" (1)')
  })

  test('joins two lists with "and"', () => {
    expect(describeAmbiguousLists([BLUE, LONG], DEFAULT_LOCALE)).toBe(
      '"Blue Binder" (1) and "Long Box" (2)',
    )
  })

  test('joins three lists with commas and a final "and"', () => {
    expect(describeAmbiguousLists([BLUE, LONG, SHOP], DEFAULT_LOCALE)).toBe(
      '"Blue Binder" (1), "Long Box" (2), and "Card Shop" (3)',
    )
  })

  describe('in another locale', () => {
    afterEach(() => resetI18nRuntime())

    test('renders each entry and the join in that locale', () => {
      const de = loadSyntheticLocale('de', {
        'domain.sync.ambiguousListShare': '„{list}“ ({copies})',
      })
      expect(describeAmbiguousLists([BLUE, LONG, SHOP], de)).toBe(
        '„Blue Binder“ (1), „Long Box“ (2) und „Card Shop“ (3)',
      )
    })

    test('defaults to the UI locale, and an explicit English stays English', () => {
      withSyntheticLocale('de', { 'domain.sync.ambiguousListShare': '„{list}“ ({copies})' }, () => {
        expect(describeAmbiguousLists([BLUE, LONG])).toBe('„Blue Binder“ (1) und „Long Box“ (2)')
        expect(describeAmbiguousLists([BLUE, LONG], DEFAULT_LOCALE)).toBe(
          '"Blue Binder" (1) and "Long Box" (2)',
        )
      })
    })
  })
})

describe('collection change lines', () => {
  const SOL_RING = parts({ set: 'c21', collectorNumber: '240' })
  const FOIL_BOLT = parts({
    set: '2xm',
    collectorNumber: '117',
    finish: 'foil',
    condition: 'LP',
    language: 'ja',
  })
  const ADDED: CollectionSyncCardAdded = {
    kind: 'added',
    name: 'Sol Ring',
    quantity: 2,
    printing: SOL_RING,
  }
  const changes: CollectionSyncCardChange[] = [
    ADDED,
    { kind: 'removed', name: 'Lightning Bolt', quantity: 1, printing: FOIL_BOLT },
    { kind: 'removed', name: 'Island', quantity: 2, printing: SOL_RING },
    { kind: 'pending', name: 'Sol Ring', quantity: 3, printing: SOL_RING },
  ]

  test('a pull names the list; a push names Archidekt, a pending card the CSV file', () => {
    const pull = collectionChangePlace('pull', 'Blue Binder')
    const push = collectionChangePlace('push', 'Blue Binder')
    expect(english(describeCollectionCardChange(changes[0]!, pull))).toBe(
      '+ 2 Sol Ring (C21:240) to Blue Binder',
    )
    expect(english(describeCollectionCardChange(changes[1]!, push))).toBe(
      '- 1 Lightning Bolt (2XM:117) [foil] [LP] [ja] from Archidekt',
    )
    expect(english(describeCollectionCardChange(changes[3]!, push))).toBe(
      '+ 3 Sol Ring (C21:240) to the CSV file, not pushed yet',
    )
  })

  test('the count line totals copies across entries, pending only when there are any', () => {
    expect(english(describeCollectionChangesLine(collectionChangeCounts(changes)))).toBe(
      'Changes: +2 added, -3 removed, 3 copies pending',
    )
    expect(
      english(describeCollectionChangesLine(collectionChangeCounts(changes.slice(0, 3)))),
    ).toBe('Changes: +2 added, -3 removed')
  })

  test('a list lists its count, then the cards that did not go through the CSV', () => {
    const csv: CollectionSyncCardChange = { ...ADDED, via: 'csv' }
    expect(englishLines(collectionListLines([csv, changes[1]!, changes[3]!], 'Archidekt'))).toEqual(
      [
        { level: 'info', text: 'Changes: +2 added, -1 removed, 3 copies pending' },
        {
          level: 'detail',
          text: '- 1 Lightning Bolt (2XM:117) [foil] [LP] [ja] from Archidekt',
        },
      ],
    )
    expect(collectionListLines([], 'Archidekt')).toEqual([])
  })

  test('the run lists each CSV card once, then the unlisted removals', () => {
    const csv: CollectionSyncCardChange = { ...ADDED, via: 'csv' }
    expect(
      englishLines(
        collectionRunLines(
          [{ changes: [csv, changes[1]!] }, { changes: [csv] }, {}],
          [changes[2]!],
        ),
      ),
    ).toEqual([
      { level: 'detail', text: '+ 2 Sol Ring (C21:240) to Archidekt' },
      { level: 'detail', text: '- 2 Island (C21:240) from Archidekt' },
    ])
  })
})
