import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  applyFlatListChange,
  flatListTargetSection,
  loadCollectionSession,
  loadWantedSession,
  persistFlatListSession,
} from '../../src/commands/session/flat-list-session'
import { allocateId } from '../../src/card/card-id'
import {
  createAddChange,
  createSetNoteChange,
  createSetPrintingChange,
} from '../../src/changes/change-event'
import { artSidecarPath, loadCardArt, saveCardArt, type CardArtRef } from '../../src/list/card-art'
import { createCardSessionContext } from '../../src/commands/session/strategy'
import {
  performFlatListMove,
  performFlatListRemoval,
  undoFlatListEdit,
} from '../../src/commands/session/flat-list-edit'
import type {
  CollectionSession,
  FlatListStrategyContext,
} from '../../src/commands/session/flat-list-session'
import type { CollectionCardEntry } from '../../src/list/site-data'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'

describe('flat-list session models', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await removeWorkspace(tmpDir)
  })

  async function writeList(name: string, content: string): Promise<string> {
    const filePath = path.join(tmpDir, name)
    await fs.writeFile(filePath, content)
    return filePath
  }

  describe('collection session', () => {
    test('add appends a canonical line to the last section and reuses pooled IDs', async () => {
      // ID 2 is missing, so the pool should hand it out before going sequential.
      const original =
        '# My Binder\n\n## Trade\n- Sol Ring (C19:221) [foil] [NM] &1\n\n## Keep\n- Lightning Bolt (LEA:161) &3\n'
      const filePath = await writeList('binder.md', original)
      const session = await loadCollectionSession(filePath)

      expect(session.title).toBe('My Binder')
      expect(flatListTargetSection(session)).toBe('Keep')
      expect(session.dirty).toBe(false)

      const cardId = allocateId(session.pool)
      expect(cardId).toBe(2)

      applyFlatListChange(
        session,
        createAddChange('Mana Crypt', {
          set: '2xm',
          collectorNumber: '270',
          finish: 'foil',
          condition: 'NM',
          cardId,
          section: flatListTargetSection(session),
        }),
      )

      // Changes stay in memory until the session is explicitly saved.
      expect(session.dirty).toBe(true)
      expect(await fs.readFile(filePath, 'utf-8')).toBe(original)

      await persistFlatListSession(session)
      expect(session.dirty).toBe(false)

      // Like an admin save, re-serialization drops the default NM condition token
      // (the explicit [NM] on the original Sol Ring line normalizes away).
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe(
        '# My Binder\n\n## Trade\n- Sol Ring (C19:221) [foil] &1\n\n## Keep\n- Lightning Bolt (LEA:161) &3\n- Mana Crypt (2XM:270) [foil] &2\n',
      )
    })

    test('set-note and set-printing target entries by card ID, not file position', async () => {
      const filePath = await writeList(
        'binder.md',
        '# Binder\n\n- Sol Ring (C19:221) &1\n- Lightning Bolt (LEA:161) &2\n',
      )
      const session = await loadCollectionSession(filePath)

      // Target the FIRST entry even though another card was added after it.
      applyFlatListChange(session, createSetNoteChange('Sol Ring', { note: 'signed', cardId: 1 }))
      applyFlatListChange(
        session,
        createSetPrintingChange('Sol Ring', {
          set: 'ltc',
          collectorNumber: '284',
          finish: 'foil',
          condition: 'LP',
          cardId: 1,
        }),
      )
      await persistFlatListSession(session)

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Sol Ring (LTC:284) [foil] [LP] {signed} &1\n')
      expect(content).toContain('- Lightning Bolt (LEA:161) &2\n')
    })

    test('a malformed entry is skipped with a warning, not silently mangled', async () => {
      // A bare name line is not part of the collection grammar (no set/CN).
      const filePath = await writeList(
        'binder.md',
        '# Binder\n\n- Nameless Card\n- Sol Ring (C19:221) &1\n',
      )
      const session = await loadCollectionSession(filePath)
      expect(session.entries).toHaveLength(1)
      expect(session.entries[0]!.name).toBe('Sol Ring')
    })

    test('entries without IDs get pool-assigned ones that persist on first save', async () => {
      const filePath = await writeList('binder.md', '# Binder\n\n- Sol Ring (C19:221)\n')
      const session = await loadCollectionSession(filePath)
      expect(session.entries[0]!.cardId).toBe(1)

      applyFlatListChange(
        session,
        createAddChange('Lightning Bolt', {
          set: 'lea',
          collectorNumber: '161',
          cardId: allocateId(session.pool),
          section: flatListTargetSection(session),
        }),
      )
      await persistFlatListSession(session)
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Sol Ring (C19:221) &1\n')
      expect(content).toContain('- Lightning Bolt (LEA:161) &2\n')
    })
  })

  describe('wanted session', () => {
    test('a name-only add writes a bare name line', async () => {
      const filePath = await writeList('wishlist.md', '# Wishlist\n\n')
      const session = await loadWantedSession(filePath)
      const cardId = allocateId(session.pool)
      applyFlatListChange(
        session,
        createAddChange('Black Lotus', { cardId, section: flatListTargetSection(session) }),
      )
      await persistFlatListSession(session)
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Black Lotus &1\n')
      expect(content).not.toContain('(')
    })

    test('supports name-only adds and printing edits that clear back to name-only', async () => {
      const filePath = await writeList('wishlist.md', '# Wishlist\n\n- Black Lotus &1\n')
      const session = await loadWantedSession(filePath)
      expect(session.entries[0]!.state).toBe('name-only')

      const cardId = allocateId(session.pool)
      applyFlatListChange(
        session,
        createAddChange('Mana Crypt', {
          set: '2xm',
          collectorNumber: '270',
          finish: 'foil',
          cardId,
          section: flatListTargetSection(session),
        }),
      )
      await persistFlatListSession(session)
      let content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Mana Crypt (2XM:270) [foil] &2\n')

      // Clearing the printing reverts the entry to a name-only line.
      applyFlatListChange(session, createSetPrintingChange('Mana Crypt', { cardId }))
      await persistFlatListSession(session)
      content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Mana Crypt &2\n')
      expect(content).not.toContain('2XM')
    })
  })
})

