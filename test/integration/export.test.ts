import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { cardCache } from '../../src/cache'
import { getBaseDir, setBaseDir } from '../../src/base-dir'
import { runCli, withTempDir } from './helpers/cli'
import { writeCollectionFile, writeWantedFile } from './helpers/workspace'

// Kept as a literal on purpose: the `[NM]` on a deck line is non-canonical (the
// deck serializer omits an NM condition), and the condition-filter case below
// depends on that hand-written token being parsed into the entry.
const BURN_DECK = `---
name: "Burn"
---

# Burn

## Main

2 Lightning Bolt (LEA:161) [NM] &1
1 Fireblast (VIS:78) [foil] &2

## Maybeboard

1 Price of Progress &3
`

type ExportedRecord = Record<string, string | number>

/**
 * Seed the workspace lists and mark the card cache freshly bulk-downloaded so
 * the spawned binary never triggers a Scryfall bulk download.
 */
async function seedWorkspace(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
  await fs.writeFile(path.join(dir, 'decks', 'burn.md'), BURN_DECK)
  await writeCollectionFile(dir, 'binder', {
    title: 'Binder',
    entries: [
      // No condition: an NM condition is the default and is never written to the
      // file, so it would not survive the round trip anyway.
      {
        name: 'Sol Ring',
        set: 'c21',
        collectorNumber: '263',
        finish: 'foil',
        cardId: 1,
      },
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', condition: 'LP', cardId: 2 },
    ],
  })
  await writeWantedFile(dir, 'wishlist', {
    title: 'Wishlist',
    entries: [
      { name: 'Brainstorm', cardId: 1 },
      { name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'etched', cardId: 2 },
    ],
  })

  const originalBase = getBaseDir()
  setBaseDir(dir)
  try {
    await cardCache.bulkSet({})
  } finally {
    setBaseDir(originalBase)
  }
}

function parseJsonExport(stdout: string): ExportedRecord[] {
  return JSON.parse(stdout) as ExportedRecord[]
}

