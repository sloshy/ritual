import { describe, expect, test } from 'bun:test'
import { runCli } from './helpers/cli'
import {
  withWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
} from './helpers/workspace'
import { buildDefaultChangeLines, loadListSnapshot } from '../../src/commands/history-helpers'

describe('loadListSnapshot + buildDefaultChangeLines (Integration)', () => {
  test('reconstructs a deck snapshot with sections, commander, note, and quantities', async () => {
    await withWorkspace(async (dir) => {
      const filePath = await writeDeckFile(dir, 'test', {
        frontMatter: { name: 'Test' },
        sections: [
          {
            name: 'Commander',
            cards: [
              {
                quantity: 1,
                name: "Atraxa, Praetors' Voice",
                set: 'cmr',
                collectorNumber: '1',
                cardId: 1,
              },
            ],
          },
          {
            name: 'Main',
            cards: [
              { quantity: 2, name: 'Sol Ring', cardId: 2 },
              { quantity: 1, name: 'Forest', note: 'basic', cardId: 3 },
            ],
          },
        ],
      })
      const snapshot = await loadListSnapshot('deck', filePath)
      expect(buildDefaultChangeLines(snapshot)).toEqual([
        '- Added section "Commander"',
        '- Added "Atraxa, Praetors\' Voice" (CMR:1) &1',
        '- Set "Atraxa, Praetors\' Voice" as commander &1',
        '- Moved "Atraxa, Praetors\' Voice" to section "Commander" &1',
        '- Added "Sol Ring" &2',
        '- Added "Sol Ring" &2',
        '- Added "Forest" &3',
        '- Set note on "Forest" &3 to "basic"',
      ])
    })
  })

  test('reconstructs a wanted-list snapshot (name-only and specific printings)', async () => {
    await withWorkspace(async (dir) => {
      const filePath = await writeWantedFile(dir, 'wants', {
        entries: [
          { name: 'Demonic Tutor', cardId: 1 },
          {
            name: 'Underground Sea',
            set: 'leb',
            collectorNumber: '286',
            finish: 'foil',
            cardId: 2,
          },
        ],
      })
      const snapshot = await loadListSnapshot('wanted', filePath)
      expect(buildDefaultChangeLines(snapshot)).toEqual([
        '- Added "Demonic Tutor" &1',
        '- Added "Underground Sea" (LEB:286) [foil] &2',
      ])
    })
  })

  test('reconstructs a flat collection snapshot', async () => {
    await withWorkspace(async (dir) => {
      const filePath = await writeCollectionFile(dir, 'main', {
        entries: [
          { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
          { name: 'Mana Crypt', set: '2xm', collectorNumber: '1', finish: 'foil', cardId: 2 },
        ],
      })
      const snapshot = await loadListSnapshot('collection', filePath)
      expect(buildDefaultChangeLines(snapshot)).toEqual([
        '- Added "Sol Ring" (C21:240) &1',
        '- Added "Mana Crypt" (2XM:1) [foil] &2',
      ])
    })
  })
})

describe('history CLI error paths (Integration)', () => {
  test('rejects conflicting type flags with exit code 2', async () => {
    await withWorkspace(
      async (dir) => {
        const result = await runCli(['history', '--deck', '--collection', 'whatever'], dir)
        expect(result.exitCode).toBe(2)
        expect(result.stderr).toContain('only one of --deck, --collection, or --wanted')
      },
      { dirs: [], config: false },
    )
  })

  test('reports not-found with exit code 3 when the named list does not exist', async () => {
    await withWorkspace(async (dir) => {
      // A real deck so the resolver reports not-found (with the query name) rather than no-lists.
      await writeDeckFile(dir, 'other', {
        frontMatter: { name: 'Other' },
        cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
      })
      const result = await runCli(['history', '--deck', 'nonexistent'], dir)
      expect(result.exitCode).toBe(3)
      expect(result.stderr).toContain('nonexistent')
    })
  })
})