describe('session front matter', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await removeWorkspace(tmpDir)
  })

  test('a collection session save preserves the block and its entry labels', async () => {
    const original =
      '---\nlabels: [sale, trade]\n---\n\n# Binder\n\n## Main\n- Sol Ring (C21:263) [keep] &1\n'
    const filePath = path.join(tmpDir, 'binder.md')
    await fs.writeFile(filePath, original)

    // Drive a real edit (not a bare dirty-flag) so the save exercises the whole
    // serialize path: the block must survive an actual change to a card line.
    const session = await loadCollectionSession(filePath)
    expect(session.entries[0]!.labels).toEqual(['keep'])
    applyFlatListChange(session, createSetNoteChange('Sol Ring', { note: 'signed', cardId: 1 }))
    await persistFlatListSession(session)

    expect(await fs.readFile(filePath, 'utf-8')).toBe(
      original.replace('[keep] &1', '[keep] {signed} &1'),
    )
  })
})

/**
 * Custom art is filed under a card line's `&N`, and an edit session hands the
 * ids its removals free straight back out — so the sidecar has to be re-filed
 * by the same save that writes the entries. The bookkeeping itself (which id a
 * removal, move, or undo records) is pinned in `test/unit/flat-list-edit.test.ts`;
 * this covers the save's file side effects.
 */
