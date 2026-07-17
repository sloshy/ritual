import { describe, expect, test } from 'bun:test'
import { runCli } from './helpers/cli'
import {
  withWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
} from './helpers/workspace'

async function seedLists(dir: string): Promise<void> {
  await writeDeckFile(dir, 'burn', { frontMatter: { name: 'Burn' }, cards: [] })
  await writeDeckFile(dir, 'stax', { frontMatter: { name: 'Winota Stax' }, cards: [] })
  await writeCollectionFile(dir, 'main', { title: 'Main Binder', entries: [] })
  await writeWantedFile(dir, 'needs', { title: 'Needs', entries: [] })
}

describe('lists CLI (Integration)', () => {
  test('prints one aligned row per list: type, slug, display name', async () => {
    await withWorkspace(async (dir) => {
      await seedLists(dir)
      const result = await runCli(['lists'], dir)
      expect(result.exitCode).toBe(0)

      const lines = result.stdout.trimEnd().split('\n')
      expect(lines).toEqual([
        'deck        burn   Burn',
        'deck        stax   Winota Stax',
        'collection  main   Main Binder',
        'wanted      needs  Needs',
      ])
    })
  })

  test('type flags restrict the output to one list type', async () => {
    await withWorkspace(async (dir) => {
      await seedLists(dir)
      const result = await runCli(['lists', '--collection'], dir)
      expect(result.exitCode).toBe(0)

      expect(result.stdout).toContain('Main Binder')
      expect(result.stdout).not.toContain('Burn')
      expect(result.stdout).not.toContain('Needs')
    })
  })

  test('conflicting type flags are a usage error', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['lists', '--deck', '--collection'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('only one of --deck, --collection, or --wanted')
    })
  })

  test('--output json emits {type, slug, name} rows', async () => {
    await withWorkspace(async (dir) => {
      await seedLists(dir)
      const result = await runCli(['lists', '--deck', '--output', 'json'], dir)
      expect(result.exitCode).toBe(0)

      const rows = JSON.parse(result.stdout) as { type: string; slug: string; name: string }[]
      expect(rows).toEqual([
        { type: 'deck', slug: 'burn', name: 'Burn' },
        { type: 'deck', slug: 'stax', name: 'Winota Stax' },
      ])
    })
  })

  test('an empty workspace exits 0 with a placeholder (text) and [] (json)', async () => {
    await withWorkspace(async (dir) => {
      const text = await runCli(['lists'], dir)
      expect(text.exitCode).toBe(0)
      expect(text.stdout.trim()).toBe('(no lists)')

      const json = await runCli(['lists', '--output', 'json'], dir)
      expect(json.exitCode).toBe(0)
      expect(JSON.parse(json.stdout)).toEqual([])
    })
  })
})
