import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { collectAllCards, formatAllCardsFile } from '../../src/commands/list-all-cards'
import { setBaseDir } from '../../src/base-dir'
import { initRitualConfig, resetRitualConfigCache } from '../../src/ritual-config'

const testDir = path.join(import.meta.dir, '../.test-list-all-cards')

const deckMd = `---
name: "Sample Deck"
format: "commander"
---

# Sample Deck

## Commander

1 Sol Ring (LEA:161)
1 Lightning Bolt (LEA:161)

## Mainboard

3 Counterspell (LEA:55)
1 Sol Ring (LEA:161)
`

const collectionMd = `# My Collection

- Sol Ring (CMR:1)
- Counterspell (LEA:55)
- Black Lotus (LEA:232) [foil] [NM] {first edition} &7
`

const wantedMd = `# Wishlist

- Mox Ruby (LEA:265)
- Lightning Bolt
- Black Lotus (LEA:232)
`

describe('list-all-cards', () => {
  const originalCwd = process.cwd()

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true })
    setBaseDir(testDir)
    resetRitualConfigCache()
    await initRitualConfig()
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
    resetRitualConfigCache()
    await fs.rm(testDir, { recursive: true, force: true })
  })

  test('dedupes cards across decks, collections, and wanted lists', async () => {
    await fs.mkdir(path.join(testDir, 'decks'), { recursive: true })
    await fs.mkdir(path.join(testDir, 'collections'), { recursive: true })
    await fs.mkdir(path.join(testDir, 'wanted'), { recursive: true })
    await fs.writeFile(path.join(testDir, 'decks', 'sample.md'), deckMd)
    await fs.writeFile(path.join(testDir, 'collections', 'main.md'), collectionMd)
    await fs.writeFile(path.join(testDir, 'wanted', 'wishlist.md'), wantedMd)

    const entries = await collectAllCards()
    const keys = entries.map((e) => `${e.name}|${e.set ?? ''}|${e.collectorNumber ?? ''}`)

    // Sol Ring (LEA:161) appears in deck twice and isn't duplicated; Sol Ring
    // (CMR:1) is a separate printing.
    expect(keys.filter((k) => k === 'Sol Ring|lea|161')).toHaveLength(1)
    expect(keys.filter((k) => k === 'Sol Ring|cmr|1')).toHaveLength(1)

    // Black Lotus (LEA:232) appears in collection (with foil/NM/note) AND
    // wanted list — should still collapse to one entry, with no finish/etc.
    expect(keys.filter((k) => k === 'Black Lotus|lea|232')).toHaveLength(1)

    // Lightning Bolt with no printing AND with printing are separate entries
    expect(keys).toContain('Lightning Bolt||')
    expect(keys).toContain('Lightning Bolt|lea|161')
  })

  test('sorts entries alphabetically by name, then by set, then by collector number', async () => {
    await fs.mkdir(path.join(testDir, 'decks'), { recursive: true })
    await fs.writeFile(
      path.join(testDir, 'decks', 'sample.md'),
      `---\nname: "S"\n---\n\n# S\n\n## Main\n\n1 Sol Ring (CMR:1)\n1 Lightning Bolt (LEA:161)\n1 Sol Ring (LEA:161)\n1 Black Lotus (LEA:232)\n`,
    )

    const entries = await collectAllCards()
    expect(entries.map((e) => e.name)).toEqual([
      'Black Lotus',
      'Lightning Bolt',
      'Sol Ring',
      'Sol Ring',
    ])
    const solRings = entries.filter((e) => e.name === 'Sol Ring')
    expect(solRings.map((e) => e.set)).toEqual(['cmr', 'lea'])
  })

  test('formatAllCardsFile produces deterministic output without finish/condition/notes', () => {
    const content = formatAllCardsFile([
      { name: 'Black Lotus', set: 'lea', collectorNumber: '232' },
      { name: 'Lightning Bolt' },
      { name: 'Sol Ring', set: 'cmr', collectorNumber: '1' },
    ])
    expect(content).toBe(
      [
        '# All cards',
        '',
        '- Black Lotus (LEA:232)',
        '- Lightning Bolt',
        '- Sol Ring (CMR:1)',
        '',
      ].join('\n'),
    )
  })

  test('returns an empty list when no list directories exist', async () => {
    const entries = await collectAllCards()
    expect(entries).toEqual([])
    expect(formatAllCardsFile(entries)).toBe('# All cards\n\n')
  })

  test('hash of the output is stable across reorderings of input cards', async () => {
    await fs.mkdir(path.join(testDir, 'decks'), { recursive: true })
    await fs.writeFile(
      path.join(testDir, 'decks', 'a.md'),
      `---\nname: "A"\n---\n# A\n\n## Main\n\n1 Sol Ring (LEA:161)\n1 Lightning Bolt (LEA:161)\n`,
    )
    const first = formatAllCardsFile(await collectAllCards())

    await fs.writeFile(
      path.join(testDir, 'decks', 'a.md'),
      `---\nname: "A"\n---\n# A\n\n## Main\n\n1 Lightning Bolt (LEA:161)\n1 Sol Ring (LEA:161)\n`,
    )
    const second = formatAllCardsFile(await collectAllCards())

    expect(first).toBe(second)
  })

  test('hash of the output ignores finish, condition, notes, and quantity', async () => {
    await fs.mkdir(path.join(testDir, 'collections'), { recursive: true })
    await fs.writeFile(path.join(testDir, 'collections', 'a.md'), `# A\n\n- Sol Ring (LEA:161)\n`)
    const before = formatAllCardsFile(await collectAllCards())

    await fs.writeFile(
      path.join(testDir, 'collections', 'a.md'),
      `# A\n\n- Sol Ring (LEA:161) [foil] [NM] {extra notes} &42\n`,
    )
    const after = formatAllCardsFile(await collectAllCards())

    expect(before).toBe(after)
  })
})
