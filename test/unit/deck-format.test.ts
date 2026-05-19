import { describe, test, expect, afterAll } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unlink, writeFile } from 'node:fs/promises'
import { importFromTextFile } from '../../src/importers/text-file'

const tempFiles: string[] = []

function makeTempPath(): string {
  const p = join(tmpdir(), `ritual-test-deck-${crypto.randomUUID()}.md`)
  tempFiles.push(p)
  return p
}

async function writeDeck(content: string): Promise<string> {
  const filePath = makeTempPath()
  await writeFile(filePath, content)
  return filePath
}

afterAll(async () => {
  await Promise.all(tempFiles.map((f) => unlink(f).catch(() => {})))
})

describe('importFromTextFile - basic card lines', () => {
  test('parses basic "1 Sol Ring" with no metadata', async () => {
    const filePath = await writeDeck('---\nname: Test\n---\n## Main\n1 Sol Ring\n')
    const deck = await importFromTextFile(filePath)
    expect(deck.sections).toHaveLength(1)
    const card = deck.sections[0]!.cards[0]!
    expect(card.quantity).toBe(1)
    expect(card.name).toBe('Sol Ring')
    expect(card.set).toBeUndefined()
    expect(card.collectorNumber).toBeUndefined()
    expect(card.finish).toBeUndefined()
    expect(card.condition).toBeUndefined()
  })

  test('parses card with set and collector number', async () => {
    const filePath = await writeDeck('---\nname: Test\n---\n## Main\n2 Lightning Bolt (2XM:157)\n')
    const deck = await importFromTextFile(filePath)
    const card = deck.sections[0]!.cards[0]!
    expect(card.quantity).toBe(2)
    expect(card.name).toBe('Lightning Bolt')
    expect(card.set).toBe('2xm')
    expect(card.collectorNumber).toBe('157')
    expect(card.finish).toBeUndefined()
    expect(card.condition).toBeUndefined()
  })

  test('parses card with set, collector number, and foil finish', async () => {
    const filePath = await writeDeck('---\nname: Test\n---\n## Main\n1 Mana Crypt (2XM:1) [foil]\n')
    const deck = await importFromTextFile(filePath)
    const card = deck.sections[0]!.cards[0]!
    expect(card.quantity).toBe(1)
    expect(card.name).toBe('Mana Crypt')
    expect(card.set).toBe('2xm')
    expect(card.collectorNumber).toBe('1')
    expect(card.finish).toBe('foil')
    expect(card.condition).toBeUndefined()
  })

  test('parses card with set, finish, and condition', async () => {
    const filePath = await writeDeck(
      '---\nname: Test\n---\n## Main\n3 Island (SLD:63) [nonfoil] [LP]\n',
    )
    const deck = await importFromTextFile(filePath)
    const card = deck.sections[0]!.cards[0]!
    expect(card.quantity).toBe(3)
    expect(card.name).toBe('Island')
    expect(card.set).toBe('sld')
    expect(card.collectorNumber).toBe('63')
    expect(card.finish).toBe('nonfoil')
    expect(card.condition).toBe('LP')
  })

  test('parses card with finish and condition but no set', async () => {
    const filePath = await writeDeck(
      '---\nname: Test\n---\n## Main\n1 Ancient Tomb [etched] [HP]\n',
    )
    const deck = await importFromTextFile(filePath)
    const card = deck.sections[0]!.cards[0]!
    expect(card.quantity).toBe(1)
    expect(card.name).toBe('Ancient Tomb')
    expect(card.set).toBeUndefined()
    expect(card.collectorNumber).toBeUndefined()
    expect(card.finish).toBe('etched')
    expect(card.condition).toBe('HP')
  })

  test('parses "2x Card Name" quantity prefix', async () => {
    const filePath = await writeDeck('---\nname: Test\n---\n## Main\n2x Lightning Bolt\n')
    const deck = await importFromTextFile(filePath)
    const card = deck.sections[0]!.cards[0]!
    expect(card.quantity).toBe(2)
    expect(card.name).toBe('Lightning Bolt')
  })

  test('parses "3X Card Name" uppercase X prefix', async () => {
    const filePath = await writeDeck('---\nname: Test\n---\n## Main\n3X Sol Ring\n')
    const deck = await importFromTextFile(filePath)
    const card = deck.sections[0]!.cards[0]!
    expect(card.quantity).toBe(3)
    expect(card.name).toBe('Sol Ring')
  })
})

describe('importFromTextFile - frontmatter', () => {
  test('reads deck name from frontmatter', async () => {
    const filePath = await writeDeck('---\nname: My Cool Deck\n---\n## Main\n1 Sol Ring\n')
    const deck = await importFromTextFile(filePath)
    expect(deck.name).toBe('My Cool Deck')
  })

  test('reads description and sourceUrl', async () => {
    const filePath = await writeDeck(
      '---\nname: Test\ndescription: A test deck\nsourceUrl: https://example.com\n---\n## Main\n1 Sol Ring\n',
    )
    const deck = await importFromTextFile(filePath)
    expect(deck.description).toBe('A test deck')
    expect(deck.sourceUrl).toBe('https://example.com')
  })

  test('reads format from frontmatter', async () => {
    const filePath = await writeDeck(
      '---\nname: Test\nformat: "modern"\n---\n## Main\n1 Sol Ring\n',
    )
    const deck = await importFromTextFile(filePath)
    expect(deck.format).toBe('modern')
  })

  test('format is undefined when not in frontmatter', async () => {
    const filePath = await writeDeck('---\nname: Test\n---\n## Main\n1 Sol Ring\n')
    const deck = await importFromTextFile(filePath)
    expect(deck.format).toBeUndefined()
  })

  test('falls back to filename when no name in frontmatter', async () => {
    const filePath = await writeDeck('---\n---\n## Main\n1 Sol Ring\n')
    const deck = await importFromTextFile(filePath)
    expect(deck.name).toBeTruthy()
  })
})

