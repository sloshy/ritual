import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { computeHash } from '../../src/content-hash'
import { handleCollectionSave } from '../../src/admin/api/collection-save'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import { handleRemoveCommit, handleSelectedMove } from '../../src/admin/api/move'
import { handleWantedListSave } from '../../src/admin/api/wanted-save'
import { createAddChange } from '../../src/change-event'
import { callJson } from './helpers/request'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from './helpers/workspace'
import { seedCardNames } from '../test-utils'

/**
 * The opt-in `validateCardNames` field on the write routes.
 *
 * The rules themselves (the `known` bypass, candidate ranking, the cold-cache
 * message) are pinned on the pure checker in
 * test/unit/admin/card-name-check.test.ts. This covers the wiring: that a save
 * route and a move route both reach the checker, that the refusal is a 400
 * carrying its explanation, and — the load-bearing one — that omitting the field
 * leaves the admin UI's path bit-identical to what it was.
 */

let ws: BoundWorkspace
let collectionHash: string
let deckHash: string
let deckPath: string
let wantedHash: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false, clearCardCache: true })
  const filePath = await writeCollectionFile(ws.dir, 'binder', {
    title: 'Binder',
    entries: [
      { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
      // A card no cache will ever hold: proof that a name already in the file
      // stays editable regardless of what the cache knows.
      { name: 'Homemade Proxy Beast', set: 'xxx', collectorNumber: '1', cardId: 2 },
    ],
  })
  collectionHash = computeHash(await Bun.file(filePath).text())
  deckPath = await writeDeckFile(ws.dir, 'burn', {
    frontMatter: { name: 'Burn' },
    cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
  })
  deckHash = computeHash(await Bun.file(deckPath).text())
  const wantedPath = await writeWantedFile(ws.dir, 'wishlist', {
    title: 'Wishlist',
    entries: [{ name: 'Mana Crypt', cardId: 1 }],
  })
  wantedHash = computeHash(await Bun.file(wantedPath).text())
})

afterEach(async () => {
  await ws.dispose()
})

/** A collection save body; `validateCardNames` is left off unless a test sets it. */
function saveBody(cardName: string, validateCardNames?: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    changes: [createAddChange(cardName, { set: 'c21', collectorNumber: '240' })],
    contentHash: collectionHash,
  }
  if (validateCardNames !== undefined) body.validateCardNames = validateCardNames
  return body
}

describe('a save route with validateCardNames', () => {
  test('refuses an unknown name with a 400 naming the closest cached spellings', async () => {
    await seedCardNames('Sol Ring', 'Sol Talisman')

    const { status, body } = await callJson<{ message: string }>(
      handleCollectionSave,
      'POST',
      '/api/collection/binder',
      saveBody('Sol Rung', true),
    )
    expect(status).toBe(400)
    expect(body.message).toContain('Sol Rung')
    expect(body.message).toContain('Sol Ring')
  })

  test('accepts a name the cache knows', async () => {
    await seedCardNames('Arcane Signet')

    const { status } = await callJson(
      handleCollectionSave,
      'POST',
      '/api/collection/binder',
      saveBody('Arcane Signet', true),
    )
    expect(status).toBe(200)
  })

  test('a cold cache is a 400 that names both remedies', async () => {
    const { status, body } = await callJson<{ message: string }>(
      handleCollectionSave,
      'POST',
      '/api/collection/binder',
      saveBody('Arcane Signet', true),
    )
    expect(status).toBe(400)
    expect(body.message).toContain('refresh_cache')
    expect(body.message).toContain('ritual cache preload-all')
  })

  test('omitting the field leaves the admin path unchanged, cold cache and all', async () => {
    const { status } = await callJson(
      handleCollectionSave,
      'POST',
      '/api/collection/binder',
      saveBody('Some Card Nothing Knows'),
    )
    expect(status).toBe(200)
  })

  test('is refused when it is not a boolean, never coerced', async () => {
    const { status, body } = await callJson<{ message: string }>(
      handleCollectionSave,
      'POST',
      '/api/collection/binder',
      { ...saveBody('Arcane Signet'), validateCardNames: 'true' },
    )
    expect(status).toBe(400)
    expect(body.message).toBe('validateCardNames must be a boolean.')
  })
})

