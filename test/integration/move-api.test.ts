import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { getDefaultRitualConfig } from '../../src/ritual-config'
import { handleMoveCommit } from '../../src/admin/api/move'
import type { MovePhysicalCard } from '../../src/admin/api/move'
import { handleCardIndex, type CardIndexResponse } from '../../src/admin/api/card-index'
import {
  bindWorkspace,
  initGitRepo,
  writeCollectionFile,
  writeConfig,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from './helpers/workspace'
import { callJson } from './helpers/request'

/**
 * End-to-end coverage for the admin move endpoints. Exercises the slug-based key
 * round-trip (the load endpoint issues a key, the commit endpoint reconstructs it
 * from disk) and the destination printing override used for collection moves.
 */

let ws: BoundWorkspace
let tmpDir: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
})

afterEach(async () => {
  await ws.dispose()
})

async function loadData(): Promise<CardIndexResponse> {
  const { body } = await callJson<CardIndexResponse>(handleCardIndex, 'GET', '/api/card-index')
  return body
}

function findCard(data: CardIndexResponse, name: string): MovePhysicalCard {
  const card = data.cards.find((c) => c.name === name)
  if (!card) throw new Error(`card ${name} not found in move data`)
  return card
}

type CommitResult = {
  success: boolean
  moved: number
  skipped: number
  droppedNotes: { cardName: string; cardId?: number; note: string }[]
}

async function commit(moves: unknown[]): Promise<CommitResult> {
  const { body } = await callJson<CommitResult>(handleMoveCommit, 'POST', '/api/move/commit', {
    moves,
  })
  return body
}

