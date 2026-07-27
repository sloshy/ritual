import { describe, expect, test } from 'bun:test'
import {
  describeAmbiguousRemoval,
  describeCollectionKey,
  type CollectionKeyParts,
} from '../../../src/collection-sync/describe'

/**
 * The sentences a collection sync produces twice — once by the engine as it
 * streams, once by the admin page replaying a finished report. Pinned here so
 * both sides keep saying the same thing.
 */

function parts(overrides: Partial<CollectionKeyParts> = {}): CollectionKeyParts {
  return { set: 'clb', collectorNumber: '507', finish: 'nonfoil', condition: 'NM', ...overrides }
}

describe('describeCollectionKey', () => {
  test('uppercases the set code and omits the default finish and condition', () => {
    expect(describeCollectionKey('Sol Ring', parts({ set: 'ltc', collectorNumber: '284' }))).toBe(
      'Sol Ring (LTC:284)',
    )
  })

  test('names a non-default finish and condition, in that order', () => {
    expect(
      describeCollectionKey(
        'Karlach, Fury of Avernus',
        parts({ finish: 'etched', condition: 'LP' }),
      ),
    ).toBe('Karlach, Fury of Avernus (CLB:507) [etched] [LP]')
  })
})

describe('describeAmbiguousRemoval', () => {
  test('says "ambiguous", and names every list with the copies it holds', () => {
    expect(
      describeAmbiguousRemoval({
        key: 'lea|161|nonfoil|NM',
        parts: parts({ set: 'lea', collectorNumber: '161' }),
        name: 'Lightning Bolt',
        quantity: 2,
        lists: [
          { list: 'Blue Binder', copies: 1 },
          { list: 'Long Box', copies: 2 },
        ],
      }),
    ).toBe(
      'Not removing 2 × Lightning Bolt (LEA:161): ambiguous — copies live in "Blue Binder" (1) and "Long Box" (2).',
    )
  })

  test('joins three or more lists with commas and a final "and"', () => {
    expect(
      describeAmbiguousRemoval({
        key: 'ltc|284|nonfoil|NM',
        parts: parts({ set: 'ltc', collectorNumber: '284' }),
        name: 'Sol Ring',
        quantity: 1,
        lists: [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 2 },
          { list: 'card-shop', copies: 1 },
        ],
      }),
    ).toBe(
      'Not removing 1 × Sol Ring (LTC:284): ambiguous — copies live in "blue-binder" (1), "long-box" (2) and "card-shop" (1).',
    )
  })
})
