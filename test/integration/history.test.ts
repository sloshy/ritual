import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { runCli } from './helpers/cli'
import { buildDefaultChangeLines, loadListSnapshot } from '../../src/commands/history-helpers'

async function withTempFile(
  subdir: string,
  fileName: string,
  body: string,
  run: (filePath: string) => Promise<void>,
): Promise<void> {
  const dir = path.join(tmpdir(), `ritual-history-${crypto.randomUUID()}`)
  await fs.mkdir(path.join(dir, subdir), { recursive: true })
  const filePath = path.join(dir, subdir, fileName)
  await fs.writeFile(filePath, body)
  try {
    await run(filePath)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('loadListSnapshot + buildDefaultChangeLines (Integration)', () => {
  test('reconstructs a deck snapshot with sections, commander, note, and quantities', async () => {
    const deck = [
      '---',
      'name: Test',
      '---',
      '',
      '## Commander',
      "1 Atraxa, Praetors' Voice (CMR:1) &1",
      '',
      '## Main',
      '2 Sol Ring &2',
      '1 Forest {basic} &3',
      '',
    ].join('\n')

    await withTempFile('decks', 'test.md', deck, async (filePath) => {
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
    const wanted = [
      '# wants',
      '',
      '- Demonic Tutor &1',
      '- Underground Sea (LEB:286) [foil] &2',
      '',
    ].join('\n')
    await withTempFile('wanted', 'wants.md', wanted, async (filePath) => {
      const snapshot = await loadListSnapshot('wanted', filePath)
      expect(buildDefaultChangeLines(snapshot)).toEqual([
        '- Added "Demonic Tutor" &1',
        '- Added "Underground Sea" (LEB:286) [foil] &2',
      ])
    })
  })

  test('reconstructs a flat collection snapshot', async () => {
    const collection = [
      '# main',
      '',
      '- Sol Ring (C21:240) &1',
      '- Mana Crypt (2XM:1) [foil] &2',
      '',
    ].join('\n')
    await withTempFile('collections', 'main.md', collection, async (filePath) => {
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
    const dir = path.join(tmpdir(), `ritual-history-cli-${crypto.randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
    try {
      const result = await runCli(['history', '--deck', '--collection', 'whatever'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('only one of --deck, --collection, or --wanted')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test('reports not-found with exit code 3 when the named list does not exist', async () => {
    const dir = path.join(tmpdir(), `ritual-history-cli-${crypto.randomUUID()}`)
    await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'ritual.config.json'),
      JSON.stringify({
        decksDir: './decks',
        collectionsDir: './collections',
        wantedDir: './wanted',
      }),
    )
    // A real deck so the resolver reports not-found (with the query name) rather than no-lists.
    await fs.writeFile(
      path.join(dir, 'decks', 'other.md'),
      '---\nname: Other\n---\n\n## Main\n1 Sol Ring &1\n',
    )
    try {
      const result = await runCli(['history', '--deck', 'nonexistent'], dir)
      expect(result.exitCode).toBe(3)
      expect(result.stderr).toContain('nonexistent')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
