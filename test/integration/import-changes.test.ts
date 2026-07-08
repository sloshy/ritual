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

const TEST_DECK = `---
name: "Test Deck"
format: "commander"
---

# Test Deck

## Main

1 Lightning Bolt &1
1 Sol Ring &2
`

const BUNDLE = {
  format: 'ritual-change-bundle',
  version: 1,
  exportedAt: '2026-06-04T00:00:00.000Z',
  lists: [
    {
      kind: 'deck',
      slug: 'test-deck',
      name: 'Test Deck',
      changes: [
        { id: 'a1', timestamp: 1, action: 'add', cardName: 'Counterspell' },
        { id: 'r1', timestamp: 2, action: 'remove', cardName: 'Lightning Bolt', cardId: 1 },
        { id: 'r2', timestamp: 3, action: 'remove', cardName: 'Not In Deck', cardId: 99 },
      ],
    },
    {
      kind: 'wanted',
      slug: 'wishlist',
      name: 'Wishlist',
      changes: [{ id: 'a2', timestamp: 4, action: 'add', cardName: 'Brainstorm' }],
    },
  ],
}

/**
 * Seed the workspace lists and mark the card cache freshly bulk-downloaded, so
 * the spawned binary's list loads fetch (at most) the few named cards from
 * Scryfall instead of triggering a full bulk download.
 */
async function seedWorkspace(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wanted'), { recursive: true })
  await fs.writeFile(path.join(dir, 'decks', 'test-deck.md'), TEST_DECK)
  await fs.writeFile(path.join(dir, 'wanted', 'wishlist.md'), '# Wishlist\n\n')

  const originalBase = getBaseDir()
  setBaseDir(dir)
  try {
    await cardCache.bulkSet({})
  } finally {
    setBaseDir(originalBase)
  }
}

describe('import-changes command (Integration)', () => {
  test('previews and applies a multi-list bundle with --yes, reporting conflicts', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      const bundlePath = path.join(dir, 'edits.json')
      await fs.writeFile(bundlePath, JSON.stringify(BUNDLE, null, 2))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)

      expect(result.exitCode).toBe(0)
      // The preview lists every pending change grouped by target list.
      expect(result.stdout).toContain("Test Deck (deck 'test-deck') — 3 changes")
      expect(result.stdout).toContain('Add Counterspell')
      expect(result.stdout).toContain('Remove Lightning Bolt')
      expect(result.stdout).toContain("Wishlist (wanted list 'wishlist') — 1 change")
      // Applied counts plus the skipped conflict for the missing card.
      expect(result.stdout).toContain('applied 2 changes')
      expect(result.stdout).toContain('applied 1 change')
      expect(result.stdout).toContain('Skipped (card not found): Remove Not In Deck')

      const deck = await fs.readFile(path.join(dir, 'decks', 'test-deck.md'), 'utf-8')
      expect(deck).toMatch(/Counterspell &\d+/)
      expect(deck).not.toContain('Lightning Bolt')
      expect(deck).toContain('Sol Ring &2')

      const wanted = await fs.readFile(path.join(dir, 'wanted', 'wishlist.md'), 'utf-8')
      expect(wanted).toMatch(/Brainstorm &\d+/)

      // Each applied list gets a changelog entry.
      const deckLog = await fs.readFile(path.join(dir, 'decks', 'test-deck.changes.md'), 'utf-8')
      expect(deckLog).toContain('Counterspell')
    })
  }, 60_000)

  test('exits non-zero when a list in the bundle does not exist, still applying the rest', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      const bundle = {
        ...BUNDLE,
        lists: [
          {
            kind: 'collection',
            slug: 'no-such-collection',
            name: 'Ghost',
            changes: [{ id: 'a1', timestamp: 1, action: 'add', cardName: 'Sol Ring' }],
          },
          BUNDLE.lists[1],
        ],
      }
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(bundle))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No collections found')
      const wanted = await fs.readFile(path.join(dir, 'wanted', 'wishlist.md'), 'utf-8')
      expect(wanted).toContain('Brainstorm')
    })
  }, 60_000)

  test('applies a public-site export whose slug is a slugified display name', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      // A collection file named after its display name, as on disk.
      await fs.mkdir(path.join(dir, 'collections'), { recursive: true })
      await fs.writeFile(
        path.join(dir, 'collections', 'Red Binder.md'),
        '# Red Binder\n\n- Sol Ring (C21:263) [NM] &1\n',
      )

      // The public site exports the slug as a URL-slugified display name
      // ("Red Binder" -> "red-binder"), which is not the file basename.
      const bundle = {
        ...BUNDLE,
        lists: [
          {
            kind: 'collection',
            slug: 'red-binder',
            name: 'Red Binder',
            changes: [
              {
                id: 'r1',
                timestamp: 1,
                action: 'remove',
                cardName: 'Sol Ring',
                cardId: 1,
                set: 'c21',
                collectorNumber: '263',
              },
            ],
          },
        ],
      }
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(bundle))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).not.toContain('not found')
      expect(result.stdout).toContain('applied 1 change')

      const collection = await fs.readFile(path.join(dir, 'collections', 'Red Binder.md'), 'utf-8')
      expect(collection).not.toContain('Sol Ring')
    })
  }, 60_000)

  test('rejects a file that is not a change bundle', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'nope.json'), '{"format":"other"}')
      const result = await runCli(['import-changes', 'nope.json', '--yes'], dir)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Invalid change bundle')
    })
  })

  test('reports a missing file with a readable error', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['import-changes', 'absent.json', '--yes'], dir)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("Cannot read 'absent.json'")
    })
  })

  test('treats an export with no changes as a no-op', async () => {
    await withTempDir(async (dir) => {
      const empty = { ...BUNDLE, lists: [] }
      await fs.writeFile(path.join(dir, 'empty.json'), JSON.stringify(empty))
      const result = await runCli(['import-changes', 'empty.json'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('no changes to apply')
    })
  })
})
