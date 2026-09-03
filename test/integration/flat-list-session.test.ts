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
import prompts from 'prompts'
import {
  createCardSessionContext,
  type CardSessionContext,
} from '../../src/commands/session/strategy'
import {
  flatListDelegates,
  editSharedFlatListAction,
  performFlatListMove,
  performFlatListRemoval,
  undoFlatListEdit,
  type FlatListDelegates,
} from '../../src/commands/session/flat-list-edit'
import type {
  CollectionSession,
  FlatListStrategyContext,
} from '../../src/commands/session/flat-list-session'
import type { CollectionCardEntry } from '../../src/list/site-data'
import {
  categoriesHashPath,
  categoriesSidecarPath,
  loadCardCategories,
  saveCardCategories,
} from '../../src/list/card-categories-sidecar'
import { computeHash } from '../../src/changes/content-hash'
import { captureConsole } from '../helpers/capture'
import { appendChangelog } from '../../src/changes/changelog-writer'
import { categoriesOf, categoriesRecord } from '../helpers/card-categories'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'
import { stubTty } from '../test-utils'

// The language picker goes through `ask`, which refuses to prompt without a
// terminal; the answers come from prompts.inject, so pretend stdin is a TTY.
stubTty({ stdin: true })

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

/**
 * The two ways a card's language is retargeted from *add* mode — the
 * `🌐 Change Language` shortcut for the card just added, and the same action
 * reached through the View Session Changes screen — end to end: the change lands
 * on the in-memory model, is deferred like every other session edit, and writes
 * a `[ja]` token when the session is saved.
 */
describe('session language edits', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await removeWorkspace(tmpDir)
  })

  /** Card ids handed to the strategy's own per-entry action menu. */
  type Session = {
    filePath: string
    list: FlatListStrategyContext<CollectionCardEntry>
    delegates: FlatListDelegates
    ctx: CardSessionContext
    /** Card ids the `details` action routed to the per-entry action menu. */
    detailsFor: number[]
  }

  /** A two-card binder whose lines were both "added" this session. */
  async function sessionWithAdds(): Promise<Session> {
    const filePath = path.join(tmpDir, 'binder.md')
    await fs.writeFile(
      filePath,
      '# Binder\n\n## Main\n- Sol Ring (C21:263) &1\n- Mox Ruby (LEA:265) &2\n',
    )
    const session = await loadCollectionSession(filePath)
    const list: FlatListStrategyContext<CollectionCardEntry> = {
      session,
      state: { snapshot: null },
      renderLine: () => '',
      renderEntry: (entry) => entry.name,
      sessionAdds: [1, 2],
      editUndo: [],
      originals: new Map(),
    }
    const detailsFor: number[] = []
    return {
      filePath,
      list,
      delegates: flatListDelegates(list, async (_ctx, cardId) => {
        detailsFor.push(cardId)
      }),
      ctx: createCardSessionContext(),
      detailsFor,
    }
  }

  const readList = (filePath: string): Promise<string> => fs.readFile(filePath, 'utf-8')

  test('the shortcut writes the token on save, and not before', async () => {
    const { filePath, delegates, ctx } = await sessionWithAdds()
    prompts.inject(['ja'])
    await delegates.editEntryLanguage(ctx, 1)

    expect(await readList(filePath)).not.toContain('[ja]')
    expect(delegates.hasUnsavedChanges()).toBe(true)

    await delegates.persist()
    expect(await readList(filePath)).toContain('- Sol Ring (C21:263) [ja] &1')
  })

  test('the session-changes screen retargets the row it was given, not the first', async () => {
    const { filePath, delegates, ctx } = await sessionWithAdds()
    prompts.inject(['ja'])
    // Row 1 is the Mox Ruby add; row 0 is Sol Ring's and must be left alone.
    await delegates.editSessionChange(ctx, 1, 'language')
    await delegates.persist()

    const written = await readList(filePath)
    expect(written).toContain('- Mox Ruby (LEA:265) [ja] &2')
    expect(written).toContain('- Sol Ring (C21:263) &1')
  })

  test('the details action opens the list type’s own menu for that row’s card', async () => {
    const { delegates, ctx, detailsFor } = await sessionWithAdds()
    await delegates.editSessionChange(ctx, 1, 'details')
    expect(detailsFor).toEqual([2])
  })

  test('a row whose card is gone edits nothing, and offers nothing to edit', async () => {
    const { list, delegates, ctx, detailsFor } = await sessionWithAdds()
    // Take a *pre-existing* line away: a session add would be discarded (row and
    // all), whereas this leaves a removal row whose card no longer exists.
    list.sessionAdds = [1]
    performFlatListRemoval(list, ctx, list.session.entries[1]!, 2)
    expect(delegates.listSessionChanges().map((row) => row.editable)).toEqual([true, false])

    // No prompt is injected: neither a stale id nor a dead row may open one.
    await delegates.editEntryLanguage(ctx, 99)
    await delegates.editSessionChange(ctx, 1, 'language')
    await delegates.editSessionChange(ctx, 1, 'details')
    expect(detailsFor).toEqual([])
  })
})