describe('every write route reaches the checker', () => {
  // One representative refusal per route: the checker's own rules are pinned in
  // the unit suite, so what these add is that the wiring exists at all — a route
  // that forgot the gate would accept the misspelling and write the file.
  test('deck save refuses, and leaves the deck file byte-identical', async () => {
    await seedCardNames('Sol Ring')
    const before = await Bun.file(deckPath).text()

    const { status, body } = await callJson<{ message: string }>(
      handleDeckSave,
      'POST',
      '/api/deck/burn/save',
      {
        changes: [createAddChange('Sol Rung')],
        deck: { name: 'Burn', sections: [{ name: 'Main', cards: [] }] },
        frontMatter: { name: 'Burn' },
        contentHash: deckHash,
        validateCardNames: true,
      },
    )
    expect(status).toBe(400)
    expect(body.message).toContain('Sol Rung')
    expect(await Bun.file(deckPath).text()).toBe(before)
  })

  test('wanted save refuses an unknown name', async () => {
    await seedCardNames('Mana Crypt')

    const { status, body } = await callJson<{ message: string }>(
      handleWantedListSave,
      'POST',
      '/api/wanted/wishlist/save',
      {
        changes: [createAddChange('Mana Crypp')],
        entries: [],
        contentHash: wantedHash,
        validateCardNames: true,
      },
    )
    expect(status).toBe(400)
    expect(body.message).toContain('Mana Crypp')
  })

  test('remove/commit refuses an unknown name and removes nothing', async () => {
    await seedCardNames('Sol Ring')

    const { status, body } = await callJson<{ message: string }>(
      handleRemoveCommit,
      'POST',
      '/api/remove/commit',
      {
        removes: [
          { listType: 'collection', listSlug: 'binder', name: 'Sol Rung', cardId: 1, copyIndex: 0 },
        ],
        validateCardNames: true,
      },
    )
    expect(status).toBe(400)
    expect(body.message).toContain('Sol Rung')
    expect(await Bun.file(`${ws.dir}/collections/binder.md`).text()).toContain('Sol Ring')
  })
})

describe('a move route with validateCardNames', () => {
  function move(name: string, validateCardNames?: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      moves: [
        {
          listType: 'collection',
          listSlug: 'binder',
          name,
          cardId: name === 'Sol Ring' ? 1 : 2,
          copyIndex: 0,
          toType: 'deck',
          toSlug: 'burn',
        },
      ],
    }
    if (validateCardNames !== undefined) body.validateCardNames = validateCardNames
    return body
  }

  test('refuses an unknown name before touching any file', async () => {
    await seedCardNames('Sol Ring')
    const before = await Bun.file(`${ws.dir}/collections/binder.md`).text()

    const { status, body } = await callJson<{ message: string }>(
      handleSelectedMove,
      'POST',
      '/api/move/selected',
      move('Sol Rung', true),
    )
    expect(status).toBe(400)
    expect(body.message).toContain('Sol Rung')
    expect(await Bun.file(`${ws.dir}/collections/binder.md`).text()).toBe(before)
  })

  test('a name already in a list is accepted even though no cache holds it', async () => {
    await seedCardNames('Sol Ring')

    const { status, body } = await callJson<{ moved: number }>(
      handleSelectedMove,
      'POST',
      '/api/move/selected',
      move('Homemade Proxy Beast', true),
    )
    expect(status).toBe(200)
    // 200 alone would also be the answer if the move had been silently skipped.
    expect(body.moved).toBe(1)
    expect(await Bun.file(`${ws.dir}/decks/burn.md`).text()).toContain('Homemade Proxy Beast')
  })
})
