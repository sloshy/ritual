import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { applyChangesToCollectionFile } from '../../src/list-mutate'
import { createAddChange, createRemoveChange } from '../../src/change-event'
import { withTempDir } from './helpers/cli'

async function writeList(dir: string, relative: string, content: string): Promise<string> {
  const filePath = path.join(dir, relative)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
  return filePath
}

describe('applyChangesToCollectionFile (Integration)', () => {
  test('aborts before writing anything when a change misses its target', async () => {
    await withTempDir(async (dir) => {
      const filePath = await writeList(
        dir,
        'collections/Binder.md',
        '# Binder\n\n- Lightning Bolt (LEA:161) &1\n',
      )
      const before = await fs.readFile(filePath, 'utf-8')

      let thrown: unknown
      try {
        await applyChangesToCollectionFile(filePath, [createRemoveChange('Sol Ring')])
      } catch (error) {
        thrown = error
      }
      expect(String(thrown)).toMatch(/matched no card[\s\S]*Nothing was saved/)

      // File, sidecar, and changelog are all untouched.
      expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
      expect(await fs.exists(`${filePath}.sha256`)).toBe(false)
      expect(await fs.exists(path.join(dir, 'collections/Binder.changes.md'))).toBe(false)
    })
  })

  test('add stamps a pool-allocated id, writes sidecar and changelog, and rejects moves', async () => {
    await withTempDir(async (dir) => {
      const filePath = await writeList(
        dir,
        'collections/Binder.md',
        '# Binder\n\n- Lightning Bolt (LEA:161) &1\n',
      )

      const result = await applyChangesToCollectionFile(filePath, [
        createAddChange('Sol Ring', { set: 'c21', collectorNumber: '263' }),
      ])

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Sol Ring (C21:263) &2')
      expect(result.writtenFiles).toContain(filePath)
      expect((await fs.readFile(`${filePath}.sha256`, 'utf-8')).trim()).toHaveLength(64)
      const changelog = await fs.readFile(path.join(dir, 'collections/Binder.changes.md'), 'utf-8')
      expect(changelog).toContain('Added "Sol Ring" (C21:263) &2')

      const move = {
        ...createRemoveChange('Sol Ring', { cardId: 2 }),
        action: 'move-from' as const,
      }
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's rejects matcher resolves at runtime but its type doesn't expose Promise.
      await expect(applyChangesToCollectionFile(filePath, [move as never])).rejects.toThrow(
        'does not handle move events',
      )
    })
  })

  test('add without a printing throws and leaves the file untouched', async () => {
    await withTempDir(async (dir) => {
      const original = '# Binder\n\n- Lightning Bolt (LEA:161) &1\n'
      const filePath = await writeList(dir, 'collections/Binder.md', original)

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's rejects matcher resolves at runtime but its type doesn't expose Promise.
      await expect(
        applyChangesToCollectionFile(filePath, [createAddChange('Sol Ring', { cardId: 2 })]),
      ).rejects.toThrow('Cannot add "Sol Ring" to a collection without set and collector number')

      expect(await fs.readFile(filePath, 'utf-8')).toBe(original)
    })
  })
})

describe('applyChangesToCollectionFile — front matter and labels', () => {
  test('a whole-file apply preserves the front-matter block and label tokens', async () => {
    await withTempDir(async (dir) => {
      const filePath = await writeList(
        dir,
        'collections/Binder.md',
        '---\nlabels: [sale]\n---\n\n# Binder\n\n## Main\n- Lightning Bolt (LEA:161) [keep] &1\n',
      )

      await applyChangesToCollectionFile(filePath, [
        createAddChange('Sol Ring', { set: 'c21', collectorNumber: '263' }),
      ])

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content.startsWith('---\nlabels: [sale]\n---\n\n# Binder')).toBe(true)
      expect(content).toContain('- Lightning Bolt (LEA:161) [keep] &1')
      expect(content).toContain('- Sol Ring (C21:263) &2')
    })
  })
})
