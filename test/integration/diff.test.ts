import { describe, expect, test } from 'bun:test'
import { runCli, withTempDir } from './helpers/cli'
import { writeCollectionFile, writeDeckFile } from './helpers/workspace'

type DiffJsonBody = {
  a: { listType: string; slug: string; name: string }
  b: { listType: string; slug: string; name: string }
  by: string
  matches: { name: string; a: { quantity: number }; b: { quantity: number } }[]
  onlyInA: { name: string; quantity: number }[]
  onlyInB: { name: string; quantity: number }[]
  warnings: string[]
}

/**
 * Seed a deck and a collection with a partial overlap (Lightning Bolt LEA:161
 * on both sides, 2 copies vs 1). No card-cache seeding is needed: `diff` never
 * touches the cache and, as a read-only command, never runs the card-ID backfill.
 */
async function seedWorkspace(dir: string): Promise<void> {
  await writeDeckFile(dir, 'burn', {
    frontMatter: { name: 'Burn' },
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
          {
            quantity: 1,
            name: 'Fireblast',
            set: 'vis',
            collectorNumber: '78',
            finish: 'foil',
            cardId: 2,
          },
        ],
      },
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Price of Progress', cardId: 3 }] },
    ],
  })
  await writeCollectionFile(dir, 'binder', {
    title: 'Binder',
    entries: [
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', finish: 'foil', cardId: 2 },
    ],
  })
}

describe('diff command (Integration)', () => {
  test('diffs a deck against a collection by name, exiting 0 despite differences', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      const result = await runCli(['diff', 'burn', 'binder'], dir)

      expect(result.exitCode).toBe(0)
      // Maybeboard extras are included; set codes render uppercase.
      expect(result.stdout).toContain('Only in Burn (2)')
      expect(result.stdout).toContain('1 Fireblast (VIS:78 [foil] x1)')
      expect(result.stdout).toContain('1 Price of Progress')
      expect(result.stdout).toContain('Only in Binder (1)')
      expect(result.stdout).toContain('1 Sol Ring (C21:263 [foil] x1)')
      expect(result.stdout).toContain('Different quantities (1)')
      expect(result.stdout).toContain('Lightning Bolt: 2 in Burn, 1 in Binder')
    })
  }, 60_000)

  test('--by printing separates finishes and reports identical lists', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      const result = await runCli(['diff', 'burn', 'binder', '--by', 'printing'], dir)

      expect(result.exitCode).toBe(0)
      // The shared LEA:161 printing matches with a quantity mismatch.
      expect(result.stdout).toContain('Different quantities (1)')
      expect(result.stdout).toContain('Lightning Bolt (LEA:161): 2 in Burn, 1 in Binder')
      expect(result.stdout).toContain('1 Fireblast (VIS:78) [foil]')

      const identical = await runCli(['diff', 'burn', 'burn', '--by', 'printing'], dir)
      expect(identical.exitCode).toBe(0)
      expect(identical.stdout).toContain('Lists are identical by printing.')
    })
  }, 60_000)

  test('a name shared across list types is a usage error hinting the type: prefix', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      await writeCollectionFile(dir, 'burn', { title: 'Burn', entries: [] })

      const result = await runCli(['diff', 'burn', 'binder'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('ambiguous')
      expect(result.stderr).toContain('deck:burn')
      expect(result.stderr).toContain('collection:burn')
    })
  }, 60_000)

  test('--output json emits the full result body with list identities', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      const result = await runCli(['diff', 'deck:burn', 'binder', '--output', 'json'], dir)

      expect(result.exitCode).toBe(0)
      const body = JSON.parse(result.stdout) as DiffJsonBody
      expect(body.a).toEqual({ listType: 'deck', slug: 'burn', name: 'Burn' })
      expect(body.b).toEqual({ listType: 'collection', slug: 'binder', name: 'Binder' })
      expect(body.by).toBe('name')
      expect(body.matches.map((m) => m.name)).toEqual(['Lightning Bolt'])
      expect(body.matches[0]?.a.quantity).toBe(2)
      expect(body.matches[0]?.b.quantity).toBe(1)
      expect(body.onlyInA.map((o) => o.name)).toEqual(['Fireblast', 'Price of Progress'])
      expect(body.onlyInB.map((o) => o.name)).toEqual(['Sol Ring'])
      expect(body.warnings).toEqual([])
    })
  }, 60_000)

  test('an invalid --by mode is a usage error', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)

      const result = await runCli(['diff', 'burn', 'binder', '--by', 'set'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Use 'name' or 'printing'")
    })
  }, 60_000)
})
