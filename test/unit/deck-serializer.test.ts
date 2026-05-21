import { describe, test, expect, afterAll } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unlink, writeFile } from 'node:fs/promises'
import { serializeCardLine, serializeDeckToMarkdown } from '../../src/deck-file'
import { importFromTextFile } from '../../src/importers/text-file'
import type { Card, DeckData } from '../../src/types'

const tempFiles: string[] = []

function makeTempPath(): string {
  const p = join(tmpdir(), `ritual-test-serialize-${crypto.randomUUID()}.md`)
  tempFiles.push(p)
  return p
}

afterAll(async () => {
  await Promise.all(tempFiles.map((f) => unlink(f).catch(() => {})))
})

describe('serializeCardLine', () => {
  test('basic card with no metadata', () => {
    const card: Card = { quantity: 1, name: 'Sol Ring' }
    expect(serializeCardLine(card)).toBe('1 Sol Ring')
  })

  test('card with set and collector number', () => {
    const card: Card = { quantity: 2, name: 'Lightning Bolt', set: '2XM', collectorNumber: '157' }
    expect(serializeCardLine(card)).toBe('2 Lightning Bolt (2XM:157)')
  })

  test('card with foil finish', () => {
    const card: Card = {
      quantity: 1,
      name: 'Mana Crypt',
      set: '2XM',
      collectorNumber: '1',
      finish: 'foil',
    }
    expect(serializeCardLine(card)).toBe('1 Mana Crypt (2XM:1) [foil]')
  })

  test('card with etched finish', () => {
    const card: Card = { quantity: 1, name: 'Ancient Tomb', finish: 'etched' }
    expect(serializeCardLine(card)).toBe('1 Ancient Tomb [etched]')
  })

  test('nonfoil finish is omitted', () => {
    const card: Card = { quantity: 1, name: 'Sol Ring', finish: 'nonfoil' }
    expect(serializeCardLine(card)).toBe('1 Sol Ring')
  })

  test('NM condition is omitted', () => {
    const card: Card = { quantity: 1, name: 'Sol Ring', condition: 'NM' }
    expect(serializeCardLine(card)).toBe('1 Sol Ring')
  })

  test('non-NM condition is included', () => {
    const card: Card = {
      quantity: 3,
      name: 'Island',
      set: 'SLD',
      collectorNumber: '63',
      condition: 'LP',
    }
    expect(serializeCardLine(card)).toBe('3 Island (SLD:63) [LP]')
  })

  test('card with all metadata', () => {
    const card: Card = {
      quantity: 1,
      name: 'Mana Crypt',
      set: '2XM',
      collectorNumber: '1',
      finish: 'foil',
      condition: 'LP',
    }
    expect(serializeCardLine(card)).toBe('1 Mana Crypt (2XM:1) [foil] [LP]')
  })

  test('set without collector number is not serialized', () => {
    const card: Card = { quantity: 1, name: 'Sol Ring', set: '2XM' }
    expect(serializeCardLine(card)).toBe('1 Sol Ring')
  })

  test('card with cardId appends &N suffix', () => {
    const card: Card = { quantity: 1, name: 'Sol Ring', cardId: 5 }
    expect(serializeCardLine(card)).toBe('1 Sol Ring &5')
  })

  test('card with all metadata and cardId', () => {
    const card: Card = {
      quantity: 1,
      name: 'Mana Crypt',
      set: '2XM',
      collectorNumber: '1',
      finish: 'foil',
      condition: 'LP',
      cardId: 42,
    }
    expect(serializeCardLine(card)).toBe('1 Mana Crypt (2XM:1) [foil] [LP] &42')
  })

  test('card with note', () => {
    const card: Card = { quantity: 2, name: 'Sol Ring', note: 'starts the engine', cardId: 1 }
    expect(serializeCardLine(card)).toBe('2 Sol Ring {starts the engine} &1')
  })

  test('card with note and full metadata', () => {
    const card: Card = {
      quantity: 1,
      name: 'Mana Crypt',
      set: '2XM',
      collectorNumber: '1',
      finish: 'foil',
      condition: 'LP',
      note: 'gift from Alex',
      cardId: 7,
    }
    expect(serializeCardLine(card)).toBe('1 Mana Crypt (2XM:1) [foil] [LP] {gift from Alex} &7')
  })

  test('empty note is omitted', () => {
    const card: Card = { quantity: 1, name: 'Sol Ring', note: '' }
    expect(serializeCardLine(card)).toBe('1 Sol Ring')
  })

  test('card without cardId has no &N suffix', () => {
    const card: Card = { quantity: 1, name: 'Sol Ring' }
    expect(serializeCardLine(card)).not.toContain('&')
  })
})

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

    expect(result).toContain('name: Test Deck')
    expect(result).toContain('description: A test')
    expect(result).toContain('## Commander')
    expect(result).toContain('1 Kenrith, the Returned King')
    expect(result).toContain('## Main')
    expect(result).toContain('1 Sol Ring')
    expect(result).toContain('1 Mana Crypt (2XM:1) [foil]')
  })

  test('output has YAML frontmatter delimiters', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }],
    }
    const result = serializeDeckToMarkdown(deck, { name: 'Test' })
    expect(result).toMatch(/^---\n/)
    expect(result).toMatch(/\n---\n/)
  })
})

