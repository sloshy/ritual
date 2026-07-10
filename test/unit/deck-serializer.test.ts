import { describe, test, expect } from 'bun:test'
import { serializeDeckToMarkdown } from '../../src/deck-file'
import { parseDeckText } from '../../src/importers/text-file'
import type { DeckData } from '../../src/types'

describe('serializeDeckToMarkdown', () => {
  test('serializes deck with frontmatter and sections', () => {
    const deck: DeckData = {
      name: 'Test Deck',
      sections: [
        { name: 'Commander', cards: [{ quantity: 1, name: 'Kenrith, the Returned King' }] },
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring' },
            { quantity: 1, name: 'Mana Crypt', set: '2XM', collectorNumber: '1', finish: 'foil' },
          ],
        },
      ],
    }
    const frontMatter = { name: 'Test Deck', description: 'A test' }
    const result = serializeDeckToMarkdown(deck, frontMatter)

    expect(result).toMatch(/^---\n/)
    expect(result).toMatch(/\n---\n/)
    expect(result).toContain('name: Test Deck')
    expect(result).toContain('description: A test')
    expect(result).toContain('## Commander')
    expect(result).toContain('1 Kenrith, the Returned King')
    expect(result).toContain('## Main')
    expect(result).toContain('1 Sol Ring')
    expect(result).toContain('1 Mana Crypt (2XM:1) [foil]')
  })
})

describe('round-trip: parse → serialize → parse', () => {
  test('deck with card IDs round-trips correctly', () => {
    const original = [
      '---',
      'name: Round Trip Deck',
      'description: Testing round trip',
      '---',
      '',
      '## Commander',
      '1 Kenrith, the Returned King &1',
      '',
      '## Main',
      '1 Sol Ring &2',
      '1 Mana Crypt (2XM:1) [foil] &3',
      '3 Island (SLD:63) [LP] &4',
      '',
    ].join('\n')

    const deck1 = parseDeckText(original, 'Fallback')

    const serialized = serializeDeckToMarkdown(deck1, {
      name: deck1.name,
      description: deck1.description,
    })

    const deck2 = parseDeckText(serialized, 'Fallback')

    expect(deck2.name).toBe(deck1.name)
    expect(deck2.description).toBe(deck1.description)
    expect(deck2.sections).toHaveLength(deck1.sections.length)

    for (let i = 0; i < deck1.sections.length; i++) {
      const s1 = deck1.sections[i]!
      const s2 = deck2.sections[i]!
      expect(s2.name).toBe(s1.name)
      expect(s2.cards).toHaveLength(s1.cards.length)

      for (let j = 0; j < s1.cards.length; j++) {
        const c1 = s1.cards[j]!
        const c2 = s2.cards[j]!
        expect(c2.quantity).toBe(c1.quantity)
        expect(c2.name).toBe(c1.name)
        expect(c2.set).toBe(c1.set)
        expect(c2.collectorNumber).toBe(c1.collectorNumber)
        expect(c2.cardId).toBe(c1.cardId)
        // finish: serializer omits 'nonfoil', so both should be consistent
        if (c1.finish && c1.finish !== 'nonfoil') {
          expect(c2.finish).toBe(c1.finish)
        }
        // condition: serializer omits 'NM', so both should be consistent
        if (c1.condition && c1.condition !== 'NM') {
          expect(c2.condition).toBe(c1.condition)
        }
      }
    }
  })
})

describe('serializeDeckToMarkdown assigns missing card IDs', () => {
  test('preserves existing IDs and reuses gaps for new cards', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', cardId: 1 },
            { quantity: 1, name: 'Lightning Bolt' }, // no ID → reuses gap 2
            { quantity: 1, name: 'Mana Crypt', cardId: 3 },
          ],
        },
      ],
    }
    const result = serializeDeckToMarkdown(deck, { name: 'Test' })
    expect(result).toContain('1 Sol Ring &1')
    expect(result).toContain('1 Lightning Bolt &2')
    expect(result).toContain('1 Mana Crypt &3')
  })

  test('no card line is ever written without an &N id', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring' },
            { quantity: 2, name: 'Island', set: 'sld', collectorNumber: '63' },
          ],
        },
      ],
    }
    const result = serializeDeckToMarkdown(deck, { name: 'Test' })
    const cardLines = result.split('\n').filter((l) => /^\d+ /.test(l.trim()))
    expect(cardLines.length).toBe(3)
    for (const line of cardLines) {
      expect(line.trim()).toMatch(/ &\d+$/)
    }
  })
})
