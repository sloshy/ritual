import { describe, test, expect } from 'bun:test'
import matter from 'gray-matter'
import {
  newDeckFrontMatter,
  serializeDeckToMarkdown,
  validateDeckFrontMatter,
} from '../../src/list/deck-file'
import { parseDeckText } from '../../src/importers/text-file'
import type { DeckData } from '../../src/list/deck'

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
    const frontMatter = { description: 'A test' }
    const result = serializeDeckToMarkdown(deck, frontMatter)

    expect(result).toMatch(/^---\n/)
    expect(result).toMatch(/\n---\n\n# Test Deck\n\n## Commander\n/)
    expect(result).toContain('description: A test')
    expect(result).toContain('## Commander')
    expect(result).toContain('1 Kenrith, the Returned King')
    expect(result).toContain('## Main')
    expect(result).toContain('1 Sol Ring')
    expect(result).toContain('1 Mana Crypt (2XM:1) [foil]')
  })
})

describe('serializeDeckToMarkdown: empty sections', () => {
  const withEmptyExtras = (extras: string): DeckData => ({
    name: 'Test Deck',
    sections: [
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
      { name: extras, cards: [] },
    ],
  })

  // A sync that removes the last card the remote held in the maybeboard would
  // otherwise leave a bare `## Maybeboard` behind — which the parser then reads
  // as content a rewrite would delete, blocking every later whole-file save.
  test.each(['Maybeboard', 'Tokens'])('drops an empty %s section', (name) => {
    const result = serializeDeckToMarkdown(withEmptyExtras(name), { name: 'Test Deck' })
    expect(result).not.toContain(`## ${name}`)
    expect(result).toContain('## Main')
  })

  test('keeps an extras section that still holds cards', () => {
    const deck = withEmptyExtras('Maybeboard')
    deck.sections[1]!.cards.push({ quantity: 1, name: 'Cavern-Hoard Dragon' })
    expect(serializeDeckToMarkdown(deck, { name: 'Test Deck' })).toContain('## Maybeboard')
  })

  test('a deck of nothing but empty extras serializes to a body with no sections', () => {
    // Newly reachable shape: with the only section dropped there is no header
    // left to write, which must be a well-formed file rather than a stray run of
    // blank lines or a throw.
    const result = serializeDeckToMarkdown(
      { name: 'Test Deck', sections: [{ name: 'Maybeboard', cards: [] }] },
      { name: 'Test Deck' },
    )
    expect(result).not.toContain('##')
    expect(parseDeckText(result, 'Fallback').deck.sections).toEqual([])
  })

  test('keeps an empty non-extras section', () => {
    // `## Main` and nothing else is exactly what a freshly created deck is.
    const deck: DeckData = {
      name: 'Test Deck',
      sections: [
        { name: 'Main', cards: [] },
        { name: 'Sideboard', cards: [] },
      ],
    }
    const result = serializeDeckToMarkdown(deck, { name: 'Test Deck' })
    expect(result).toContain('## Main')
    expect(result).toContain('## Sideboard')
  })
})

