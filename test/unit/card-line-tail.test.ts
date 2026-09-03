import { describe, expect, test } from 'bun:test'
import {
  formatCanonicalCardLine,
  formatTokenTail,
  printingLabel,
  type CardLineFields,
  type DeckCardLineFields,
} from '../../src/card/card-line-tail'
import { parseCardLine, type LineTokens } from '../../src/card/card-line-grammar'
import type { ListType } from '../../src/list/list-type'

/**
 * The write half of the card-line grammar. Paired with
 * `card-line-grammar.test.ts`: what this module writes, that one must read back
 * unchanged, which is the round-trip block at the bottom.
 */

describe('printingLabel', () => {
  test('uppercases the set and leaves the collector number alone', () => {
    expect(printingLabel('mkm', '507a')).toBe('MKM:507a')
    expect(printingLabel('MKM', '507a')).toBe('MKM:507a')
    expect(printingLabel('plst_x', '★12')).toBe('PLST_X:★12')
  })
})

describe('formatTokenTail', () => {
  test('writes every token in canonical order', () => {
    expect(
      formatTokenTail({
        printing: { set: 'ltc', collectorNumber: '284' },
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
        labels: ['sale', 'trade'],
        tags: ['zebra', 'Apple'],
        note: 'shelf 2',
        cardId: 12,
      }),
    ).toBe(' (LTC:284) [foil] [LP] [ja] [sale,trade] #Apple, zebra {shelf 2} &12')
  })

  test('writes tags before the note, canonicalized, and none for an empty set', () => {
    expect(formatTokenTail({ tags: ['b', 'a', ' a '], note: 'n' })).toBe(' #a, b {n}')
    expect(formatTokenTail({ tags: [] })).toBe('')
  })

  test('omits every token at its default', () => {
    expect(
      formatTokenTail({ finish: 'nonfoil', condition: 'NM', language: 'en', labels: [] }),
    ).toBe('')
    expect(formatTokenTail({})).toBe('')
  })

  test("omits a cleared condition, the changelog's NONE", () => {
    expect(formatTokenTail({ condition: 'NONE' })).toBe('')
  })

  test('re-normalizes label order', () => {
    expect(formatTokenTail({ labels: ['trade', 'sale'] })).toBe(' [sale,trade]')
  })

  test('a zero card id is still written', () => {
    expect(formatTokenTail({ cardId: 0 })).toBe(' &0')
  })
})

describe('formatCanonicalCardLine', () => {
  const fields: DeckCardLineFields = {
    quantity: 2,
    name: 'Sol Ring',
    printing: { set: 'c21', collectorNumber: '263' },
    cardId: 4,
  }

  test('a deck line is bulleted and leads with its quantity', () => {
    expect(formatCanonicalCardLine('deck', fields)).toBe('- 2 Sol Ring (C21:263) &4')
  })

  test('a deck line with no quantity means one copy', () => {
    expect(formatCanonicalCardLine('deck', { name: 'Sol Ring' })).toBe('- 1 Sol Ring')
  })

  test('flat lines are one bullet per copy and carry no quantity', () => {
    // The overloads refuse a `quantity` here at compile time — copies on a flat
    // list are expanded into that many lines, never folded onto one.
    const flat: CardLineFields = {
      name: 'Sol Ring',
      printing: { set: 'c21', collectorNumber: '263' },
      cardId: 4,
    }
    expect(formatCanonicalCardLine('collection', flat)).toBe('- Sol Ring (C21:263) &4')
    expect(formatCanonicalCardLine('wanted', flat)).toBe('- Sol Ring (C21:263) &4')
  })
})

describe('round trip', () => {
  // Typed as `LineTokens`, the parser's own output shape, so the round trip is
  // an identity assertion rather than a structural coincidence.
  const cases: readonly [ListType, LineTokens][] = [
    ['deck', { quantity: 3, name: 'Lightning Bolt' }],
    [
      'deck',
      {
        quantity: 1,
        name: 'Sol Ring',
        printing: { set: '2xm', collectorNumber: '157' },
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
        labels: ['proxy'],
        note: 'from the cube',
        cardId: 9,
      },
    ],
    [
      'collection',
      {
        quantity: 1,
        name: 'Circle of Protection: Art',
        printing: { set: 'lea', collectorNumber: '161' },
        labels: ['sale', 'trade'],
        cardId: 2,
      },
    ],
    [
      'collection',
      { quantity: 1, name: 'Dandân', printing: { set: 'arn', collectorNumber: '20' } },
    ],
    [
      'collection',
      {
        quantity: 1,
        name: 'Sol Ring',
        printing: { set: 'ltc', collectorNumber: '284' },
        condition: 'HP',
        note: 'see #4 and &5',
        cardId: 8,
      },
    ],
    ['wanted', { quantity: 1, name: 'Bebop & Rocksteady', cardId: 11 }],
    [
      'collection',
      {
        quantity: 1,
        name: 'Sol Ring',
        printing: { set: 'ltc', collectorNumber: '284' },
        labels: ['keep'],
        tags: ['binder/trade', 'Card Draw'],
        note: 'needs #upgrade',
        cardId: 3,
      },
    ],
    ['wanted', { quantity: 1, name: 'Arcane Signet', tags: ['ramp'], cardId: 4 }],
    [
      'wanted',
      {
        quantity: 1,
        name: "Lim-Dûl's Vault",
        printing: { set: 'plst_x', collectorNumber: '507a' },
        finish: 'etched',
        note: 'note with } brace',
        cardId: 1,
      },
    ],
  ]

  for (const [type, fields] of cases) {
    test(`${type}: ${fields.name}`, () => {
      // A flat list takes no quantity at all — `FlatCardLineFields` types it
      // `never`, so the copies have to be destructured off rather than dropped.
      const { quantity, ...flat } = fields
      const line =
        type === 'deck'
          ? formatCanonicalCardLine('deck', fields)
          : formatCanonicalCardLine(type, flat)
      // Every flat fixture is a single copy: a flat list cannot express more on
      // one line, so a fixture that tried would be testing a form the writer
      // has no way to produce.
      if (type !== 'deck') expect(quantity).toBe(1)
      const result = parseCardLine(type, line)
      expect(result.ok && result.advisories).toEqual([])
      expect(result.ok && result.tokens).toEqual(fields)
    })
  }
})
