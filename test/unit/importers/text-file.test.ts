import { describe, expect, test, afterAll } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unlink, writeFile } from 'node:fs/promises'
import { importFromTextFile, parseDeckText } from '../../../src/importers/text-file'

const tempFiles: string[] = []

function makeTempPath(suffix = '.md'): string {
  const p = join(tmpdir(), `ritual-test-import-${crypto.randomUUID()}${suffix}`)
  tempFiles.push(p)
  return p
}

async function writeDeck(content: string, suffix = '.md'): Promise<string> {
  const filePath = makeTempPath(suffix)
  await writeFile(filePath, content)
  return filePath
}

afterAll(async () => {
  await Promise.all(tempFiles.map((f) => unlink(f).catch(() => {})))
})

describe('parseDeckText', () => {
  test('uses the fallback name when the text has no frontmatter name', () => {
    const deck = parseDeckText('2 Lightning Bolt\n1 Sol Ring', 'Pasted Deck')
    expect(deck.name).toBe('Pasted Deck')
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]?.name).toBe('Main')
    expect(deck.sections[0]?.cards.map((c) => `${c.quantity} ${c.name}`)).toEqual([
      '2 Lightning Bolt',
      '1 Sol Ring',
    ])
  })

  test('frontmatter name overrides the fallback name', () => {
    const deck = parseDeckText(
      '---\nname: Frontmatter Deck\nformat: modern\n---\n4 Opt',
      'Fallback',
    )
    expect(deck.name).toBe('Frontmatter Deck')
    expect(deck.format).toBe('modern')
  })

  test('format is undefined when not in frontmatter', () => {
    expect(parseDeckText('---\nname: Test\n---\n1 Sol Ring', 'X').format).toBeUndefined()
  })

  test('parses an empty {} note as empty string (does not bleed into name)', () => {
    // A hand-edited file with `{}` should not corrupt the parsed card name.
    const deck = parseDeckText('1 Sol Ring {} &1', 'X')
    const card = deck.sections[0]!.cards[0]!
    expect(card.name).toBe('Sol Ring')
    expect(card.note).toBe('')
    expect(card.cardId).toBe(1)
  })

  test('parses printing details and lowercases the set code', () => {
    const deck = parseDeckText('1 Lightning Bolt (LEA:161) [foil] [NM] {nice} &7', 'X')
    expect(deck.sections[0]?.cards[0]).toEqual({
      quantity: 1,
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'foil',
      condition: 'NM',
      note: 'nice',
      cardId: 7,
    })
  })

  test('splits sections on markdown headers and drops empty ones', () => {
    const deck = parseDeckText('1 Sol Ring\n\n## Sideboard\n2 Pyroblast\n\n## Empty', 'X')
    expect(deck.sections.map((s) => s.name)).toEqual(['Main', 'Sideboard'])
    expect(deck.sections[1]?.cards[0]?.name).toBe('Pyroblast')
  })

  test('renames the default Main section when a header precedes any cards', () => {
    const deck = parseDeckText('# Commander\n1 Atraxa, Praetors Voice\n1 Sol Ring', 'X')
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]?.name).toBe('Commander')
    expect(deck.sections[0]?.cards.map((c) => c.name)).toEqual([
      'Atraxa, Praetors Voice',
      'Sol Ring',
    ])
  })

  test('yields no sections when the text contains no card lines', () => {
    const deck = parseDeckText('just some prose\nwith no quantities', 'X')
    expect(deck.sections).toHaveLength(0)
  })
})

describe('importFromTextFile - frontmatter', () => {
  test('parses YAML frontmatter with name, description, sourceUrl, sourceId', async () => {
    const filePath = await writeDeck(
      `---
name: "My Deck"
description: "Line 1\\nLine 2"
sourceUrl: "https://example.com/deck/123"
sourceId: "123"
---
## Main
4 Lightning Bolt
2 Counterspell
`,
      '.txt',
    )
    const deck = await importFromTextFile(filePath)

    expect(deck.name).toBe('My Deck')
    expect(deck.description).toBe('Line 1\nLine 2')
    expect(deck.sourceUrl).toBe('https://example.com/deck/123')
    expect(deck.sourceId).toBe('123')
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]?.cards).toEqual([
      { quantity: 4, name: 'Lightning Bolt' },
      { quantity: 2, name: 'Counterspell' },
    ])
  })

  test('falls back to filename when no name in frontmatter', async () => {
    const filePath = await writeDeck('---\n---\n## Main\n1 Sol Ring\n')
    const deck = await importFromTextFile(filePath)
    expect(deck.name).toBeTruthy()
    expect(deck.name).toMatch(/^ritual-test-import-/)
  })
})

describe('importFromTextFile - primer sidecar', () => {
  test('loads primer from sidecar .primer.md file', async () => {
    const deckPath = await writeDeck('---\nname: Test\n---\n## Main\n1 Sol Ring\n', '.txt')
    const primerPath = deckPath.replace(/\.txt$/, '.primer.md')
    await writeFile(primerPath, '## Overview\n\nThis deck does stuff.\n')
    tempFiles.push(primerPath)
    const deck = await importFromTextFile(deckPath)
    expect(deck.primer).toBe('## Overview\n\nThis deck does stuff.')
  })

  test('returns undefined primer when no sidecar file exists', async () => {
    const deckPath = await writeDeck('---\nname: Test\n---\n## Main\n1 Sol Ring\n', '.txt')
    const deck = await importFromTextFile(deckPath)
    expect(deck.primer).toBeUndefined()
  })
})

describe('importFromTextFile - mixed extended format', () => {
  test('parses deck with mixed card line formats', async () => {
    const content = [
      '---',
      'name: Mixed Formats',
      '---',
      '## Main',
      '1 Sol Ring',
      '2 Lightning Bolt (2XM:157)',
      '1 Mana Crypt (2XM:1) [foil]',
      '3 Island (SLD:63) [nonfoil] [LP]',
      '1 Ancient Tomb [etched] [HP]',
      '4x Llanowar Elves',
      '3X Brainstorm',
    ].join('\n')
    const filePath = await writeDeck(content)
    const deck = await importFromTextFile(filePath)
    const cards = deck.sections[0]!.cards
    expect(cards).toHaveLength(7)

    expect(cards[0]!.name).toBe('Sol Ring')
    expect(cards[0]!.set).toBeUndefined()

    expect(cards[1]).toMatchObject({ name: 'Lightning Bolt', set: '2xm', collectorNumber: '157' })

    expect(cards[2]).toMatchObject({ name: 'Mana Crypt', finish: 'foil' })

    expect(cards[3]).toMatchObject({ name: 'Island', finish: 'nonfoil', condition: 'LP' })

    expect(cards[4]).toMatchObject({ name: 'Ancient Tomb', finish: 'etched', condition: 'HP' })

    expect(cards[5]).toMatchObject({ name: 'Llanowar Elves', quantity: 4 })

    expect(cards[6]).toMatchObject({ name: 'Brainstorm', quantity: 3 })
  })
})
