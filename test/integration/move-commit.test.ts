import { describe, test, expect } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildVirtualState,
  applyVirtualMove,
  commitAllMoves,
} from '../../src/commands/move-helpers'
import type { PhysicalCard, ListEntry } from '../../src/commands/move-helpers'

// ── commitAllMoves ─────────────────────────────────────────────────────────────

describe('commitAllMoves', () => {
  test('returns 0 when there are no pending moves', async () => {
    const listEntry: ListEntry = {
      ref: { type: 'deck', name: 'A' },
      filePath: `/fake/decks/A.md`,
    }
    const card: PhysicalCard = {
      key: `${listEntry.filePath}:Card:0`,
      name: 'Card',
      set: 'lea',
      collectorNumber: '1',
      cardId: 1,
      listEntry,
    }
    const state = buildVirtualState([card])

    const { moved } = await commitAllMoves(state)
    expect(moved).toBe(0)
  })

  test('moves a card from a collection to another collection', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'move-test-'))

    try {
      // Source: a collection with one card
      const srcPath = path.join(tmpDir, 'src.md')
      const dstPath = path.join(tmpDir, 'dst.md')
      await fs.writeFile(srcPath, '# Source\n\n- Lightning Bolt (LEA:7) [foil] &1\n')
      await fs.writeFile(dstPath, '# Dest\n\n')

      const srcList: ListEntry = { ref: { type: 'collection', name: 'Source' }, filePath: srcPath }
      const dstList: ListEntry = { ref: { type: 'collection', name: 'Dest' }, filePath: dstPath }

      const card: PhysicalCard = {
        key: `${srcPath}:1:0`,
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '7',
        finish: 'foil',
        cardId: 1,
        listEntry: srcList,
      }
      const state = buildVirtualState([card])
      applyVirtualMove(state, card.key, dstList)

      const { moved, writtenFiles } = await commitAllMoves(state)
      expect(moved).toBe(1)

      // The written-files set covers both list files and both changelogs (for git staging).
      expect(writtenFiles).toContain(srcPath)
      expect(writtenFiles).toContain(dstPath)
      expect(writtenFiles).toContain(srcPath.replace('.md', '.changes.md'))
      expect(writtenFiles).toContain(dstPath.replace('.md', '.changes.md'))

      // Source file should no longer contain the card
      const srcContent = await fs.readFile(srcPath, 'utf-8')
      expect(srcContent).not.toContain('Lightning Bolt')

      // Destination file should contain the card
      const dstContent = await fs.readFile(dstPath, 'utf-8')
      expect(dstContent).toContain('Lightning Bolt')

      // Changelogs should be created
      const srcChanges = await fs.readFile(srcPath.replace('.md', '.changes.md'), 'utf-8')
      expect(srcChanges).toContain('Moved "Lightning Bolt"')
      expect(srcChanges).toContain("to Collection 'Dest'")

      const dstChanges = await fs.readFile(dstPath.replace('.md', '.changes.md'), 'utf-8')
      expect(dstChanges).toContain('Moved "Lightning Bolt"')
      expect(dstChanges).toContain("from Collection 'Source'")
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })

  test('moves a card from a wanted list to a collection', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'move-test-'))

    try {
      const wantedPath = path.join(tmpDir, 'wanted.md')
      const collPath = path.join(tmpDir, 'coll.md')
      await fs.writeFile(wantedPath, '# Wanted\n\n- Sol Ring (2xm:123) &3\n')
      await fs.writeFile(collPath, '# Collection\n\n')

      const wantedList: ListEntry = {
        ref: { type: 'wanted', name: 'Wanted' },
        filePath: wantedPath,
      }
      const collList: ListEntry = {
        ref: { type: 'collection', name: 'Collection' },
        filePath: collPath,
      }

      const card: PhysicalCard = {
        key: `${wantedPath}:3:0`,
        name: 'Sol Ring',
        set: '2xm',
        collectorNumber: '123',
        cardId: 3,
        listEntry: wantedList,
      }
      const state = buildVirtualState([card])
      applyVirtualMove(state, card.key, collList)

      const { moved } = await commitAllMoves(state)
      expect(moved).toBe(1)

      const wantedContent = await fs.readFile(wantedPath, 'utf-8')
      expect(wantedContent).not.toContain('Sol Ring')

      const collContent = await fs.readFile(collPath, 'utf-8')
      expect(collContent).toContain('Sol Ring')
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })

  test('chained move is committed from original source to final destination', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'move-test-'))

    try {
      const pathA = path.join(tmpDir, 'a.md')
      const pathB = path.join(tmpDir, 'b.md')
      const pathC = path.join(tmpDir, 'c.md')

      await fs.writeFile(pathA, '# A\n\n- Dark Ritual (lea:100) &5\n')
      await fs.writeFile(pathB, '# B\n\n')
      await fs.writeFile(pathC, '# C\n\n')

      const listA: ListEntry = { ref: { type: 'collection', name: 'A' }, filePath: pathA }
      const listB: ListEntry = { ref: { type: 'collection', name: 'B' }, filePath: pathB }
      const listC: ListEntry = { ref: { type: 'collection', name: 'C' }, filePath: pathC }

      const card: PhysicalCard = {
        key: `${pathA}:5:0`,
        name: 'Dark Ritual',
        set: 'lea',
        collectorNumber: '100',
        cardId: 5,
        listEntry: listA,
      }
      const state = buildVirtualState([card])

      // Chain: A → B → C
      applyVirtualMove(state, card.key, listB)
      applyVirtualMove(state, card.key, listC)

      await commitAllMoves(state)

      // A should have the card removed
      const contentA = await fs.readFile(pathA, 'utf-8')
      expect(contentA).not.toContain('Dark Ritual')

      // C should have the card added
      const contentC = await fs.readFile(pathC, 'utf-8')
      expect(contentC).toContain('Dark Ritual')

      // B should be unchanged (never actually written to)
      const contentB = await fs.readFile(pathB, 'utf-8')
      expect(contentB).not.toContain('Dark Ritual')

      // Changelog for A should say moved to C (not B)
      const changesA = await fs.readFile(pathA.replace('.md', '.changes.md'), 'utf-8')
      expect(changesA).toContain("to Collection 'C'")
      expect(changesA).not.toContain("to Collection 'B'")
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })

  test('failed removal does not add card to destination', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'move-test-'))

    try {
      const srcPath = path.join(tmpDir, 'src.md')
      const dstPath = path.join(tmpDir, 'dst.md')
      // Source file does NOT contain the card we're trying to move
      await fs.writeFile(srcPath, '# Source\n\n- Some Other Card (LEA:1) &1\n')
      await fs.writeFile(dstPath, '# Dest\n\n')

      const srcList: ListEntry = { ref: { type: 'collection', name: 'Source' }, filePath: srcPath }
      const dstList: ListEntry = { ref: { type: 'collection', name: 'Dest' }, filePath: dstPath }

      // The card we're moving doesn't exist in the source (different ID)
      const card: PhysicalCard = {
        key: `${srcPath}:99:0`,
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '7',
        cardId: 99,
        listEntry: srcList,
      }
      const state = buildVirtualState([card])
      applyVirtualMove(state, card.key, dstList)

      const { moved } = await commitAllMoves(state)
      expect(moved).toBe(0)

      // Destination must not have the card added
      const dstContent = await fs.readFile(dstPath, 'utf-8')
      expect(dstContent).not.toContain('Lightning Bolt')

      // Source is unchanged
      const srcContent = await fs.readFile(srcPath, 'utf-8')
      expect(srcContent).toContain('Some Other Card')
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })

  test('missing destination file aborts before mutating source', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'move-test-'))

    try {
      const srcPath = path.join(tmpDir, 'src.md')
      const dstPath = path.join(tmpDir, 'nonexistent-dest.md') // does not exist
      await fs.writeFile(srcPath, '# Source\n\n- Sol Ring (2xm:123) [foil] &2\n')

      const srcList: ListEntry = { ref: { type: 'collection', name: 'Source' }, filePath: srcPath }
      const dstList: ListEntry = {
        ref: { type: 'collection', name: 'Dest' },
        filePath: dstPath,
      }

      const card: PhysicalCard = {
        key: `${srcPath}:2:0`,
        name: 'Sol Ring',
        set: '2xm',
        collectorNumber: '123',
        finish: 'foil',
        cardId: 2,
        listEntry: srcList,
      }
      const state = buildVirtualState([card])
      applyVirtualMove(state, card.key, dstList)

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
      await expect(commitAllMoves(state)).rejects.toThrow('Destination file not found')

      // Source must be completely untouched — card was never removed
      const srcContent = await fs.readFile(srcPath, 'utf-8')
      expect(srcContent).toContain('Sol Ring')
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })
})
