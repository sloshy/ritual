import { describe, test, expect } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildVirtualState,
  applyVirtualRemove,
  commitAllRemovals,
} from '../../src/commands/move-helpers'
import type { PhysicalCard, ListEntry } from '../../src/commands/move-helpers'

describe('commitAllRemovals', () => {
  test('returns 0 when nothing is marked for removal', async () => {
    const listEntry: ListEntry = { ref: { type: 'deck', name: 'A' }, filePath: '/fake/decks/A.md' }
    const card: PhysicalCard = {
      key: `${listEntry.filePath}:1:0`,
      name: 'Card',
      cardId: 1,
      listEntry,
    }
    const state = buildVirtualState([card])
    const { removed, writtenFiles } = await commitAllRemovals(state)
    expect(removed).toBe(0)
    expect(writtenFiles).toEqual([])
  })

  test('removes cards from multiple lists atomically and writes changelogs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remove-test-'))
    try {
      const collPath = path.join(tmpDir, 'coll.md')
      const wantedPath = path.join(tmpDir, 'wanted.md')
      await fs.writeFile(
        collPath,
        '# Collection\n\n- Lightning Bolt (LEA:7) [foil] &1\n- Sol Ring (2xm:123) &2\n',
      )
      await fs.writeFile(wantedPath, '# Wanted\n\n- Dark Ritual (lea:100) &5\n')

      const collList: ListEntry = {
        ref: { type: 'collection', name: 'Collection' },
        filePath: collPath,
      }
      const wantedList: ListEntry = {
        ref: { type: 'wanted', name: 'Wanted' },
        filePath: wantedPath,
      }

      const bolt: PhysicalCard = {
        key: `${collPath}:1:0`,
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '7',
        finish: 'foil',
        cardId: 1,
        listEntry: collList,
      }
      const ritual: PhysicalCard = {
        key: `${wantedPath}:5:0`,
        name: 'Dark Ritual',
        set: 'lea',
        collectorNumber: '100',
        cardId: 5,
        listEntry: wantedList,
      }
      const solRing: PhysicalCard = {
        key: `${collPath}:2:0`,
        name: 'Sol Ring',
        set: '2xm',
        collectorNumber: '123',
        cardId: 2,
        listEntry: collList,
      }
      const state = buildVirtualState([bolt, ritual, solRing])

      // Remove the bolt and the ritual; leave Sol Ring.
      applyVirtualRemove(state, bolt.key)
      applyVirtualRemove(state, ritual.key)

      const { removed, writtenFiles } = await commitAllRemovals(state)
      expect(removed).toBe(2)
      expect(writtenFiles).toContain(collPath)
      expect(writtenFiles).toContain(wantedPath)
      expect(writtenFiles).toContain(collPath.replace('.md', '.changes.md'))

      const collContent = await fs.readFile(collPath, 'utf-8')
      expect(collContent).not.toContain('Lightning Bolt')
      expect(collContent).toContain('Sol Ring') // untouched

      const wantedContent = await fs.readFile(wantedPath, 'utf-8')
      expect(wantedContent).not.toContain('Dark Ritual')

      const collChanges = await fs.readFile(collPath.replace('.md', '.changes.md'), 'utf-8')
      expect(collChanges).toContain('Lightning Bolt')

      // Both source lists get a changelog, including the wanted list.
      expect(writtenFiles).toContain(wantedPath.replace('.md', '.changes.md'))
      const wantedChanges = await fs.readFile(wantedPath.replace('.md', '.changes.md'), 'utf-8')
      expect(wantedChanges).toContain('Dark Ritual')
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })

  test('skips a card that no longer resolves and reports the rest', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remove-test-'))
    try {
      const collPath = path.join(tmpDir, 'coll.md')
      await fs.writeFile(collPath, '# Collection\n\n- Real Card (LEA:1) &1\n')
      const collList: ListEntry = {
        ref: { type: 'collection', name: 'Collection' },
        filePath: collPath,
      }
      const ghost: PhysicalCard = {
        key: `${collPath}:99:0`,
        name: 'Ghost Card',
        set: 'lea',
        collectorNumber: '9',
        cardId: 99,
        listEntry: collList,
      }
      const state = buildVirtualState([ghost])
      applyVirtualRemove(state, ghost.key)

      const { removed } = await commitAllRemovals(state)
      expect(removed).toBe(0)
      const content = await fs.readFile(collPath, 'utf-8')
      expect(content).toContain('Real Card')
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })
})
