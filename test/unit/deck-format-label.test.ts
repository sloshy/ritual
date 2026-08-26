import { describe, test, expect } from 'bun:test'
import type { DeckData } from '../../src/list/deck'
import {
  getDeckCountLabel,
  getMainDeckSize,
  isMainDeckSection,
  parseDeckFormat,
  resolveDeckFormat,
} from '../../src/list/deck-format'

function makeDeck(partial: Partial<DeckData> = {}): DeckData {
  return {
    name: partial.name ?? 'Test Deck',
    format: partial.format,
    sections: partial.sections ?? [],
  }
}

const COMMANDER_SECTIONS: DeckData['sections'] = [
  { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
  { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
]

describe('parseDeckFormat', () => {
  test('accepts canonical keys regardless of case and padding', () => {
    expect(parseDeckFormat('modern')).toBe('modern')
    expect(parseDeckFormat('Standard')).toBe('standard')
    expect(parseDeckFormat(' VINTAGE ')).toBe('vintage')
  })

  test('normalizes separators to the canonical dashed key', () => {
    expect(parseDeckFormat('duel commander')).toBe('duel-commander')
    expect(parseDeckFormat('duel_commander')).toBe('duel-commander')
    expect(parseDeckFormat('Penny Dreadful')).toBe('penny-dreadful')
  })

  test('splits camelCase, as Moxfield format slugs use it', () => {
    expect(parseDeckFormat('duelCommander')).toBe('duel-commander')
    expect(parseDeckFormat('historicBrawl')).toBe('historic-brawl')
    expect(parseDeckFormat('pauperCommander')).toBe('pauper-commander')
  })

  test('resolves known aliases', () => {
    expect(parseDeckFormat('EDH')).toBe('commander')
    expect(parseDeckFormat('Commander / EDH')).toBe('commander')
    expect(parseDeckFormat('1v1 Commander')).toBe('duel-commander')
    expect(parseDeckFormat('penny')).toBe('penny-dreadful')
    expect(parseDeckFormat('premodern')).toBe('pre-modern')
    expect(parseDeckFormat('predh')).toBe('pre-dh')
    expect(parseDeckFormat('pdh')).toBe('pauper-commander')
    expect(parseDeckFormat('draft')).toBe('limited')
  })

  test('returns null for unmodelled formats and non-strings', () => {
    expect(parseDeckFormat('Custom')).toBeNull()
    expect(parseDeckFormat('Future Standard')).toBeNull()
    expect(parseDeckFormat('')).toBeNull()
    expect(parseDeckFormat('   ')).toBeNull()
    expect(parseDeckFormat(undefined)).toBeNull()
    expect(parseDeckFormat(7)).toBeNull()
  })
})

describe('resolveDeckFormat', () => {
  test('prefers the deck’s declared format', () => {
    expect(resolveDeckFormat(makeDeck({ format: 'modern' }))).toBe('modern')
  })

  test('falls back to the front matter value when the deck declares none', () => {
    expect(resolveDeckFormat(makeDeck(), 'duel commander')).toBe('duel-commander')
  })

  test('infers commander from a Commander section', () => {
    expect(resolveDeckFormat(makeDeck({ sections: COMMANDER_SECTIONS }))).toBe('commander')
  })

  test('infers oathbreaker from an Oathbreaker or Signature Spell section', () => {
    const deck = makeDeck({
      sections: [
        { name: 'Oathbreaker', cards: [{ quantity: 1, name: 'Teferi' }] },
        { name: 'Signature Spell', cards: [{ quantity: 1, name: 'Lightning Bolt' }] },
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
      ],
    })
    expect(resolveDeckFormat(deck)).toBe('oathbreaker')
  })

  test('a declared format beats the section heuristic', () => {
    const deck = makeDeck({ format: 'standard', sections: COMMANDER_SECTIONS })
    expect(resolveDeckFormat(deck)).toBe('standard')
  })

  test('an unparseable front matter value falls through to the heuristic', () => {
    expect(resolveDeckFormat(makeDeck({ sections: COMMANDER_SECTIONS }), 'cube')).toBe('commander')
  })

  test('returns null when nothing declares or implies a format', () => {
    const deck = makeDeck({
      sections: [{ name: 'Main', cards: [{ quantity: 4, name: 'Lightning Bolt' }] }],
    })
    expect(resolveDeckFormat(deck)).toBeNull()
  })
})

describe('getMainDeckSize', () => {
  test('sums quantities in main, commander, and signature/oathbreaker sections', () => {
    const size = getMainDeckSize([
      { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
      {
        name: 'Main',
        cards: [
          { quantity: 4, name: 'Lightning Bolt' },
          { quantity: 4, name: 'Counterspell' },
        ],
      },
      { name: 'Sideboard', cards: [{ quantity: 15, name: 'Wear // Tear' }] },
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Ponder' }] },
      { name: 'Tokens', cards: [{ quantity: 1, name: 'Treasure Token' }] },
    ])
    expect(size).toBe(9)
  })

  test('returns 0 for empty deck', () => {
    expect(getMainDeckSize([])).toBe(0)
  })
})

describe('isMainDeckSection', () => {
  test('includes Main, Commander, Oathbreaker, Signature Spell, and custom sections', () => {
    expect(isMainDeckSection('Main')).toBe(true)
    expect(isMainDeckSection('Commander')).toBe(true)
    expect(isMainDeckSection('Oathbreaker')).toBe(true)
    expect(isMainDeckSection('Signature Spell')).toBe(true)
    expect(isMainDeckSection('Creatures')).toBe(true)
  })

  test('excludes Sideboard, Maybeboard, Tokens', () => {
    expect(isMainDeckSection('Sideboard')).toBe(false)
    expect(isMainDeckSection('Maybeboard')).toBe(false)
    expect(isMainDeckSection('Tokens')).toBe(false)
    expect(isMainDeckSection('tokens & emblems')).toBe(false)
  })
})

describe('getDeckCountLabel', () => {
  test('returns just the format label when count matches expected size', () => {
    expect(getDeckCountLabel('commander', 100)).toEqual({ primary: 'Commander' })
    expect(getDeckCountLabel('oathbreaker', 60)).toEqual({ primary: 'Oathbreaker' })
    expect(getDeckCountLabel('modern', 60)).toEqual({ primary: 'Modern' })
    expect(getDeckCountLabel('limited', 40)).toEqual({ primary: 'Limited' })
  })

  test('returns format label plus parenthetical suffix when count is unusual', () => {
    expect(getDeckCountLabel('commander', 99)).toEqual({
      primary: 'Commander',
      suffix: '(99 cards)',
    })
    expect(getDeckCountLabel('modern', 62)).toEqual({
      primary: 'Modern',
      suffix: '(62 cards)',
    })
    expect(getDeckCountLabel('legacy', 1)).toEqual({
      primary: 'Legacy',
      suffix: '(1 card)',
    })
  })

  test('falls back to plain card count when format is null', () => {
    expect(getDeckCountLabel(null, 42)).toEqual({ primary: '42 cards' })
    expect(getDeckCountLabel(null, 1)).toEqual({ primary: '1 card' })
    expect(getDeckCountLabel(null, 0)).toEqual({ primary: '0 cards' })
  })
})
