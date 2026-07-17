import { describe, expect, test } from 'bun:test'
import { runCli } from './helpers/cli'
import {
  withWorkspace,
  writeCollectionFile,
  writeDeckFile,
  type CollectionFixture,
  type DeckFixture,
} from './helpers/workspace'

/**
 * End-to-end coverage for the shared cross-type list resolver, exercised through
 * `note` (a type-agnostic command). Verifies flagless cross-type resolution,
 * ambiguity failure + flag disambiguation, and conflicting-flag rejection.
 * Matching-tier semantics (case-insensitivity, substring fallback) are covered
 * by test/unit/resolve-list.test.ts.
 */

const DECK: DeckFixture = {
  frontMatter: { name: 'Goblins' },
  cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
}
const COLLECTION: CollectionFixture = {
  title: 'staples',
  entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
}

describe('cross-type list resolution (Integration)', () => {
  test('resolves a unique name across types without a type flag', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'goblins', DECK)
      const result = await runCli(
        ['note', 'goblins', 'Sol', 'Ring', '--note', 'ramp', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { type: string; note: string }
      expect(json.type).toBe('deck')
      expect(json.note).toBe('ramp')
    })
  })

  test('fails with a usage error when a name is ambiguous across types', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'staples', DECK)
      await writeCollectionFile(dir, 'staples', COLLECTION)
      const result = await runCli(
        ['note', 'staples', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('ambiguous')
      expect(err.error.message).toContain('--deck, --collection, or --wanted')
    })
  })

  test('a type flag disambiguates an otherwise-ambiguous name', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'staples', DECK)
      await writeCollectionFile(dir, 'staples', COLLECTION)
      const result = await runCli(
        ['note', '--collection', 'staples', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { type: string }
      expect(json.type).toBe('collection')
    })
  })

  test('rejects conflicting type flags with a usage error', async () => {
    await withWorkspace(async (dir) => {
      await writeDeckFile(dir, 'staples', DECK)
      const result = await runCli(
        [
          'note',
          '--deck',
          '--collection',
          'staples',
          'Sol',
          'Ring',
          '--note',
          'x',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('only one of --deck, --collection, or --wanted')
    })
  })
})
