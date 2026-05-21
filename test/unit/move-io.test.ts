import { describe, test, expect } from 'bun:test'
import { applyAddToStaged, type StagedFile } from '../../src/commands/move-io'
import type { PhysicalCard } from '../../src/commands/move-helpers'
import type { DeckData } from '../../src/types'

function deckStaged(deck: DeckData): StagedFile {
  return { kind: 'deck', data: { deck, frontMatter: {} } }
}

function physicalCard(name: string, extra?: Partial<PhysicalCard>): PhysicalCard {
  return {
    key: name,
    name,
    listEntry: { ref: { type: 'deck', name: 'Test' }, filePath: 'Test.md' },
    ...extra,
  }
}

describe('applyAddToStaged (deck) ID allocation', () => {
  test('reuses the smallest released ID gap instead of taking the next-highest', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', cardId: 1 },
            { quantity: 1, name: 'Mana Crypt', cardId: 3 }, // gap at 2
          ],
        },
      ],
    }
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck')
    expect(deck.sections[0]!.cards.find((c) => c.name === 'Lightning Bolt')!.cardId).toBe(2)

    // The deck now holds [1, 2, 3]; the next add falls through to 4.
    applyAddToStaged(staged, physicalCard('Counterspell'), 'deck')
    expect(deck.sections[0]!.cards.find((c) => c.name === 'Counterspell')!.cardId).toBe(4)
  })

  test('merges into an identical existing line without allocating a new ID', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        {
          name: 'Main',
          cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167', cardId: 1 }],
        },
      ],
    }
    const staged = deckStaged(deck)

    applyAddToStaged(
      staged,
      physicalCard('Sol Ring', { set: 'c21', collectorNumber: '167' }),
      'deck',
    )

    const main = deck.sections[0]!.cards
    expect(main).toHaveLength(1)
    expect(main[0]!.quantity).toBe(2)
    expect(main[0]!.cardId).toBe(1)
  })
})