describe('session categories', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await removeWorkspace(tmpDir)
  })

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

  test('a categories edit is written by the save, which also prunes a removed card', async () => {
    const filePath = path.join(tmpDir, 'binder.md')
    await fs.writeFile(
      filePath,
      '# Binder\n\n## Main\n- Sol Ring (C21:263) &1\n- Lightning Bolt (LEA:161) &2\n',
    )
    await saveCardCategories(filePath, categoriesRecord(['Burn'], { 'Lightning Bolt': ['Burn'] }))

    const session = await loadCollectionSession(filePath)
    const list = contextFor(session)
    const ctx = createCardSessionContext()

    prompts.inject(['Ramp, Artifacts'])
    expect(
      await editSharedFlatListAction('categories', list, ctx, session.entries[0]!, 1, {
        sessionConfig: { sets: [] },
        excludeDigitalOnly: true,
      }),
    ).toBe(true)
    // The same session takes Lightning Bolt out, so the save must drop its
    // category entry as well as writing the new one.
    performFlatListRemoval(list, ctx, session.entries[1]!, 2)

    // Deferred like every other session edit: nothing is on disk until the save.
    const before = await loadCardCategories(filePath)
    expect(before.ok && categoriesOf(before.categories)).toEqual({ 'Lightning Bolt': ['Burn'] })
    const hashBefore = await fs.readFile(categoriesHashPath(filePath), 'utf-8')

    // The save's prune drops an assignment the user made, so it must say so —
    // design §2: "pruned names are listed in the save's effects".
    const saved = await captureConsole(['warn'], () => persistFlatListSession(session))
    expect(saved.all.join('\n')).toContain('Lightning Bolt')

    const after = await loadCardCategories(filePath)
    expect(after.ok && categoriesOf(after.categories)).toEqual({
      'Sol Ring': ['Ramp', 'Artifacts'],
    })
    // The sidecar's hash was re-stamped over the new bytes, not left as it was.
    const hashAfter = await fs.readFile(categoriesHashPath(filePath), 'utf-8')
    expect(hashAfter).not.toBe(hashBefore)
    expect(hashAfter.trim()).toBe(
      computeHash(await fs.readFile(categoriesSidecarPath(filePath), 'utf-8')),
    )

    // The changelog append below is the session loop's own step, performed here
    // by hand: this suite drives the model, not the loop. It pins that the
    // staged event reached `ctx.sessionChanges` in a writable shape — the prose
    // itself belongs to `formatChangeCore`'s own unit tests.
    await appendChangelog(filePath, 'Binder', ctx.sessionChanges)
    expect(await fs.readFile(filePath.replace(/\.md$/, '.changes.md'), 'utf-8')).toContain(
      '- Set categories of "Sol Ring" to Ramp, Artifacts',
    )
  })
})
