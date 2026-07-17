import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { applyChangesToListFile } from '../../src/list-mutate'
import { createRemoveChange, createSetPrintingChange } from '../../src/change-event'
import { withTempDir } from './helpers/cli'
import { setBaseDir } from '../../src/base-dir'

async function writeList(dir: string, relative: string, content: string): Promise<string> {
  const filePath = path.join(dir, relative)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
  return filePath
}

describe('applyChangesToListFile (Integration)', () => {
  test('deck remove decrements quantity, writes sidecar and changelog', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      const filePath = await writeList(
        dir,
        'decks/Burn.md',
        '## Main\n\n2 Lightning Bolt &1\n1 Fireblast &2\n',
      )

      const result = await applyChangesToListFile('deck', filePath, [
        createRemoveChange('Lightning Bolt', { cardId: 1 }),
      ])

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('1 Lightning Bolt &1')
      expect(content).toContain('1 Fireblast &2')
      expect(result.writtenFiles).toContain(filePath)
      expect((await fs.readFile(`${filePath}.sha256`, 'utf-8')).trim()).toHaveLength(64)
      const changelog = await fs.readFile(path.join(dir, 'decks/Burn.changes.md'), 'utf-8')
      expect(changelog).toContain('Lightning Bolt')
    })
  })

  test('collection set-printing rewrites the entry line', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      const filePath = await writeList(
        dir,
        'collections/Binder.md',
        '# Binder\n\n- Lightning Bolt (LEA:161) [NM] &1\n',
      )

      await applyChangesToListFile('collection', filePath, [
        createSetPrintingChange('Lightning Bolt', {
          set: '2xm',
          collectorNumber: '117',
          cardId: 1,
        }),
      ])

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('(2XM:117)')
      expect(content).not.toContain('(LEA:161)')
    })
  })

  test('wanted remove deletes the entry and rejects move events', async () => {
    await withTempDir(async (dir) => {
      setBaseDir(dir)
      const filePath = await writeList(
        dir,
        'wanted/Wants.md',
        '# Wants\n\n- Lightning Bolt &1\n- Fireblast &2\n',
      )

      await applyChangesToListFile('wanted', filePath, [
        createRemoveChange('Lightning Bolt', { cardId: 1 }),
      ])

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).not.toContain('Lightning Bolt')
      expect(content).toContain('Fireblast')

      const move = {
        ...createRemoveChange('Fireblast', { cardId: 2 }),
        action: 'move-from' as const,
      }
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's rejects matcher resolves at runtime but its type doesn't expose Promise.
      await expect(applyChangesToListFile('wanted', filePath, [move as never])).rejects.toThrow(
        'does not handle move events',
      )
    })
  })
})