describe('importFromTextFile - sections', () => {
  test('parses multiple sections', async () => {
    const content = [
      '---',
      'name: Multi Section',
      '---',
      '## Commander',
      "1 Atraxa, Praetors' Voice",
      '',
      '## Main',
      '1 Sol Ring',
      '1 Mana Crypt',
      '',
      '## Sideboard',
      '2 Lightning Bolt',
    ].join('\n')
    const filePath = await writeDeck(content)
    const deck = await importFromTextFile(filePath)
    expect(deck.sections).toHaveLength(3)
    expect(deck.sections[0]!.name).toBe('Commander')
    expect(deck.sections[0]!.cards).toHaveLength(1)
    expect(deck.sections[1]!.name).toBe('Main')
    expect(deck.sections[1]!.cards).toHaveLength(2)
    expect(deck.sections[2]!.name).toBe('Sideboard')
    expect(deck.sections[2]!.cards).toHaveLength(1)
  })

  test('empty sections are excluded', async () => {
    const content = '---\nname: Test\n---\n## Empty\n\n## HasCards\n1 Sol Ring\n'
    const filePath = await writeDeck(content)
    const deck = await importFromTextFile(filePath)
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]!.name).toBe('HasCards')
  })

  test('cards without a section header go into Main', async () => {
    const filePath = await writeDeck('---\nname: Test\n---\n1 Sol Ring\n1 Mana Crypt\n')
    const deck = await importFromTextFile(filePath)
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]!.name).toBe('Main')
    expect(deck.sections[0]!.cards).toHaveLength(2)
  })
})

describe('importFromTextFile - notes', () => {
  test('parses {note} on a basic card line', async () => {
    const filePath = await writeDeck('---\nname: Test\n---\n## Main\n1 Sol Ring {fast mana}\n')
    const deck = await importFromTextFile(filePath)
    const card = deck.sections[0]!.cards[0]!
    expect(card.note).toBe('fast mana')
  })

  test('parses {note} alongside set, finish, condition, and cardId', async () => {
    const filePath = await writeDeck(
      '---\nname: Test\n---\n## Main\n1 Mana Crypt (2XM:1) [foil] [LP] {gift from Alex} &7\n',
    )
    const deck = await importFromTextFile(filePath)
    const card = deck.sections[0]!.cards[0]!
    expect(card.name).toBe('Mana Crypt')
    expect(card.set).toBe('2xm')
    expect(card.collectorNumber).toBe('1')
    expect(card.finish).toBe('foil')
    expect(card.condition).toBe('LP')
    expect(card.note).toBe('gift from Alex')
    expect(card.cardId).toBe(7)
  })

  test('omits note when not present', async () => {
    const filePath = await writeDeck('---\nname: Test\n---\n## Main\n2 Sol Ring &1\n')
    const deck = await importFromTextFile(filePath)
    expect(deck.sections[0]!.cards[0]!.note).toBeUndefined()
  })

  test('parses an empty {} note as empty string (does not bleed into name)', async () => {
    // A hand-edited file with `{}` should not corrupt the parsed card name.
    const filePath = await writeDeck('---\nname: Test\n---\n## Main\n1 Sol Ring {} &1\n')
    const deck = await importFromTextFile(filePath)
    const card = deck.sections[0]!.cards[0]!
    expect(card.name).toBe('Sol Ring')
    expect(card.note).toBe('')
    expect(card.cardId).toBe(1)
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
    ].join('\n')
    const filePath = await writeDeck(content)
    const deck = await importFromTextFile(filePath)
    const cards = deck.sections[0]!.cards
    expect(cards).toHaveLength(6)

    expect(cards[0]!.name).toBe('Sol Ring')
    expect(cards[0]!.set).toBeUndefined()

    expect(cards[1]!.name).toBe('Lightning Bolt')
    expect(cards[1]!.set).toBe('2xm')
    expect(cards[1]!.collectorNumber).toBe('157')

    expect(cards[2]!.name).toBe('Mana Crypt')
    expect(cards[2]!.finish).toBe('foil')

    expect(cards[3]!.name).toBe('Island')
    expect(cards[3]!.finish).toBe('nonfoil')
    expect(cards[3]!.condition).toBe('LP')

    expect(cards[4]!.name).toBe('Ancient Tomb')
    expect(cards[4]!.finish).toBe('etched')
    expect(cards[4]!.condition).toBe('HP')

    expect(cards[5]!.name).toBe('Llanowar Elves')
    expect(cards[5]!.quantity).toBe(4)
  })
})

describe('importFromTextFile - backward compatibility', () => {
  test('simple format without extended fields parses correctly', async () => {
    const content = [
      '---',
      'name: Simple Deck',
      'description: Just a basic list',
      '---',
      '## Commander',
      '1 Kenrith, the Returned King',
      '',
      '## Main',
      '1 Sol Ring',
      '1 Arcane Signet',
      '1 Command Tower',
      '30 Plains',
      '30 Island',
    ].join('\n')
    const filePath = await writeDeck(content)
    const deck = await importFromTextFile(filePath)
    expect(deck.name).toBe('Simple Deck')
    expect(deck.description).toBe('Just a basic list')
    expect(deck.sections).toHaveLength(2)
    expect(deck.sections[1]!.cards).toHaveLength(5)
    for (const section of deck.sections) {
      for (const card of section.cards) {
        expect(card.set).toBeUndefined()
        expect(card.collectorNumber).toBeUndefined()
        expect(card.finish).toBeUndefined()
        expect(card.condition).toBeUndefined()
      }
    }
  })
})