describe('serializeDeckToMarkdown: canonical format', () => {
  const commanderDeck: DeckData = {
    name: 'Test Deck',
    sections: [
      { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
      { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
    ],
  }

  test('writes a format that was only inferred from the sections', () => {
    // The site infers "Commander" from the section; saving makes that explicit so
    // every other reader (the editors, the CLI menu) agrees without re-inferring.
    const result = serializeDeckToMarkdown(commanderDeck, { name: 'Test Deck' })
    expect(result).toContain('format: commander')
    expect(parseDeckText(result, 'Fallback').deck.format).toBe('commander')
  })

  // The admin deck-save handler passes the front matter straight from the request
  // body, so raw, unvalidated values do reach the serializer.
  test('rewrites a declared format into its canonical key', () => {
    const untrusted: Record<string, unknown> = { name: 'Test Deck', format: 'Duel Commander' }
    const result = serializeDeckToMarkdown({ name: 'Test Deck', sections: [] }, untrusted)
    expect(result).toContain('format: duel-commander')
  })

  test('drops an unparseable format rather than persisting it', () => {
    const untrusted: Record<string, unknown> = { name: 'Test Deck', format: 'cube' }
    const deck: DeckData = { name: 'Test Deck', sections: [{ name: 'Main', cards: [] }] }
    expect(serializeDeckToMarkdown(deck, untrusted)).not.toContain('format:')
  })

  test('omits front matter keys with no value', () => {
    // saveDeck builds front matter straight from optional DeckData fields; an
    // undefined value would otherwise fail the YAML dump.
    const result = serializeDeckToMarkdown(commanderDeck, {
      name: 'Test Deck',
      sourceId: undefined,
      description: undefined,
    })
    expect(result).not.toContain('sourceId')
    expect(result).not.toContain('description')
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

    const { deck: deck1 } = parseDeckText(original, 'Fallback')

    const serialized = serializeDeckToMarkdown(deck1, {
      name: deck1.name,
      description: deck1.description,
    })

    const { deck: deck2 } = parseDeckText(serialized, 'Fallback')

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
    const cardLines = result.split('\n').filter((l) => /^- \d+ /.test(l.trim()))
    expect(cardLines.length).toBe(3)
    for (const line of cardLines) {
      expect(line.trim()).toMatch(/ &\d+$/)
    }
  })
})

/**
 * The write form is bulleted (`- 2 Sol Ring (C21:263) &4`) and the read form
 * tolerates the bullet's absence, so the pair has to be pinned from both ends:
 * what the serializer writes must parse back to the deck it came from, and
 * re-serializing that deck must reproduce the same bytes.
 */
describe('serializeDeckToMarkdown: canonical bullets round-trip', () => {
  const deck: DeckData = {
    name: 'Round Trip',
    sections: [
      { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa', cardId: 1 }] },
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 2 },
          {
            quantity: 2,
            name: 'Lightning Bolt',
            set: '2xm',
            collectorNumber: '157',
            finish: 'foil',
            condition: 'LP',
            language: 'ja',
            note: 'from the cube',
            cardId: 3,
          },
        ],
      },
    ],
  }

  test('every card line is written as a markdown list item', () => {
    const markdown = serializeDeckToMarkdown(deck, {})
    expect(markdown).toContain('## Commander\n- 1 Atraxa &1')
    expect(markdown).toContain('- 1 Sol Ring (C21:263) &2')
    expect(markdown).toContain('- 2 Lightning Bolt (2XM:157) [foil] [LP] [ja] {from the cube} &3')
  })

  test('a saved deck parses back to the same sections and cards, with no warnings', () => {
    const parsed = parseDeckText(serializeDeckToMarkdown(deck, {}), 'Round Trip')
    expect(parsed.warnings).toEqual([])
    expect(parsed.deck.sections).toEqual(deck.sections)
  })

  test('re-serializing a parsed deck is byte-identical', () => {
    const first = serializeDeckToMarkdown(deck, {})
    const second = serializeDeckToMarkdown(parseDeckText(first, 'Round Trip').deck, {})
    expect(second).toBe(first)
  })

  test('a hand-written bulletless deck is read, then rewritten with bullets', () => {
    const handWritten = ['## Main', '2 Sol Ring (C21:263) &1', ''].join('\n')
    const parsed = parseDeckText(handWritten, 'Hand Written')
    expect(parsed.warnings).toEqual([])
    const rewritten = serializeDeckToMarkdown(parsed.deck, {})
    expect(rewritten).toContain('- 2 Sol Ring (C21:263) &1')
    // And the rewrite is the fixed point: a second pass changes nothing.
    expect(serializeDeckToMarkdown(parseDeckText(rewritten, 'Hand Written').deck, {})).toBe(
      rewritten,
    )
  })
})

describe('deck title round trip', () => {
  test('serialize → parse → serialize is idempotent with the H1 title', () => {
    const deck: DeckData = {
      name: 'Round Trip',
      format: 'modern',
      sections: [
        { name: 'Main', cards: [{ quantity: 4, name: 'Lightning Bolt', cardId: 1 }] },
        { name: 'Sideboard', cards: [{ quantity: 2, name: 'Pyroblast', cardId: 2 }] },
      ],
    }
    const first = serializeDeckToMarkdown(deck, { format: 'modern', tags: [] })
    expect(first).toContain('\n---\n\n# Round Trip\n\n## Main\n')

    const parsed = parseDeckText(first, 'fallback')
    expect(parsed.warnings).toEqual([])
    expect(parsed.deck.name).toBe('Round Trip')
    expect(parsed.deck.sections.map((s) => s.name)).toEqual(['Main', 'Sideboard'])

    const second = serializeDeckToMarkdown(parsed.deck, validateDeckFrontMatter(matter(first).data))
    expect(second).toBe(first)
  })

  test('legacy name: and created: keys are stripped on write', () => {
    const deck: DeckData = { name: 'Fresh', sections: [{ name: 'Main', cards: [] }] }
    const result = serializeDeckToMarkdown(deck, {
      name: 'Stale',
      created: '2024-01-01T00:00:00.000Z',
      tags: [],
    })
    expect(result).not.toContain('name:')
    expect(result).not.toContain('created:')
    expect(result).toContain('# Fresh')
  })

  test('newDeckFrontMatter carries only the format and an empty tag list', () => {
    expect(newDeckFrontMatter('commander')).toEqual({ format: 'commander', tags: [] })
  })
})
