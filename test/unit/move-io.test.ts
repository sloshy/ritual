import { describe, test, expect } from 'bun:test'
import {
  applyAddToStaged,
  applyRemoveFromStaged,
  type StagedFile,
} from '../../src/commands/move-io'
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

describe('applyRemoveFromStaged (text) line matching', () => {
  test('a card ID is authoritative: an ID miss never falls back to the name match', () => {
    // Two lines share name/set/collector and differ only in finish. Removing
    // the foil copy (&2) must not touch the nonfoil line (&1).
    const staged: StagedFile = {
      kind: 'text',
      content: '# finishes\n\n## Main\n- Sol Ring (C19:221) &1\n- Sol Ring (C19:221) [foil] &2\n',
    }
    const removed = applyRemoveFromStaged(
      staged,
      physicalCard('Sol Ring', {
        set: 'c19',
        collectorNumber: '221',
        finish: 'foil',
        cardId: 2,
      }),
    )
    expect(removed).toBe(true)
    expect(staged).toEqual({
      kind: 'text',
      content: '# finishes\n\n## Main\n- Sol Ring (C19:221) &1\n',
    })
  })

  test('a card ID present in the source but missing from the file removes nothing', () => {
    const staged: StagedFile = {
      kind: 'text',
      content: '# binder\n\n## Main\n- Sol Ring (C19:221) &1\n',
    }
    const removed = applyRemoveFromStaged(
      staged,
      physicalCard('Sol Ring', { set: 'c19', collectorNumber: '221', cardId: 9 }),
    )
    expect(removed).toBe(false)
    expect(staged.kind === 'text' && staged.content).toContain('- Sol Ring (C19:221) &1')
  })

  test('without an ID, the name match narrows by set and collector number', () => {
    const staged: StagedFile = {
      kind: 'text',
      content: '# binder\n\n## Main\n- Sol Ring (C19:221)\n- Sol Ring (LEA:270)\n',
    }
    const removed = applyRemoveFromStaged(
      staged,
      physicalCard('Sol Ring', { set: 'lea', collectorNumber: '270' }),
    )
    expect(removed).toBe(true)
    expect(staged.kind === 'text' && staged.content).toContain('- Sol Ring (C19:221)')
    expect(staged.kind === 'text' && staged.content).not.toContain('- Sol Ring (LEA:270)')
  })
})

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

describe('applyAddToStaged (deck) section targeting', () => {
  function twoSectionDeck(): DeckData {
    return {
      name: 'Test',
      sections: [
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] },
        { name: 'Sideboard', cards: [{ quantity: 1, name: 'Duress', cardId: 2 }] },
      ],
    }
  }

  test('adds to the exactly-named section when it exists', () => {
    const deck = twoSectionDeck()
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck', 'Sideboard')

    const sideboard = deck.sections.find((s) => s.name === 'Sideboard')!
    expect(sideboard.cards.map((c) => c.name)).toContain('Lightning Bolt')
    expect(deck.sections.find((s) => s.name === 'Main')!.cards).toHaveLength(1)
  })

  test('section matching is exact — a case-different name creates a new section', () => {
    const deck = twoSectionDeck()
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck', 'sideboard')

    expect(deck.sections.map((s) => s.name)).toEqual(['Main', 'Sideboard', 'sideboard'])
    expect(deck.sections.find((s) => s.name === 'sideboard')!.cards[0]!.name).toBe('Lightning Bolt')
  })

  test('creates the section when missing', () => {
    const deck = twoSectionDeck()
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck', 'Maybeboard')

    const created = deck.sections.find((s) => s.name === 'Maybeboard')
    expect(created).toBeDefined()
    expect(created!.cards.map((c) => c.name)).toEqual(['Lightning Bolt'])
  })

  test('merges quantity within the targeted section only', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }] },
        { name: 'Sideboard', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 2 }] },
      ],
    }
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Sol Ring'), 'deck', 'Sideboard')

    expect(deck.sections.find((s) => s.name === 'Main')!.cards[0]!.quantity).toBe(1)
    expect(deck.sections.find((s) => s.name === 'Sideboard')!.cards[0]!.quantity).toBe(2)
  })

  test('without a section, the default behavior is unchanged', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa, Praetors’ Voice', cardId: 1 }] },
        { name: 'Spells', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 2 }] },
      ],
    }
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck')

    // First non-commander/sideboard section receives the card.
    expect(deck.sections.find((s) => s.name === 'Spells')!.cards.map((c) => c.name)).toContain(
      'Lightning Bolt',
    )
  })

  test('without a section and no eligible section, Main is created', () => {
    const deck: DeckData = { name: 'Test', sections: [] }
    const staged = deckStaged(deck)

    applyAddToStaged(staged, physicalCard('Lightning Bolt'), 'deck')

    expect(deck.sections.map((s) => s.name)).toEqual(['Main'])
  })
})

describe('applyAddToStaged (deck) dropped-note reporting', () => {
  function deckWithLine(note?: string): DeckData {
    return {
      name: 'Test',
      sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', note, cardId: 1 }] }],
    }
  }

  test('reports the incoming note when a merge discards it', () => {
    const staged = deckStaged(deckWithLine('keep me'))

    const dropped = applyAddToStaged(
      staged,
      physicalCard('Sol Ring', { note: 'incoming note', cardId: 7 }),
      'deck',
    )

    expect(dropped).toEqual({ cardName: 'Sol Ring', cardId: 7, note: 'incoming note' })
    // The destination line's existing note wins; nothing is merged into it.
    expect(staged.kind === 'deck' && staged.data.deck.sections[0]!.cards[0]!.note).toBe('keep me')
  })

  test('reports nothing when the incoming card has no note', () => {
    const staged = deckStaged(deckWithLine('existing'))

    const dropped = applyAddToStaged(staged, physicalCard('Sol Ring'), 'deck')

    expect(dropped).toBeUndefined()
  })

  test('reports nothing when the incoming note matches the existing line note', () => {
    const staged = deckStaged(deckWithLine('same note'))

    const dropped = applyAddToStaged(
      staged,
      physicalCard('Sol Ring', { note: 'same note' }),
      'deck',
    )

    expect(dropped).toBeUndefined()
  })

  test('reports nothing when the card appends a new line (note travels with it)', () => {
    const staged = deckStaged(deckWithLine())

    const dropped = applyAddToStaged(
      staged,
      physicalCard('Lightning Bolt', { note: 'travels' }),
      'deck',
    )

    expect(dropped).toBeUndefined()
    const deck = staged.kind === 'deck' ? staged.data.deck : null
    expect(deck!.sections[0]!.cards.find((c) => c.name === 'Lightning Bolt')!.note).toBe('travels')
  })
})