describe('move API', () => {
  test('commits a move using the key issued by the load endpoint', async () => {
    const srcPath = await writeCollectionFile(tmpDir, 'src', {
      title: 'Source',
      entries: [
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', finish: 'foil', cardId: 1 },
      ],
    })
    const dstPath = await writeCollectionFile(tmpDir, 'dst', { title: 'Dest', entries: [] })

    const data = await loadData()
    const card = findCard(data, 'Lightning Bolt')

    const result = await commit([{ cardKey: card.key, toType: 'collection', toSlug: 'dst' }])
    expect(result.success).toBe(true)
    expect(result.moved).toBe(1)
    expect(result.skipped).toBe(0)

    expect(await fs.readFile(srcPath, 'utf-8')).not.toContain('Lightning Bolt')
    expect(await fs.readFile(dstPath, 'utf-8')).toContain('Lightning Bolt')
  })

  test('applies a destination printing override for a name-only card into a collection', async () => {
    await writeWantedFile(tmpDir, 'wishlist', {
      title: 'Wishlist',
      entries: [{ name: 'Mana Crypt', cardId: 1 }],
    })
    const binderPath = await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [],
    })

    const data = await loadData()
    const card = findCard(data, 'Mana Crypt')

    const result = await commit([
      {
        cardKey: card.key,
        toType: 'collection',
        toSlug: 'binder',
        set: '2XM',
        collectorNumber: '270',
        finish: 'nonfoil',
        condition: 'NM',
      },
    ])
    expect(result.moved).toBe(1)

    const binder = await fs.readFile(binderPath, 'utf-8')
    expect(binder).toContain('Mana Crypt')
    // Set codes are uppercased in markdown output, normalized from the override.
    expect(binder).toContain('(2XM:270)')
  })

  test('skips a move whose card key no longer resolves', async () => {
    await writeCollectionFile(tmpDir, 'src', {
      title: 'Source',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })
    await writeCollectionFile(tmpDir, 'dst', { title: 'Dest', entries: [] })

    const result = await commit([
      { cardKey: 'collection:src:999:0', toType: 'collection', toSlug: 'dst' },
    ])
    expect(result.success).toBe(true)
    expect(result.moved).toBe(0)
    expect(result.skipped).toBe(1)
  })

  test('auto-commits the written files when git auto-commit is enabled', async () => {
    initGitRepo(tmpDir)

    await writeCollectionFile(tmpDir, 'src', {
      title: 'Source',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })
    await writeCollectionFile(tmpDir, 'dst', { title: 'Dest', entries: [] })

    // A full, valid admin config with git auto-commit enabled (so loadRitualConfig keeps it).
    const base = getDefaultRitualConfig()
    await writeConfig(tmpDir, {
      admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: false },
    })

    const data = await loadData()
    const card = findCard(data, 'Sol Ring')
    const result = await commit([{ cardKey: card.key, toType: 'collection', toSlug: 'dst' }])
    expect(result.moved).toBe(1)

    const subject = execSync('git log -1 --pretty=%s', { cwd: tmpDir, encoding: 'utf-8' }).trim()
    expect(subject).toBe('Move 1 card')

    // The moved list files were committed, not left as working-tree changes.
    const tracked = execSync('git ls-files', { cwd: tmpDir, encoding: 'utf-8' })
    expect(tracked).toContain('collections/src.md')
    expect(tracked).toContain('collections/dst.md')
  })

  test('toSection places the card in the named deck section and reports dropped notes', async () => {
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [
        {
          name: 'Duress',
          set: 'usg',
          collectorNumber: '132',
          note: 'sideboard tech',
          cardId: 1,
        },
      ],
    })
    const deckPath = await writeDeckFile(tmpDir, 'my-deck', {
      frontMatter: { name: 'My Deck' },
      cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
    })

    const data = await loadData()
    const card = findCard(data, 'Duress')

    const result = await commit([
      { cardKey: card.key, toType: 'deck', toSlug: 'my-deck', toSection: 'Sideboard' },
    ])
    expect(result.moved).toBe(1)
    // No quantity-merge happened, so nothing was dropped.
    expect(result.droppedNotes).toEqual([])

    const deck = await fs.readFile(deckPath, 'utf-8')
    expect(deck).toContain('## Sideboard')
    expect(deck.indexOf('Duress')).toBeGreaterThan(deck.indexOf('## Sideboard'))
  })

  test('a quantity-merge into a deck reports the discarded note', async () => {
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [
        {
          name: 'Sol Ring',
          set: 'c21',
          collectorNumber: '167',
          note: 'from trade',
          cardId: 3,
        },
      ],
    })
    await writeDeckFile(tmpDir, 'my-deck', {
      frontMatter: { name: 'My Deck' },
      cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '167', cardId: 1 }],
    })

    const data = await loadData()
    // The load endpoint returns both copies; pick the collection one as the source.
    const source = data.cards.find((c) => c.name === 'Sol Ring' && c.listType === 'collection')!

    const result = await commit([{ cardKey: source.key, toType: 'deck', toSlug: 'my-deck' }])
    expect(result.moved).toBe(1)
    expect(result.droppedNotes).toEqual([{ cardName: 'Sol Ring', cardId: 3, note: 'from trade' }])
  })

  test('rejects toSection when the destination is not a deck', async () => {
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '167', cardId: 1 }],
    })
    const req = new Request('http://localhost/api/move/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moves: [
          {
            cardKey: 'collection:binder:1:0',
            toType: 'collection',
            toSlug: 'binder',
            toSection: 'Main',
          },
        ],
      }),
    })
    const resp = await handleMoveCommit(req)
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toContain('toSection')
  })

  test('a language arrival-override stamps the destination line', async () => {
    await writeCollectionFile(tmpDir, 'src', {
      title: 'Source',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })
    const dstPath = await writeCollectionFile(tmpDir, 'dst', { title: 'Dest', entries: [] })

    const data = await loadData()
    const card = findCard(data, 'Sol Ring')

    const result = await commit([
      { cardKey: card.key, toType: 'collection', toSlug: 'dst', language: 'ja' },
    ])
    expect(result.moved).toBe(1)
    expect(await fs.readFile(dstPath, 'utf-8')).toContain('Sol Ring (C21:240) [ja]')
  })

  test('rejects an unknown language code without moving anything', async () => {
    const srcPath = await writeCollectionFile(tmpDir, 'src', {
      title: 'Source',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })
    await writeCollectionFile(tmpDir, 'dst', { title: 'Dest', entries: [] })
    const before = await fs.readFile(srcPath, 'utf-8')

    const req = new Request('http://localhost/api/move/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moves: [
          { cardKey: 'collection:src:1:0', toType: 'collection', toSlug: 'dst', language: 'jp' },
        ],
      }),
    })
    const resp = await handleMoveCommit(req)
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as { success: boolean }).success).toBe(false)
    // The refusal happens at validation, before any file is touched.
    expect(await fs.readFile(srcPath, 'utf-8')).toBe(before)
  })

  test('rejects a request whose moves field is not an array', async () => {
    const req = new Request('http://localhost/api/move/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notMoves: true }),
    })
    const resp = await handleMoveCommit(req)
    expect(resp.status).toBe(400)
  })

  test('rejects a move item with an invalid field', async () => {
    const req = new Request('http://localhost/api/move/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // cardKey must be a string and toType must be a valid list type.
      body: JSON.stringify({ moves: [{ cardKey: 123, toType: 'bogus', toSlug: 'dst' }] }),
    })
    const resp = await handleMoveCommit(req)
    expect(resp.status).toBe(400)
  })
})
