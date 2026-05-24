import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { importFromTextFile, parseDeckText } from '../../../src/importers/text-file'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unlink } from 'node:fs/promises'

const TEST_FILE = join(tmpdir(), `ritual-test-${crypto.randomUUID()}.txt`)
const TEST_PRIMER_FILE = TEST_FILE.replace(/\.txt$/, '.primer.md')

describe('Text File Importer', () => {
  beforeAll(async () => {
    await Bun.write(
      TEST_FILE,
      `---
name: "File Deck"
description: "My cool deck"
---
1 Sol Ring
# Commander
1 Test Commander
`,
    )
  })

  afterAll(async () => {
    await unlink(TEST_FILE).catch(() => {})
    await unlink(TEST_PRIMER_FILE).catch(() => {})
  })

  test('parses text file with frontmatter and sections', async () => {
    const deck = await importFromTextFile(TEST_FILE)

    expect(deck.name).toBe('File Deck')
    expect(deck.description).toBe('My cool deck')

    // Should have Main and Commander sections

    const main = deck.sections.find((s) => s.name === 'Main')
    expect(main).toBeDefined()
    expect(main?.cards[0]?.name).toBe('Sol Ring')

    const commander = deck.sections.find((s) => s.name === 'Commander')
    expect(commander).toBeDefined()
    expect(commander?.cards[0]?.name).toBe('Test Commander')
  })

  test('loads primer from sidecar .primer.md file', async () => {
    await Bun.write(TEST_PRIMER_FILE, '## Overview\n\nThis deck does stuff.\n')
    const deck = await importFromTextFile(TEST_FILE)
    expect(deck.primer).toBe('## Overview\n\nThis deck does stuff.')
  })

  test('returns undefined primer when no sidecar file exists', async () => {
    await unlink(TEST_PRIMER_FILE).catch(() => {})
    const deck = await importFromTextFile(TEST_FILE)
    expect(deck.primer).toBeUndefined()
  })
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

  test('parses printing details and lowercases the set code', () => {
    const deck = parseDeckText('1 Lightning Bolt (LEA:161) [foil] [NM] {nice} &7', 'X')
    const card = deck.sections[0]?.cards[0]
    expect(card).toEqual({
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
