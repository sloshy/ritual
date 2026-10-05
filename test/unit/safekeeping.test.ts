import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { BACKUPS_DIR, backUpFiles, moveToTrash, safekeepingStamp } from '../../src/util/safekeeping'
import {
  bindWorkspace,
  snapshotTree,
  withWorkspace,
  type BoundWorkspace,
} from '../helpers/workspace'
import { rejectionOf } from '../helpers/rejection'

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ dirs: ['decks'], config: false })
})

afterEach(async () => {
  await ws.dispose()
})

const NOW = new Date('2026-10-05T14:03:22.517Z')

test('the stamp sorts by time and holds no character a Windows file name refuses', () => {
  expect(safekeepingStamp(NOW)).toBe('2026-10-05T14-03-22Z')
})

describe('moveToTrash', () => {
  test('moves files under their workspace-relative paths into a fresh folder', async () => {
    const file = path.join(ws.dir, 'decks', 'Burn.md')
    await fs.writeFile(file, '# Burn\n')

    const folder = await moveToTrash([file], 'deck-Burn', NOW)

    expect(path.relative(ws.dir, folder)).toBe(
      path.join('.trash', '2026-10-05T14-03-22Z-deck-Burn'),
    )
    expect(await snapshotTree(folder)).toEqual({
      'decks/': '',
      [path.join('decks', 'Burn.md')]: '# Burn\n',
    })
    expect(await Bun.file(file).exists()).toBeFalse()
  })

  test('a second folder in the same second gets a suffix instead of merging', async () => {
    const file = path.join(ws.dir, 'decks', 'Burn.md')
    await fs.writeFile(file, 'first')
    const first = await moveToTrash([file], 'deck-Burn', NOW)
    await fs.writeFile(file, 'second')
    const second = await moveToTrash([file], 'deck-Burn', NOW)

    expect(second).toBe(`${first}-2`)
    expect(await fs.readFile(path.join(first, 'decks', 'Burn.md'), 'utf-8')).toBe('first')
    expect(await fs.readFile(path.join(second, 'decks', 'Burn.md'), 'utf-8')).toBe('second')
  })

  test('a failure part-way moves the files already trashed back', async () => {
    const sidecar = path.join(ws.dir, 'decks', 'Burn.changes.md')
    const list = path.join(ws.dir, 'decks', 'Burn.md')
    await fs.writeFile(sidecar, '# Changelog\n')
    // `list` does not exist, so its move fails after the sidecar's succeeded.
    await rejectionOf(moveToTrash([sidecar, list], 'deck-Burn', NOW))
    expect(await fs.readFile(sidecar, 'utf-8')).toBe('# Changelog\n')
  })

  test('a move across devices (a Docker bind mount) falls back to copy and unlink', async () => {
    const file = path.join(ws.dir, 'decks', 'Burn.md')
    await fs.writeFile(file, '# Burn\n')
    const rename = spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('cross-device link'), { code: 'EXDEV' }),
    )
    try {
      const folder = await moveToTrash([file], 'deck-Burn', NOW)
      expect(await fs.readFile(path.join(folder, 'decks', 'Burn.md'), 'utf-8')).toBe('# Burn\n')
      expect(await Bun.file(file).exists()).toBeFalse()
    } finally {
      rename.mockRestore()
    }
  })
})

describe('backUpFiles', () => {
  test('copies the files and folders that exist and leaves the originals', async () => {
    const file = path.join(ws.dir, 'ritual.config.json')
    await fs.writeFile(file, '{}\n')
    await fs.writeFile(path.join(ws.dir, 'decks', 'Burn.md'), '# Burn\n')

    const folder = await backUpFiles(
      [file, path.join(ws.dir, 'decks'), path.join(ws.dir, 'missing.md')],
      'migration-3',
      NOW,
    )

    if (folder === null) throw new Error('expected a backup folder')
    expect(await snapshotTree(folder)).toEqual({
      'ritual.config.json': '{}\n',
      'decks/': '',
      [path.join('decks', 'Burn.md')]: '# Burn\n',
    })
    expect(await fs.readFile(file, 'utf-8')).toBe('{}\n')
  })

  test('returns null and removes the folder it made when none of the files exist', async () => {
    expect(await backUpFiles([path.join(ws.dir, 'missing.md')], 'migration-3', NOW)).toBeNull()
    expect(await fs.readdir(path.join(ws.dir, BACKUPS_DIR))).toEqual([])
  })

  test('keeps a file outside the workspace under its base name, and a `..`-named one in place', async () => {
    await withWorkspace(
      async (outsideDir) => {
        const outside = path.join(outsideDir, 'notes.txt')
        await fs.writeFile(outside, 'mine')
        const dotted = path.join(ws.dir, '..notes', 'x.md')
        await fs.mkdir(path.dirname(dotted))
        await fs.writeFile(dotted, 'inside')

        const folder = await backUpFiles([outside, dotted], 'migration-3', NOW)

        if (folder === null) throw new Error('expected a backup folder')
        expect(await snapshotTree(folder)).toEqual({
          'notes.txt': 'mine',
          '..notes/': '',
          [path.join('..notes', 'x.md')]: 'inside',
        })
      },
      { dirs: [], config: false },
    )
  })
})
