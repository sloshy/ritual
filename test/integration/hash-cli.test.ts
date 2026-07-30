import { describe, test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { computeHash, hashPath } from '../../src/content-hash'
import { runCli } from './helpers/cli'
import { withWorkspace, writeCollectionFile, writeDeckFile } from './helpers/workspace'

/** The parsed shape of one `--output json` payload entry (HashResult). */
type ParsedHashEntry = {
  file: string
  hash: string
}

type SeededLists = { deckPath: string; collectionPath: string }

/** Seed a deck and a collection. `hash` hashes files exactly as they are on disk. */
async function seedLists(dir: string): Promise<SeededLists> {
  const deckPath = await writeDeckFile(dir, 'test-deck', {
    frontMatter: { name: 'Test Deck', format: 'commander' },
    cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
  })
  const collectionPath = await writeCollectionFile(dir, 'binder', {
    entries: [{ name: 'Mana Crypt', set: '2xm', collectorNumber: '1', cardId: 1 }],
  })
  return { deckPath, collectionPath }
}

describe('hash CLI', () => {
  test('text mode prints per-file hashes and writes .sha256 sidecars', async () => {
    await withWorkspace(async (dir) => {
      const { deckPath, collectionPath } = await seedLists(dir)

      const result = await runCli(['hash'], dir)
      expect(result.exitCode).toBe(0)

      // Per-file lines are `<relpath>: <hash>`, followed by the footer.
      expect(result.stdout).toMatch(/^decks\/test-deck\.md: [0-9a-f]{64}$/m)
      expect(result.stdout).toMatch(/^collections\/binder\.md: [0-9a-f]{64}$/m)
      expect(result.stdout).toContain('\nHashed 2 files.\n')

      // Sidecars hold the hash of the file content.
      const deckContent = await fs.readFile(deckPath, 'utf-8')
      expect((await fs.readFile(hashPath(deckPath), 'utf-8')).trim()).toBe(computeHash(deckContent))
      const collectionContent = await fs.readFile(collectionPath, 'utf-8')
      expect((await fs.readFile(hashPath(collectionPath), 'utf-8')).trim()).toBe(
        computeHash(collectionContent),
      )
    })
  })

  test('--output json emits [{file, hash}] with absolute paths', async () => {
    await withWorkspace(async (dir) => {
      await seedLists(dir)

      const result = await runCli(['hash', '--output', 'json'], dir)
      expect(result.exitCode).toBe(0)

      const entries = JSON.parse(result.stdout) as ParsedHashEntry[]
      expect(entries).toHaveLength(2)
      for (const entry of entries) {
        expect(path.isAbsolute(entry.file)).toBe(true)
        expect(entry.hash).toMatch(/^[0-9a-f]{64}$/)
        const content = await fs.readFile(entry.file, 'utf-8')
        expect(entry.hash).toBe(computeHash(content))
      }
      const files = entries.map((entry) => entry.file)
      expect(files.some((file) => file.endsWith(path.join('decks', 'test-deck.md')))).toBe(true)
      expect(files.some((file) => file.endsWith(path.join('collections', 'binder.md')))).toBe(true)
    })
  })

  test('--dry-run prints hashes without writing sidecars', async () => {
    await withWorkspace(async (dir) => {
      const { deckPath, collectionPath } = await seedLists(dir)

      const result = await runCli(['hash', '--dry-run'], dir)
      expect(result.exitCode).toBe(0)

      expect(result.stdout).toMatch(/^\[dry-run\] decks\/test-deck\.md: [0-9a-f]{64}$/m)
      expect(result.stdout).toContain('\nWould hash 2 files.\n')

      expect(await Bun.file(hashPath(deckPath)).exists()).toBe(false)
      expect(await Bun.file(hashPath(collectionPath)).exists()).toBe(false)
    })
  })

  test('--quiet suppresses all text output but still writes sidecars', async () => {
    await withWorkspace(async (dir) => {
      const { deckPath } = await seedLists(dir)

      const result = await runCli(['hash', '--quiet'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')

      expect(await Bun.file(hashPath(deckPath)).exists()).toBe(true)
    })
  })
})
