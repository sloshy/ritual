import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { computeHash } from '../../src/content-hash'
import { runCli } from './helpers/cli'
import { withWorkspace, writeCollectionFile, writeDeckFile } from './helpers/workspace'

const exists = (filePath: string): Promise<boolean> => Bun.file(filePath).exists()

/**
 * Seed deck `test` (display name 'Test Deck') with every sidecar type. The
 * .sha256 matches the content (Ritual-clean), so a rename writes a fresh hash
 * for the new content — the stale-sidecar path is pinned in
 * test/unit/list-lifecycle.test.ts.
 */
async function seedDeckWithSidecars(dir: string): Promise<string> {
  const filePath = await writeDeckFile(dir, 'test', {
    frontMatter: { name: 'Test Deck', format: 'commander' },
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
  await fs.writeFile(`${filePath}.sha256`, computeHash(await fs.readFile(filePath, 'utf-8')) + '\n')
  await fs.writeFile(path.join(dir, 'decks', 'test.changes.md'), '# Changelog\n')
  await fs.writeFile(path.join(dir, 'decks', 'test.primer.md'), '# Primer\n')
  await fs.writeFile(
    path.join(dir, 'decks', 'test.art.json'),
    '{\n  "1": { "file": "proxies/sol-ring.jpg" }\n}\n',
  )
  return filePath
}

describe('rename CLI (Integration)', () => {
  test('renames a deck: new slug, rewritten name, moved sidecars, old .sha256 dropped', async () => {
    await withWorkspace(async (dir) => {
      await seedDeckWithSidecars(dir)

      const result = await runCli(['rename', 'deck:test', 'Fresh Name'], dir)
      expect(result.exitCode).toBe(0)

      const decksDir = path.join(dir, 'decks')
      const newPath = path.join(decksDir, 'Fresh Name.md')

      // Old file and sidecars are gone — including the old .sha256.
      expect(await exists(path.join(decksDir, 'test.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.md.sha256'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.changes.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.primer.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.art.json'))).toBe(false)

      // New file with a fresh hash and the moved sidecars.
      expect(await exists(newPath)).toBe(true)
      expect(await exists(`${newPath}.sha256`)).toBe(true)
      expect(await exists(path.join(decksDir, 'Fresh Name.changes.md'))).toBe(true)
      expect(await exists(path.join(decksDir, 'Fresh Name.primer.md'))).toBe(true)
      // Art travels by content, not just by name: a renamed list keeps pointing
      // at the same images.
      expect(await fs.readFile(path.join(decksDir, 'Fresh Name.art.json'), 'utf-8')).toContain(
        'proxies/sol-ring.jpg',
      )

      const content = await fs.readFile(newPath, 'utf-8')
      expect(content).toContain('name: Fresh Name')
      expect(content).toContain('1 Sol Ring &1')
    })
  })

  test('renames a collection in place when the slug does not change', async () => {
    await withWorkspace(async (dir) => {
      await writeCollectionFile(dir, 'main', { title: 'Old Title', entries: [] })

      const result = await runCli(['rename', 'collection:main', 'main', '--output', 'json'], dir)
      expect(result.exitCode).toBe(0)

      const payload = JSON.parse(result.stdout) as {
        type: string
        oldSlug: string
        newSlug: string
        name: string
        newFilePath: string
        oldFilePath: string
      }
      const filePath = path.join(dir, 'collections', 'main.md')
      expect(payload).toEqual({
        type: 'collection',
        oldSlug: 'main',
        newSlug: 'main',
        name: 'main',
        newFilePath: filePath,
        oldFilePath: filePath,
      })

      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content.startsWith('# main\n')).toBe(true)
    })
  })

  test('refuses to rename onto an existing slug', async () => {
    await withWorkspace(async (dir) => {
      await writeCollectionFile(dir, 'a', { title: 'A', entries: [] })
      await writeCollectionFile(dir, 'b', { title: 'B', entries: [] })

      const result = await runCli(['rename', 'collection:a', 'b'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('already exists')
      expect(await exists(path.join(dir, 'collections', 'a.md'))).toBe(true)
    })
  })

  test('the JSON payload carries both file paths on a move', async () => {
    await withWorkspace(async (dir) => {
      await writeCollectionFile(dir, 'main', { title: 'Main', entries: [] })

      const result = await runCli(
        ['rename', 'collection:main', 'Trade Binder', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const payload = JSON.parse(result.stdout) as { newFilePath: string; oldFilePath: string }
      expect(payload.oldFilePath).toBe(path.join(dir, 'collections', 'main.md'))
      expect(payload.newFilePath).toBe(path.join(dir, 'collections', 'Trade Binder.md'))
    })
  })

  test('refuses a rename onto a name that merely folds onto another list', async () => {
    await withWorkspace(async (dir) => {
      await writeCollectionFile(dir, 'Trade Binder', { title: 'Trade Binder', entries: [] })
      await writeCollectionFile(dir, 'Spares', { title: 'Spares', entries: [] })

      const result = await runCli(['rename', 'collection:Spares', 'trade-binder'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("A collection named 'Trade Binder' already exists")
      expect(await exists(path.join(dir, 'collections', 'Spares.md'))).toBe(true)
    })
  })

  test('re-spelling a list under its own folded name is allowed, sidecars following', async () => {
    // On Linux the destination is a different file, so this exercises the
    // ordinary move path — the same-file two-step is unit-tested with the seam.
    await withWorkspace(async (dir) => {
      await seedDeckWithSidecars(dir)
      const decksDir = path.join(dir, 'decks')

      const result = await runCli(['rename', 'deck:test', 'TEST'], dir)
      expect(result.exitCode).toBe(0)
      expect(await exists(path.join(decksDir, 'TEST.md'))).toBe(true)
      expect(await exists(path.join(decksDir, 'TEST.changes.md'))).toBe(true)
      expect(await exists(path.join(decksDir, 'TEST.primer.md'))).toBe(true)
      expect(await exists(path.join(decksDir, 'TEST.art.json'))).toBe(true)
      expect(await exists(path.join(decksDir, 'test.md'))).toBe(false)
    })
  })

  test('a type prefix contradicting a type flag is a usage error naming both', async () => {
    await withWorkspace(async (dir) => {
      await writeCollectionFile(dir, 'Trade Binder', { title: 'Trade Binder', entries: [] })

      const result = await runCli(['rename', 'deck:Trade Binder', 'Whatever', '--collection'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("'deck:Trade Binder'")
      expect(result.stderr).toContain('--collection')
      expect(await exists(path.join(dir, 'collections', 'Trade Binder.md'))).toBe(true)
    })
  })

  test('a missing list is a not-found (exit 3)', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['rename', 'deck:missing', 'Whatever'], dir)
      expect(result.exitCode).toBe(3)
    })
  })
})

describe('delete CLI (Integration)', () => {
  test('deletes the deck file and all sidecars with a matching --confirm', async () => {
    await withWorkspace(async (dir) => {
      await seedDeckWithSidecars(dir)

      const result = await runCli(
        ['delete', 'deck:test', '--confirm', 'Test Deck', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)

      const decksDirForPayload = path.join(dir, 'decks')
      const payload = JSON.parse(result.stdout) as {
        type: string
        slug: string
        deleted: boolean
        deletedFiles: string[]
      }
      expect(payload).toEqual({
        type: 'deck',
        slug: 'test',
        deleted: true,
        deletedFiles: [
          path.join(decksDirForPayload, 'test.md'),
          path.join(decksDirForPayload, 'test.md.sha256'),
          path.join(decksDirForPayload, 'test.changes.md'),
          path.join(decksDirForPayload, 'test.primer.md'),
          path.join(decksDirForPayload, 'test.art.json'),
        ],
      })

      // Every file is gone — no sidecar is orphaned, the .sha256 and the
      // custom-art map included.
      const decksDir = path.join(dir, 'decks')
      expect(await exists(path.join(decksDir, 'test.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.md.sha256'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.changes.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.primer.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.art.json'))).toBe(false)
    })
  })

  test('a wrong --confirm name is refused and deletes nothing', async () => {
    await withWorkspace(async (dir) => {
      const filePath = await seedDeckWithSidecars(dir)

      const result = await runCli(['delete', 'deck:test', '--confirm', 'Wrong Name'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Expected 'Test Deck'")
      expect(await exists(filePath)).toBe(true)
    })
  })

  test('without a terminal, omitting --confirm is a usage error with a hint', async () => {
    await withWorkspace(async (dir) => {
      const filePath = await seedDeckWithSidecars(dir)

      const result = await runCli(['delete', 'deck:test'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--confirm')
      expect(await exists(filePath)).toBe(true)
    })
  })

  test('a type prefix contradicting a type flag is a usage error, deleting nothing', async () => {
    await withWorkspace(async (dir) => {
      await writeCollectionFile(dir, 'Trade Binder', { title: 'Trade Binder', entries: [] })

      const result = await runCli(
        ['delete', 'deck:Trade Binder', '--collection', '--confirm', 'Trade Binder'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--collection')
      expect(await exists(path.join(dir, 'collections', 'Trade Binder.md'))).toBe(true)
    })
  })

  test('a missing list is a not-found (exit 3)', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['delete', 'deck:missing', '--confirm', 'missing'], dir)
      expect(result.exitCode).toBe(3)
    })
  })
})