describe('export command (Integration)', () => {
  test('exports every list as JSON by default, with the confirmation on stderr', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      const result = await runCli(['export', '--format', 'json'], dir)

      expect(result.exitCode).toBe(0)
      const records = parseJsonExport(result.stdout)
      expect(records).toHaveLength(7)
      // Deck entries come first (deck → collection → wanted), keeping file order,
      // and include maybeboard extras.
      expect(records[0]).toEqual({
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        condition: 'NM',
        quantity: 2,
      })
      expect(records.map((r) => r.name)).toEqual([
        'Lightning Bolt',
        'Fireblast',
        'Price of Progress',
        'Sol Ring',
        'Lightning Bolt',
        'Brainstorm',
        'Sol Ring',
      ])
      expect(result.stderr).toContain('Exported 7 cards')
    })
  }, 60_000)

  test('writes a byte-exact CSV file with custom columns, quoting, and no header', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      const result = await runCli(
        [
          'export',
          'deck:burn',
          '--out',
          'out.csv',
          '--columns',
          'name,quantity',
          '--quote-all',
          '--no-header',
        ],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Exported 3 cards to')
      const written = await fs.readFile(path.join(dir, 'out.csv'), 'utf-8')
      expect(written).toBe('"Lightning Bolt","2"\n"Fireblast","1"\n"Price of Progress","1"\n')
    })
  }, 60_000)

  test('CSV headers and uppercased set codes appear by default', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      const result = await runCli(['export', 'binder', '--quiet'], dir)

      expect(result.exitCode).toBe(0)
      const [header, first] = result.stdout.split('\n')
      expect(header).toBe('Name,Set,Collector Number,Finish,Condition,Quantity')
      expect(first).toBe('Sol Ring,C21,263,foil,,1')
    })
  }, 60_000)

  test.each<[string[], string[]]>([
    [
      ['--set', 'LEA'],
      ['Lightning Bolt', 'Lightning Bolt'],
    ],
    [['--finish', 'etched'], ['Sol Ring']],
    // Condition semantics are pinned by the filterExportEntries unit tests; this
    // case proves the flag's comma-splitting and wiring into the filter engine.
    // 'none' adds unmarked deck/collection entries; wanted entries never match.
    [
      ['--condition', 'NM,none'],
      ['Lightning Bolt', 'Fireblast', 'Price of Progress', 'Sol Ring'],
    ],
    [
      ['--name', 'sol ring'],
      ['Sol Ring', 'Sol Ring'],
    ],
  ])(
    'filter %j narrows the export',
    async (filterArgs, expectedNames) => {
      await withTempDir(async (dir) => {
        await seedWorkspace(dir)

        const result = await runCli(['export', '--format', 'json', ...filterArgs], dir)

        expect(result.exitCode).toBe(0)
        expect(parseJsonExport(result.stdout).map((r) => r.name)).toEqual(expectedNames)
      })
    },
    60_000,
  )

  test('--card picks entries across all lists and dedupes against selected lists', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      const result = await runCli(
        [
          'export',
          'deck:burn',
          '--card',
          'sol ring',
          '--card',
          'lightning bolt',
          '--card',
          'black lotus',
          '--format',
          'json',
          '--columns',
          'name,listName',
        ],
        dir,
      )

      expect(result.exitCode).toBe(0)
      const records = parseJsonExport(result.stdout)
      // Burn's three entries first, then the picks: both Sol Rings and the
      // Binder Bolt; Burn's own Bolt is already covered by the list selection.
      expect(records.map((r) => `${r.name}@${r.listName}`)).toEqual([
        'Lightning Bolt@burn',
        'Fireblast@burn',
        'Price of Progress@burn',
        'Sol Ring@binder',
        'Sol Ring@wishlist',
        'Lightning Bolt@binder',
      ])
      // A pick that matches nothing is surfaced as a warning, not silently dropped.
      expect(result.stderr).toContain("No cards matched 'black lotus'")
    })
  }, 60_000)

  test('saves and reuses a named preset', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      const save = await runCli(
        ['export', '--format', 'json', '--columns', 'name', '--save-preset', 'mini', '--quiet'],
        dir,
      )
      expect(save.exitCode).toBe(0)

      const config = JSON.parse(await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8'))
      expect(config.exportPresets).toEqual({
        mini: { format: 'json', columns: ['name'], header: true, quoteAll: false },
      })

      const reuse = await runCli(['export', '--preset', 'mini', '--all', '--quiet'], dir)
      expect(reuse.exitCode).toBe(0)
      expect(reuse.stdout).toBe(save.stdout)
      expect(parseJsonExport(reuse.stdout)).toHaveLength(7)
    })
  }, 60_000)

  test('explicit flags override the loaded preset', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      await runCli(
        ['export', '--format', 'json', '--columns', 'name', '--save-preset', 'mini', '--quiet'],
        dir,
      )
      const result = await runCli(
        ['export', '--preset', 'mini', '--all', '--format', 'csv', '--no-header', '--quiet'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim().split('\n')[0]).toBe('Lightning Bolt')
    })
  }, 60_000)

  test.each<[string, string[], number]>([
    ['unknown preset', ['export', '--preset', 'nope'], 3],
    ['unknown column', ['export', '--all', '--columns', 'name,bogus'], 2],
    ['unresolved list', ['export', 'no-such-list'], 3],
    ['conflicting type flags', ['export', '--deck', '--collection'], 2],
    ['invalid finish', ['export', '--all', '--finish', 'shiny'], 2],
    ['invalid condition', ['export', '--all', '--condition', 'OK'], 2],
    ['invalid format', ['export', '--all', '--format', 'xml'], 2],
  ])(
    '%s exits with the matching code',
    async (_label, args, exitCode) => {
      await withTempDir(async (dir) => {
        await seedWorkspace(dir)

        const result = await runCli(args, dir)

        expect(result.exitCode).toBe(exitCode)
        expect(result.stderr).not.toBe('')
      })
    },
    60_000,
  )

  test('ambiguous bare names exit as a usage error', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      await writeCollectionFile(dir, 'burn', { title: 'Burn', entries: [] })

      const result = await runCli(['export', 'burn'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('ambiguous')
    })
  }, 60_000)
})
