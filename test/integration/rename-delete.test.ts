import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { withWorkspace, writeCollectionFile, writeDeckFile } from './helpers/workspace'

const exists = (filePath: string): Promise<boolean> => Bun.file(filePath).exists()

/** Seed deck `test` (display name 'Test Deck') with every sidecar type. */
async function seedDeckWithSidecars(dir: string): Promise<string> {
  const filePath = await writeDeckFile(dir, 'test', {
    frontMatter: { name: 'Test Deck', format: 'commander' },
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
  await fs.writeFile(`${filePath}.sha256`, 'stale-hash\n')
  await fs.writeFile(path.join(dir, 'decks', 'test.changes.md'), '# Changelog\n')
  await fs.writeFile(path.join(dir, 'decks', 'test.primer.md'), '# Primer\n')
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

      // Old file and sidecars are gone — including the stale .sha256.
      expect(await exists(path.join(decksDir, 'test.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.md.sha256'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.changes.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.primer.md'))).toBe(false)

      // New file with a fresh hash and the moved sidecars.
      expect(await exists(newPath)).toBe(true)
      expect(await exists(`${newPath}.sha256`)).toBe(true)
      expect(await exists(path.join(decksDir, 'Fresh Name.changes.md'))).toBe(true)
      expect(await exists(path.join(decksDir, 'Fresh Name.primer.md'))).toBe(true)

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
      }
      expect(payload).toEqual({
        type: 'collection',
        oldSlug: 'main',
        newSlug: 'main',
        name: 'main',
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

      const payload = JSON.parse(result.stdout) as { type: string; slug: string; deleted: boolean }
      expect(payload).toEqual({ type: 'deck', slug: 'test', deleted: true })

      // All four files are gone — the .sha256 sidecar is not orphaned.
      const decksDir = path.join(dir, 'decks')
      expect(await exists(path.join(decksDir, 'test.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.md.sha256'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.changes.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'test.primer.md'))).toBe(false)
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

  test('a missing list is a not-found (exit 3)', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['delete', 'deck:missing', '--confirm', 'missing'], dir)
      expect(result.exitCode).toBe(3)
    })
  })
})
