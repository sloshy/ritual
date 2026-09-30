import { describe, expect, test } from 'bun:test'
import {
  importCategoryAdvisories,
  moxfieldDeckCategories,
} from '../../../src/importers/import-categories'
import type { DeckSection } from '../../../src/list/deck'

const SECTIONS: DeckSection[] = [
  { name: 'Commander', cards: [{ quantity: 1, name: 'Winota, Joiner of Forces' }] },
  {
    name: 'Main',
    cards: [
      { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263' },
      { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' },
      { quantity: 1, name: 'Swords to Plowshares' },
    ],
  },
]

describe('moxfieldDeckCategories', () => {
  test('maps each held card’s tags in the author’s order, once per card name', () => {
    expect(
      moxfieldDeckCategories(
        {
          'Sol Ring': ['Ramp', 'Mana Rock', 'ramp'],
          'Swords to Plowshares': ['Removal'],
        },
        SECTIONS,
      ),
    ).toEqual({
      cards: [
        { name: 'Sol Ring', categories: ['Ramp', 'Mana Rock'] },
        { name: 'Swords to Plowshares', categories: ['Removal'] },
      ],
      refused: [],
    })
  })

  test('drops tags for cards the deck does not hold, and reports names Ritual refuses', () => {
    expect(
      moxfieldDeckCategories(
        { 'Black Lotus': ['Ramp'], 'sol ring': ['Ra\u0001mp', 'Ramp'] },
        SECTIONS,
      ),
    ).toEqual({ cards: [{ name: 'Sol Ring', categories: ['Ramp'] }], refused: ['Ra\u0001mp'] })
  })

  test('a deck with no tags maps to no categories', () => {
    expect(moxfieldDeckCategories(undefined, SECTIONS)).toEqual({ cards: [], refused: [] })
  })
})

describe('importCategoryAdvisories', () => {
  test('names the refused categories and a failed write; nothing when there is neither', () => {
    expect(importCategoryAdvisories(undefined, undefined)).toEqual([])
    expect(importCategoryAdvisories([], undefined)).toEqual([])
    const [refused, failed] = importCategoryAdvisories(['a,b'], 'EACCES')
    expect(refused).toContain('"a,b"')
    expect(failed).toContain('EACCES')
  })
})