describe('session custom art', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await removeWorkspace(tmpDir)
  })

  /** A two-card collection whose lines both carry custom art. */
  async function binderWithArt(): Promise<string> {
    const filePath = path.join(tmpDir, 'binder.md')
    await fs.writeFile(
      filePath,
      '# Binder\n\n## Main\n- Sol Ring (C21:263) &1\n- Lightning Bolt (LEA:161) &2\n',
    )
    await saveCardArt(
      filePath,
      new Map<number, CardArtRef>([
        [1, { file: 'proxies/ring.png' }],
        [2, { url: 'https://example.test/bolt.png' }],
      ]),
    )
    return filePath
  }

  /** The strategy context the edit-mode operations work through. */
  function contextFor(session: CollectionSession): FlatListStrategyContext<CollectionCardEntry> {
    return {
      session,
      state: { snapshot: null },
      renderLine: () => '',
      renderEntry: (entry) => entry.name,
      sessionAdds: [],
      editUndo: [],
      originals: new Map(),
    }
  }

  /** The sidecar as it stands on disk, as plain pairs. */
  async function artOnDisk(filePath: string): Promise<[number, CardArtRef][]> {
    const loaded = await loadCardArt(filePath)
    if (!loaded.ok) throw new Error(loaded.message)
    return [...loaded.art.entries()]
  }

  test('a removal drops the art, and only when the session is saved', async () => {
    const filePath = await binderWithArt()
    const session = await loadCollectionSession(filePath)
    const list = contextFor(session)
    const ctx = createCardSessionContext()

    performFlatListRemoval(list, ctx, session.entries[0]!, 1)
    // Deferred like every other session edit: the sidecar is untouched until
    // the save, so exiting without saving keeps the art.
    expect(await artOnDisk(filePath)).toHaveLength(2)

    await persistFlatListSession(session)
    expect(await artOnDisk(filePath)).toEqual([[2, { url: 'https://example.test/bolt.png' }]])
  })

  test('a removal undone before the save leaves the sidecar untouched', async () => {
    const filePath = await binderWithArt()
    const before = await fs.stat(artSidecarPath(filePath))
    const session = await loadCollectionSession(filePath)
    const list = contextFor(session)
    const ctx = createCardSessionContext()

    performFlatListRemoval(list, ctx, session.entries[0]!, 1)
    undoFlatListEdit(list, ctx)
    await persistFlatListSession(session)

    // Not merely "the art is still right" — the file is not rewritten at all,
    // so a save with nothing to re-file never touches the sidecar's mtime.
    expect((await fs.stat(artSidecarPath(filePath))).mtimeMs).toBe(before.mtimeMs)
    expect(await artOnDisk(filePath)).toEqual([
      [1, { file: 'proxies/ring.png' }],
      [2, { url: 'https://example.test/bolt.png' }],
    ])
  })

  test('a move out drops the source entry when the session is saved', async () => {
    const filePath = await binderWithArt()
    const session = await loadCollectionSession(filePath)
    const list = contextFor(session)
    const ctx = createCardSessionContext()

    performFlatListMove(list, ctx, session.entries[0]!, 1, {
      target: { type: 'wanted', name: 'To Buy', file: '/wanted/to-buy.md' },
      printing: null,
    })
    await persistFlatListSession(session)

    // The destination side is committed by `saveOpenList` (pinned in
    // `edit-move-save.test.ts`); the source must not keep the reference, or the
    // next card to take &1 would wear the departed card's art.
    expect(await artOnDisk(filePath)).toEqual([[2, { url: 'https://example.test/bolt.png' }]])
  })

  test('a sidecar Ritual cannot read is left as it is, and is not retried on the next save', async () => {
    const filePath = path.join(tmpDir, 'binder.md')
    await fs.writeFile(
      filePath,
      '# Binder\n\n## Main\n- Sol Ring (C21:263) &1\n- Lightning Bolt (LEA:161) &2\n',
    )
    const malformed = '{ not json'
    await fs.writeFile(artSidecarPath(filePath), malformed)
    const session = await loadCollectionSession(filePath)
    const list = contextFor(session)
    const ctx = createCardSessionContext()

    performFlatListRemoval(list, ctx, session.entries[0]!, 1)
    await persistFlatListSession(session)

    // The card lines were written; the sidecar is byte-identical rather than
    // rewritten from a partial read.
    expect(await fs.readFile(filePath, 'utf-8')).not.toContain('Sol Ring')
    expect(await fs.readFile(artSidecarPath(filePath), 'utf-8')).toBe(malformed)
    // And the pending removal is not held over: replaying it against a later
    // save would target an id the list has since handed to another card.
    expect([...session.art.removed]).toEqual([])
  })

  test('the id a removal frees carries no art onto the card that reuses it', async () => {
    const filePath = await binderWithArt()
    const session = await loadCollectionSession(filePath)
    const list = contextFor(session)
    const ctx = createCardSessionContext()

    performFlatListRemoval(list, ctx, session.entries[0]!, 1)
    // The pool hands &1 straight back, which is exactly why a set-difference
    // over the saved ids would not catch this: &1 is present before and after.
    const reused = allocateId(session.pool)
    expect(reused).toBe(1)
    applyFlatListChange(
      session,
      createAddChange('Mana Crypt', {
        set: '2xm',
        collectorNumber: '270',
        cardId: reused,
        section: flatListTargetSection(session),
      }),
    )
    await persistFlatListSession(session)

    expect(await fs.readFile(filePath, 'utf-8')).toContain('Mana Crypt (2XM:270) &1')
    expect(await artOnDisk(filePath)).toEqual([[2, { url: 'https://example.test/bolt.png' }]])
  })
})