describe('round-trip: parse → serialize → parse', () => {
  test('basic deck round-trips correctly', async () => {
    const original = [
      '---',
      'name: Round Trip Deck',
      'description: Testing round trip',
      '---',
      '',
      '## Commander',
      '1 Kenrith, the Returned King',
      '',
      '## Main',
      '1 Sol Ring',
      '1 Mana Crypt (2XM:1) [foil]',
      '3 Island (SLD:63) [LP]',
      '',
    ].join('\n')

    const filePath1 = makeTempPath()
    await writeFile(filePath1, original)
    const deck1 = await importFromTextFile(filePath1)

    const serialized = serializeDeckToMarkdown(deck1, {
      name: deck1.name,
      description: deck1.description,
    })

    const filePath2 = makeTempPath()
    await writeFile(filePath2, serialized)
    const deck2 = await importFromTextFile(filePath2)

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

  test('deck with card IDs round-trips correctly', async () => {
    const original = [
      '---',
      'name: Card ID Deck',
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

    const filePath1 = makeTempPath()
    await writeFile(filePath1, original)
    const deck1 = await importFromTextFile(filePath1)

    // Verify IDs parsed correctly
    expect(deck1.sections[0]!.cards[0]!.cardId).toBe(1)
    expect(deck1.sections[1]!.cards[0]!.cardId).toBe(2)
    expect(deck1.sections[1]!.cards[1]!.cardId).toBe(3)
    expect(deck1.sections[1]!.cards[2]!.cardId).toBe(4)

    const serialized = serializeDeckToMarkdown(deck1, { name: deck1.name })

    const filePath2 = makeTempPath()
    await writeFile(filePath2, serialized)
    const deck2 = await importFromTextFile(filePath2)

    // Verify IDs survive round-trip
    for (let i = 0; i < deck1.sections.length; i++) {
      const s1 = deck1.sections[i]!
      const s2 = deck2.sections[i]!
      for (let j = 0; j < s1.cards.length; j++) {
        expect(s2.cards[j]!.cardId).toBe(s1.cards[j]!.cardId)
      }
    }
  })
})

describe('serializeDeckToMarkdown assigns missing card IDs', () => {
  test('assigns IDs to cards that lack them', () => {
    const deck: DeckData = {
      name: 'Test',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring' },
            { quantity: 1, name: 'Mana Crypt' },
          ],
        },
      ],
    }
    const result = serializeDeckToMarkdown(deck, { name: 'Test' })
    expect(result).toContain('1 Sol Ring &1')
    expect(result).toContain('1 Mana Crypt &2')
  })

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
