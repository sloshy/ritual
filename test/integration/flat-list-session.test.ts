import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  applyFlatListChange,
  discardFlatListAdd,
  flatListTargetSection,
  listFlatListSessionAdds,
  loadCollectionSession,
  loadWantedSession,
  type FlatListStrategyContext,
} from '../../src/commands/flat-list-session'
import { formatCollectionLine } from '../../src/commands/collection-helpers'
import type { CardSessionContext } from '../../src/commands/card-session'
import type { CollectionSession } from '../../src/commands/flat-list-session'
import type { CollectionCardEntry } from '../../src/site/data-types'
import { allocateId } from '../../src/card-id'
import {
  createAddChange,
  createSetNoteChange,
  createSetPrintingChange,
} from '../../src/change-event'

describe('flat-list session models', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeList(name: string, content: string): Promise<string> {
    const filePath = path.join(tmpDir, name)
    await fs.writeFile(filePath, content)
    return filePath
  }

  describe('collection session', () => {
    test('add appends a canonical line to the last section and reuses pooled IDs', async () => {
      // ID 2 is missing, so the pool should hand it out before going sequential.
      const filePath = await writeList(
        'binder.md',
        '# My Binder\n\n## Trade\n- Sol Ring (C19:221) [foil] [NM] &1\n\n## Keep\n- Lightning Bolt (LEA:161) &3\n',
      )
      const session = await loadCollectionSession(filePath)

      expect(session.title).toBe('My Binder')
      expect(flatListTargetSection(session)).toBe('Keep')

      const cardId = allocateId(session.pool)
      expect(cardId).toBe(2)

      await applyFlatListChange(
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

      // Like an admin save, re-serialization normalizes condition-less entries to [NM].
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe(
        '# My Binder\n\n## Trade\n- Sol Ring (C19:221) [foil] [NM] &1\n\n## Keep\n- Lightning Bolt (LEA:161) [NM] &3\n- Mana Crypt (2XM:270) [foil] [NM] &2\n',
      )
    })

    test('set-note and set-printing target entries by card ID, not file position', async () => {
      const filePath = await writeList(
        'binder.md',
        '# Binder\n\n- Sol Ring (C19:221) &1\n- Lightning Bolt (LEA:161) &2\n',
      )
      const session = await loadCollectionSession(filePath)

      // Target the FIRST entry even though another card was added after it.
      await applyFlatListChange(
        session,
        createSetNoteChange('Sol Ring', { note: 'signed', cardId: 1 }),
      )
      await applyFlatListChange(
        session,
        createSetPrintingChange('Sol Ring', {
          set: 'ltc',
          collectorNumber: '284',
          finish: 'foil',
          condition: 'LP',
          cardId: 1,
        }),
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Sol Ring (LTC:284) [foil] [LP] {signed} &1\n')
      expect(content).toContain('- Lightning Bolt (LEA:161) [NM] &2\n')
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

      await applyFlatListChange(
        session,
        createAddChange('Lightning Bolt', {
          set: 'lea',
          collectorNumber: '161',
          cardId: allocateId(session.pool),
          section: flatListTargetSection(session),
        }),
      )
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Sol Ring (C19:221) [NM] &1\n')
      expect(content).toContain('- Lightning Bolt (LEA:161) [NM] &2\n')
    })
  })

  describe('wanted session', () => {
    test('a name-only add writes a bare name line', async () => {
      const filePath = await writeList('wishlist.md', '# Wishlist\n\n')
      const session = await loadWantedSession(filePath)
      const cardId = allocateId(session.pool)
      await applyFlatListChange(
        session,
        createAddChange('Black Lotus', { cardId, section: flatListTargetSection(session) }),
      )
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Black Lotus &1\n')
      expect(content).not.toContain('(')
    })

    test('supports name-only adds and printing edits that clear back to name-only', async () => {
      const filePath = await writeList('wishlist.md', '# Wishlist\n\n- Black Lotus &1\n')
      const session = await loadWantedSession(filePath)
      expect(session.entries[0]!.state).toBe('name-only')

      const cardId = allocateId(session.pool)
      await applyFlatListChange(
        session,
        createAddChange('Mana Crypt', {
          set: '2xm',
          collectorNumber: '270',
          finish: 'foil',
          cardId,
          section: flatListTargetSection(session),
        }),
      )
      let content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Mana Crypt (2XM:270) [foil] &2\n')

      // Clearing the printing reverts the entry to a name-only line.
      await applyFlatListChange(session, createSetPrintingChange('Mana Crypt', { cardId }))
      content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Mana Crypt &2\n')
      expect(content).not.toContain('2XM')
    })
  })

  describe('discarding session adds', () => {
    // Build a collection strategy context whose sessionAdds tracks ids 1..n in add order.
    function contextFor(session: CollectionSession): {
      list: FlatListStrategyContext<CollectionCardEntry>
      ctx: CardSessionContext
    } {
      const list: FlatListStrategyContext<CollectionCardEntry> = {
        session,
        state: { snapshot: null },
        renderLine: (name, snap, cardId) =>
          formatCollectionLine(
            name,
            snap.options.set ?? '',
            snap.options.collectorNumber ?? '',
            snap.options.finish ?? 'nonfoil',
            snap.options.condition ?? 'NM',
            snap.note,
            cardId,
          ).trim(),
        renderEntry: (e) =>
          formatCollectionLine(
            e.name,
            e.set,
            e.collectorNumber,
            e.finish,
            e.condition,
            e.note,
            e.cardId,
          ).trim(),
        sessionAdds: [],
      }
      const ctx: CardSessionContext = {
        sessionChanges: [],
        lastChangeIndex: null,
        lastAdded: null,
        lastAddedCount: 0,
      }
      return { list, ctx }
    }

    async function addCard(
      list: FlatListStrategyContext<CollectionCardEntry>,
      ctx: CardSessionContext,
      name: string,
      set: string,
      collectorNumber: string,
    ): Promise<void> {
      const cardId = allocateId(list.session.pool)
      const change = createAddChange(name, {
        set,
        collectorNumber,
        finish: 'nonfoil',
        condition: 'NM',
        cardId,
        section: flatListTargetSection(list.session),
      })
      await applyFlatListChange(list.session, change)
      list.sessionAdds.push(cardId)
      ctx.sessionChanges.push(change)
    }

    test('discarding a middle add re-packs survivors, frees the top id, and rewrites the log', async () => {
      const filePath = await writeList('binder.md', '# Binder\n\n')
      const session = await loadCollectionSession(filePath)
      const { list, ctx } = contextFor(session)

      await addCard(list, ctx, 'Sol Ring', 'c19', '221')
      await addCard(list, ctx, 'Lightning Bolt', 'lea', '161')
      await addCard(list, ctx, 'Brainstorm', 'ice', '61')
      await addCard(list, ctx, 'Counterspell', 'lea', '54')
      await addCard(list, ctx, 'Dark Ritual', 'lea', '98')
      expect(list.sessionAdds).toEqual([1, 2, 3, 4, 5])

      // Discard the 3rd add (Brainstorm, &3).
      await discardFlatListAdd(list, ctx, 2)

      // Survivors stay in add order and re-pack to a dense 1..4; the top id (5) frees up.
      expect(session.entries.map((e) => e.name)).toEqual([
        'Sol Ring',
        'Lightning Bolt',
        'Counterspell',
        'Dark Ritual',
      ])
      expect(session.entries.map((e) => e.cardId)).toEqual([1, 2, 3, 4])
      expect(list.sessionAdds).toEqual([1, 2, 3, 4])
      expect(allocateId(session.pool)).toBe(5)

      // The serialized file carries dense, in-order ids.
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Sol Ring (C19:221) [NM] &1\n')
      expect(content).toContain('- Lightning Bolt (LEA:161) [NM] &2\n')
      expect(content).toContain('- Counterspell (LEA:54) [NM] &3\n')
      expect(content).toContain('- Dark Ritual (LEA:98) [NM] &4\n')
      expect(content).not.toContain('Brainstorm')
      expect(content).not.toContain('&5')

      // The discarded card's changelog event is gone; the rest are remapped to the new ids.
      expect(ctx.sessionChanges.map((c) => ('cardId' in c ? c.cardId : undefined))).toEqual([
        1, 2, 3, 4,
      ])
      expect(ctx.sessionChanges.map((c) => ('cardName' in c ? c.cardName : undefined))).toEqual([
        'Sol Ring',
        'Lightning Bolt',
        'Counterspell',
        'Dark Ritual',
      ])
    })

    test('undo-last (the newest add) frees its id without touching the others', async () => {
      const filePath = await writeList('binder.md', '# Binder\n\n')
      const session = await loadCollectionSession(filePath)
      const { list, ctx } = contextFor(session)

      await addCard(list, ctx, 'Sol Ring', 'c19', '221')
      await addCard(list, ctx, 'Lightning Bolt', 'lea', '161')

      expect(listFlatListSessionAdds(list).map((i) => i.name)).toEqual([
        'Sol Ring',
        'Lightning Bolt',
      ])

      // Undo last == discard the highest index.
      await discardFlatListAdd(list, ctx, list.sessionAdds.length - 1)

      expect(session.entries.map((e) => e.cardId)).toEqual([1])
      expect(session.entries[0]!.name).toBe('Sol Ring')
      expect(list.sessionAdds).toEqual([1])
      // Id 2 returned to the pool.
      expect(allocateId(session.pool)).toBe(2)
    })

    test('a re-pack leaves pre-existing (non-session) entries and their ids untouched', async () => {
      // The file already has two cards (&1, &2) that were not added this session.
      const filePath = await writeList(
        'binder.md',
        '# Binder\n\n- Mox Emerald (LEA:265) [NM] &1\n- Black Lotus (LEA:232) [NM] &2\n',
      )
      const session = await loadCollectionSession(filePath)
      const { list, ctx } = contextFor(session)

      await addCard(list, ctx, 'Sol Ring', 'c19', '221') // &3
      await addCard(list, ctx, 'Lightning Bolt', 'lea', '161') // &4
      await addCard(list, ctx, 'Brainstorm', 'ice', '61') // &5

      // Discard the middle session add (Lightning Bolt, &4).
      await discardFlatListAdd(list, ctx, 1)

      // The two pre-existing entries keep &1/&2; only the session ids re-pack
      // (Brainstorm &5 → &4), and the freed top id (5) returns to the pool.
      const byName = (n: string) => session.entries.find((e) => e.name === n)!
      expect(byName('Mox Emerald').cardId).toBe(1)
      expect(byName('Black Lotus').cardId).toBe(2)
      expect(byName('Sol Ring').cardId).toBe(3)
      expect(byName('Brainstorm').cardId).toBe(4)
      expect(session.entries.find((e) => e.name === 'Lightning Bolt')).toBeUndefined()
      expect(list.sessionAdds).toEqual([3, 4])
      expect(allocateId(session.pool)).toBe(5)
    })
  })
})
