import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { runCli } from './helpers/cli'
import {
  withWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
} from './helpers/workspace'
import {
  buildDefaultChangeLines,
  changesPathFor,
  loadListSnapshot,
} from '../../src/commands/history-helpers'
import type { ChangeSet } from '../../src/changelog-blocks'

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

describe('history --show (Integration)', () => {
  const OLDER_TS = '2026-01-01T10:00:00.000Z'
  const NEWER_TS = '2026-02-01T10:00:00.000Z'
  // On-disk changelogs are oldest-first; --show must re-sort newest-first.
  const CHANGELOG = [
    '# Changelog for test',
    '',
    `## ${OLDER_TS}`,
    '',
    '- Added "Sol Ring" &1',
    '- Added "Lightning Bolt" (LEA:161) &2',
    '',
    `## ${NEWER_TS}`,
    '',
    '- Removed "Lightning Bolt" (LEA:161) &2',
    '',
  ].join('\n')

  async function seedDeck(dir: string, changelog?: string): Promise<void> {
    const filePath = await writeDeckFile(dir, 'test', {
      frontMatter: { name: 'Test' },
      cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
    })
    if (changelog !== undefined) await fs.writeFile(changesPathFor(filePath), changelog)
  }

  test('prints the change sets newest first with verbatim lines', async () => {
    await withWorkspace(async (dir) => {
      await seedDeck(dir, CHANGELOG)
      const result = await runCli(['history', 'test', '--show'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("Change history for Deck 'test' — 2 change set(s).")
      expect(result.stdout).toContain(`${NEWER_TS}  (1 change):`)
      expect(result.stdout).toContain(`${OLDER_TS}  (2 changes):`)
      expect(result.stdout.indexOf(NEWER_TS)).toBeLessThan(result.stdout.indexOf(OLDER_TS))
      // Raw lines verbatim — leading '- ' and '&N' intact — indented two spaces.
      expect(result.stdout).toContain('  - Added "Sol Ring" &1')
      expect(result.stdout).toContain('  - Removed "Lightning Bolt" (LEA:161) &2')
    })
  })

  test('--output json --limit 1 emits only the newest set in the admin payload shape', async () => {
    await withWorkspace(async (dir) => {
      await seedDeck(dir, CHANGELOG)
      const result = await runCli(
        ['history', 'test', '--show', '--output', 'json', '--limit', '1'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const payload = JSON.parse(result.stdout) as { header: string; sets: ChangeSet[] }
      expect(payload.header).toBe('# Changelog for test')
      expect(payload.sets).toEqual([
        { timestamp: NEWER_TS, lines: ['- Removed "Lightning Bolt" (LEA:161) &2'] },
      ])
    })
  })

  test('a list with no changelog reports an empty history with exit 0', async () => {
    await withWorkspace(async (dir) => {
      await seedDeck(dir)
      const result = await runCli(['history', 'test', '--show'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('No change history recorded.')
    })
  })

  test('--show without a list name on a non-TTY is a usage error', async () => {
    await withWorkspace(async (dir) => {
      await seedDeck(dir, CHANGELOG)
      const result = await runCli(['history', '--show'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Input required')
    })
  })

  test('editor mode on a non-TTY is a usage error pointing at --show', async () => {
    await withWorkspace(async (dir) => {
      await seedDeck(dir, CHANGELOG)
      const result = await runCli(['history', 'test'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('interactive history editor is unavailable')
      expect(result.stderr).toContain('--show')
    })
  })

  test('structured output without --show is a usage error', async () => {
    await withWorkspace(async (dir) => {
      await seedDeck(dir, CHANGELOG)
      const result = await runCli(['history', 'test', '--output', 'json'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--output json requires --show')
    })
  })

  test('--limit without --show is a usage error', async () => {
    await withWorkspace(async (dir) => {
      await seedDeck(dir, CHANGELOG)
      const result = await runCli(['history', 'test', '--limit', '2'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--limit requires --show')
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
      const result = await runCli(['history', '--deck', 'nonexistent', '--show'], dir)
      expect(result.exitCode).toBe(3)
      expect(result.stderr).toContain('nonexistent')
    })
  })
})
