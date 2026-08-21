import { describe, expect, test } from 'bun:test'
import {
  findDeckCard,
  findDeckCardLabels,
  findDeckCardLanguage,
  findDeckFinish,
} from '../../src/editor/deck-config'
import type { DeckData } from '../../src/types'

/**
 * A deck holding the same card twice — one copy pinned and foil, one name-only
 * line — which is what makes resolving by name alone answer for the wrong copy.
 */
function makeDeck(): DeckData {
  return {
    name: 'Test Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          {
            quantity: 1,
            name: 'Sol Ring',
            set: 'c19',
            collectorNumber: '221',
            finish: 'foil',
            cardId: 1,
          },
          { quantity: 1, name: 'Sol Ring', cardId: 2 },
        ],
      },
      {
        name: 'Sideboard',
        cards: [{ quantity: 1, name: 'Shock', cardId: 3, labels: ['proxy'], language: 'ja' }],
      },
    ],
  }
}

describe('findDeckCard', () => {
  test('the id match wins outright over the first same-name card', () => {
    // Identity first: an outright miss would also satisfy a `set` assertion.
    expect(findDeckCard(makeDeck(), 'Sol Ring', 2)?.cardId).toBe(2)
    expect(findDeckCard(makeDeck(), 'Sol Ring', 2)?.set).toBeUndefined()
    expect(findDeckCard(makeDeck(), 'Sol Ring', 1)?.set).toBe('c19')
  })

  test('an id naming a different card does not answer for it', () => {
    // Shock is &3; a recycled id must not make it answer a Sol Ring lookup.
    expect(findDeckCard(makeDeck(), 'Sol Ring', 3)?.cardId).toBe(1)
    expect(findDeckCard(makeDeck(), 'Shock', 1)?.cardId).toBe(3)
  })

  test('searches every section, not just the first', () => {
    expect(findDeckCard(makeDeck(), 'Shock')?.cardId).toBe(3)
  })

  test('falls back to the name when the id matches nothing', () => {
    expect(findDeckCard(makeDeck(), 'Sol Ring', 99)?.cardId).toBe(1)
  })
})

describe('findDeckCardLanguage / findDeckCardLabels', () => {
  test('resolve through the same rule, so a recycled id cannot answer', () => {
    // Both used to accept an id match on its own. &3 is Shock, and it is the
    // only card carrying a language or a label — so a Sol Ring lookup that
    // returned Shock's would be visible here.
    expect(findDeckCardLanguage(makeDeck(), 'Shock', 3)).toBe('ja')
    expect(findDeckCardLabels(makeDeck(), 'Shock', 3)).toEqual(['proxy'])
    expect(findDeckCardLanguage(makeDeck(), 'Sol Ring', 3)).toBeUndefined()
    expect(findDeckCardLabels(makeDeck(), 'Sol Ring', 3)).toBeUndefined()
  })
})

describe('findDeckFinish', () => {
  test('answers for the targeted copy, not the first line of that name', () => {
    // Without the id, the foil copy at the front of the list would answer for
    // the name-only line behind it — and a foil answer makes the menu offer
    // "Set as Nonfoil" on a card that is not foil.
    expect(findDeckFinish(makeDeck(), 'Sol Ring', 1)).toBe('foil')
    expect(findDeckFinish(makeDeck(), 'Sol Ring', 2)).toBe('nonfoil')
  })

  test('a line with no finish token reads as nonfoil', () => {
    expect(findDeckFinish(makeDeck(), 'Shock', 3)).toBe('nonfoil')
  })

  test('an unknown card reads as nonfoil', () => {
    expect(findDeckFinish(makeDeck(), 'Brainstorm')).toBe('nonfoil')
  })
})
