import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { handleCardIndex, type CardIndexResponse } from '../../src/admin/api/card-index'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'
import { callJson } from './helpers/request'

/**
 * `GET /api/card-index` — the cross-list physical-card index that backs the
 * admin Move Cards page. Filter *semantics* are unit-tested against
 * `filterCardIndex`; this covers the route: enumerating real list files on disk,
 * and that the filters reach the matcher while `lists` stays unfiltered.
 */

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  await writeCollectionFile(ws.dir, 'binder', {
    title: 'Binder',
    entries: [
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 2 },
    ],
  })
  await writeWantedFile(ws.dir, 'wishlist', {
    title: 'Wishlist',
    entries: [{ name: 'Mana Crypt', cardId: 1 }],
  })
  await writeDeckFile(ws.dir, 'my-deck', {
    name: 'My Deck',
    cards: [{ quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
  })
})

afterEach(async () => {
  await ws.dispose()
})

async function index(query = ''): Promise<CardIndexResponse> {
  const { status, body } = await callJson<CardIndexResponse>(
    handleCardIndex,
    'GET',
    `/api/card-index${query ? `?${query}` : ''}`,
  )
  expect(status).toBe(200)
  return body
}

describe('handleCardIndex', () => {
  test('lists every list and every physical card across the three list types', async () => {
    const data = await index()
    expect(data.success).toBeTrue()
    expect(data.lists.map((l) => `${l.type}:${l.slug}`).sort()).toEqual([
      'collection:binder',
      'deck:my-deck',
      'wanted:wishlist',
    ])
    // The deck entry has quantity 2, so it expands to one physical card per copy.
    expect(data.cards.map((c) => c.name).sort()).toEqual([
      'Lightning Bolt',
      'Lightning Bolt',
      'Lightning Bolt',
      'Mana Crypt',
      'Sol Ring',
    ])
  })

  test('filters cards while leaving the destination roster whole', async () => {
    const data = await index('listType=collection&set=LEA')
    expect(data.cards.map((c) => `${c.listSlug}:${c.name}`)).toEqual(['binder:Lightning Bolt'])
    // Clients render move destinations from `lists`, so it is never narrowed.
    expect(data.lists).toHaveLength(3)
  })

  // Filter semantics (term matching, lowercase set codes, exact slugs) are pinned
  // on the pure parser/matcher in test/unit/admin/card-index.test.ts; what the
  // route adds is query-string wiring and the rejection status.
  test.each([
    ['an invalid list type', 'listType=binder'],
    ['a slug carrying a path separator', 'slug=..%2Fsecret'],
    ['a malformed set code', 'set=..%2Fetc'],
  ])('%s is a 400', async (_label, query) => {
    const resp = await handleCardIndex(new Request(`http://localhost/api/card-index?${query}`))
    expect(resp.status).toBe(400)
  })

  test('warnings is always present, and empty when every list read cleanly', async () => {
    const data = await index()
    expect(Object.keys(data)).toContain('warnings')
    expect(data.warnings).toEqual([])
  })

  test('a list whose lines cannot be parsed is named in warnings, not silently dropped', async () => {
    await Bun.write(
      `${ws.dir}/collections/broken.md`,
      '# Broken\n\n- this line is not a card entry at all\n',
    )

    const data = await index()
    expect(data.warnings).toHaveLength(1)
    expect(data.warnings[0]).toContain('collections/broken.md')
    // The other lists are still indexed — one bad file must not hide the rest.
    // Two collection entries, one wanted entry, and a deck line of quantity 2.
    expect(data.cards).toHaveLength(5)
  })
})
