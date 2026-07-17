import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createMoveFromChange } from '../../src/change-event'
import { applyOutgoingMoves } from '../../src/admin/api/move-save'
import { handleSelectedMove } from '../../src/admin/api/move'
import { handleLists } from '../../src/admin/api/lists'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from './helpers/workspace'

let ws: BoundWorkspace
let tmpDir: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
  await writeDeckFile(tmpDir, 'my-deck', {
    frontMatter: { name: 'My Deck' },
    cards: [{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
  })
  await writeCollectionFile(tmpDir, 'binder', {
    title: 'Binder',
    entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
  })
  await writeWantedFile(tmpDir, 'wishlist', {
    title: 'Wishlist',
    entries: [{ name: 'Brainstorm', cardId: 1 }],
  })
})

afterEach(async () => {
  await ws.dispose()
})

describe('applyOutgoingMoves', () => {
  test('no moves returns no written files', async () => {
    const result = await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, [])
    expect(result).toEqual({ writtenFiles: [], droppedNotes: [] })
  })

  test('writes the destination list and a move-to changelog', async () => {
    const change = createMoveFromChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 1,
      to: { type: 'deck', name: 'My Deck' },
    })
    const result = await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, [change])

    const deckPath = path.join(tmpDir, 'decks', 'my-deck.md')
    const deckContent = await fs.readFile(deckPath, 'utf-8')
    expect(deckContent).toContain('Lightning Bolt')
    expect(result.writtenFiles).toContain(deckPath)

    const changelog = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.changes.md'), 'utf-8')
    // The destination changelog reads "Moved … from <source>" — the source list is
    // the `from` label, never the destination deck itself.
    expect(changelog).toMatch(/Moved "Lightning Bolt".*from Collection 'Binder'/)
    expect(changelog).not.toContain("Deck 'My Deck'")
  })

  test('a quantity merge onto an existing deck line reports droppedNotes', async () => {
    // The deck already holds Sol Ring (C19:221); moving the same printing in
    // merges quantities on the existing line rather than adding a second line.
    const change = createMoveFromChange('Sol Ring', {
      set: 'c19',
      collectorNumber: '221',
      cardId: 2,
      to: { type: 'deck', name: 'My Deck' },
    })
    const result = await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, [change])

    const deckContent = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckContent).toContain('2 Sol Ring')
    // `move-from` events carry no note today, so a merge cannot drop one — the
    // field is pinned here as the (empty) report the editor save surfaces.
    expect(result.droppedNotes).toEqual([])
  })

  test('throws moving a printing-less card into a collection', async () => {
    const change = createMoveFromChange('Counterspell', {
      cardId: 1,
      to: { type: 'collection', name: 'Binder' },
    })
    let threw = false
    try {
      await applyOutgoingMoves({ type: 'deck', name: 'My Deck' }, [change])
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    // The destination collection is left untouched.
    const coll = await fs.readFile(path.join(tmpDir, 'collections', 'binder.md'), 'utf-8')
    expect(coll).not.toContain('Counterspell')
  })

  test('throws when the destination list does not exist', async () => {
    const change = createMoveFromChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      cardId: 1,
      to: { type: 'deck', name: 'Ghost Deck' },
    })
    let threw = false
    try {
      await applyOutgoingMoves({ type: 'collection', name: 'Binder' }, [change])
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

describe('POST /api/move/selected', () => {
  async function move(
    moves: unknown[],
  ): Promise<{ success: boolean; moved: number; skipped: number }> {
    const req = new Request('http://localhost/api/move/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves }),
    })
    return (await (await handleSelectedMove(req)).json()) as {
      success: boolean
      moved: number
      skipped: number
    }
  }

  test('moves a selected card from its list into the destination addressed by slug', async () => {
    const res = await move([
      {
        listType: 'deck',
        listSlug: 'my-deck',
        name: 'Sol Ring',
        cardId: 1,
        copyIndex: 0,
        toType: 'collection',
        toSlug: 'binder',
      },
    ])
    expect(res.success).toBe(true)
    expect(res.moved).toBe(1)

    const coll = await fs.readFile(path.join(tmpDir, 'collections', 'binder.md'), 'utf-8')
    expect(coll).toContain('Sol Ring')
    const deckContent = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckContent).not.toContain('Sol Ring')
  })

  test('skips a card whose destination is its own list', async () => {
    const res = await move([
      {
        listType: 'collection',
        listSlug: 'binder',
        name: 'Lightning Bolt',
        cardId: 1,
        copyIndex: 0,
        toType: 'collection',
        toSlug: 'binder',
      },
    ])
    expect(res.moved).toBe(0)
    expect(res.skipped).toBe(1)
  })

  test('a destination display name is not accepted in place of the slug', async () => {
    // The collection's display name is 'Binder'; only the slug 'binder' resolves.
    const res = await move([
      {
        listType: 'deck',
        listSlug: 'my-deck',
        name: 'Sol Ring',
        cardId: 1,
        copyIndex: 0,
        toType: 'collection',
        toSlug: 'Binder',
      },
    ])
    expect(res.moved).toBe(0)
    expect(res.skipped).toBe(1)
  })

  test('skips a card that no longer resolves to a physical card', async () => {
    const res = await move([
      {
        listType: 'deck',
        listSlug: 'my-deck',
        name: 'Ghost',
        cardId: 999,
        copyIndex: 0,
        toType: 'collection',
        toSlug: 'binder',
      },
    ])
    expect(res.moved).toBe(0)
    expect(res.skipped).toBe(1)
  })

  test('toSection routes a move into the named deck section', async () => {
    const res = await move([
      {
        listType: 'collection',
        listSlug: 'binder',
        name: 'Lightning Bolt',
        cardId: 1,
        copyIndex: 0,
        toType: 'deck',
        toSlug: 'my-deck',
        toSection: 'Sideboard',
      },
    ])
    expect(res.success).toBe(true)
    expect(res.moved).toBe(1)

    const deckContent = await fs.readFile(path.join(tmpDir, 'decks', 'my-deck.md'), 'utf-8')
    expect(deckContent).toContain('## Sideboard')
    expect(deckContent.indexOf('Lightning Bolt')).toBeGreaterThan(
      deckContent.indexOf('## Sideboard'),
    )
  })

  test('rejects toSection when the destination is not a deck', async () => {
    const req = new Request('http://localhost/api/move/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moves: [
          {
            listType: 'deck',
            listSlug: 'my-deck',
            name: 'Sol Ring',
            cardId: 1,
            copyIndex: 0,
            toType: 'collection',
            toSlug: 'binder',
            toSection: 'Main',
          },
        ],
      }),
    })
    const resp = await handleSelectedMove(req)
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toContain('toSection')
  })

  test('rejects a malformed body', async () => {
    const req = new Request('http://localhost/api/move/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves: [{ listType: 'deck' }] }),
    })
    const resp = await handleSelectedMove(req)
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as { success: boolean }).success).toBe(false)
  })
})

describe('GET /api/lists', () => {
  test('returns every list across the three types', async () => {
    const resp = await handleLists()
    const body = (await resp.json()) as {
      success: boolean
      lists: { type: string; slug: string; name: string }[]
    }
    expect(body.success).toBe(true)
    expect(body.lists).toContainEqual({ type: 'deck', slug: 'my-deck', name: 'My Deck' })
    expect(body.lists).toContainEqual({ type: 'collection', slug: 'binder', name: 'Binder' })
    expect(body.lists).toContainEqual({ type: 'wanted', slug: 'wishlist', name: 'Wishlist' })
  })
})
