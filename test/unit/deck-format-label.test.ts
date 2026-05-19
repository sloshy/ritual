import { describe, test, expect } from 'bun:test'
import type { DeckData } from '../../src/types'
import {
  detectDeckFormat,
  getDeckCountLabel,
  getMainDeckSize,
  isMainDeckSection,
} from '../../src/deck-format'

function makeDeck(partial: Partial<DeckData> = {}): DeckData {
  return {
    name: partial.name ?? 'Test Deck',
    format: partial.format,
    sections: partial.sections ?? [],
  }
}

describe('detectDeckFormat', () => {
  test('reads format from frontmatter', () => {
    expect(detectDeckFormat(makeDeck({ format: 'modern' }))).toBe('modern')
    expect(detectDeckFormat(makeDeck({ format: 'Standard' }))).toBe('standard')
    expect(detectDeckFormat(makeDeck({ format: ' VINTAGE ' }))).toBe('vintage')
  })

  test('normalizes spaces and underscores in frontmatter', () => {
    expect(detectDeckFormat(makeDeck({ format: 'duel commander' }))).toBe('duel-commander')
    expect(detectDeckFormat(makeDeck({ format: 'duel_commander' }))).toBe('duel-commander')
    expect(detectDeckFormat(makeDeck({ format: 'pre-modern' }))).toBe('pre-modern')
  })

  test('falls back to commander when a Commander section exists', () => {
    const deck = makeDeck({
      sections: [
        { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
      ],
    })
    expect(detectDeckFormat(deck)).toBe('commander')
  })

  test('detects oathbreaker via section name', () => {
    const deck = makeDeck({
      sections: [
        { name: 'Oathbreaker', cards: [{ quantity: 1, name: 'Teferi' }] },
        { name: 'Signature Spell', cards: [{ quantity: 1, name: 'Lightning Bolt' }] },
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
      ],
    })
    expect(detectDeckFormat(deck)).toBe('oathbreaker')
  })

  test('frontmatter overrides section heuristics', () => {
    // A "Commander" section is still considered a Commander deck via heuristic,
    // but an explicit `format` in frontmatter wins.
    const deck = makeDeck({
      format: 'standard',
      sections: [{ name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] }],
    })
    expect(detectDeckFormat(deck)).toBe('standard')
  })

  test('returns null when no signal is present', () => {
    const deck = makeDeck({
      sections: [{ name: 'Main', cards: [{ quantity: 4, name: 'Lightning Bolt' }] }],
    })
    expect(detectDeckFormat(deck)).toBeNull()
  })

  test('unknown format string falls through to section heuristics', () => {
    const deck = makeDeck({
      format: 'unknown-format',
      sections: [{ name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] }],
    })
    expect(detectDeckFormat(deck)).toBe('commander')
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
