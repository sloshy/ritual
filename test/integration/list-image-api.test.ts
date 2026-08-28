import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import matter from 'gray-matter'
import { handleMetadataSave, type MetadataResponse } from '../../src/admin/api/metadata'
import { handleCollectionLoad } from '../../src/admin/api/collection-load'
import { handleDeckLoad } from '../../src/admin/api/deck-load'
import { handleWantedListLoad } from '../../src/admin/api/wanted-load'
import type {
  CollectionLoadResult,
  DeckLoadResult,
  WantedLoadResult,
} from '../../src/admin/api/load-results'
import { computeHash } from '../../src/changes/content-hash'
import { callJson } from './helpers/request'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'

/**
 * `PUT /api/metadata/:type/:slug` and the load routes, for a list's `image:`
 * cover — the client-neutral surface the admin modal, the MCP tool and the CLI
 * all go through.
 *
 * The grammar itself is unit-tested in test/unit/list-image.test.ts; what only
 * the handler can prove is here: that the mapping form reaches disk with the
 * card lines untouched, that a wanted list is served by the same route (its one
 * writable key) while still refusing `labels`, that a `card` reference is
 * checked against the very file being written, and that every load projects the
 * stored cover back out.
 */

let ws: BoundWorkspace
let deckPath: string
let collectionPath: string
let wantedPath: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false, clearCardCache: true })
  deckPath = await writeDeckFile(ws.dir, 'burn', {
    frontMatter: { name: 'Burn', format: 'modern' },
    cards: [
      { quantity: 4, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      { quantity: 3, name: 'Lava Spike', cardId: 2 },
    ],
  })
  collectionPath = await writeCollectionFile(ws.dir, 'binder', {
    title: 'Binder',
    entries: [
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
    ],
  })
  wantedPath = await writeWantedFile(ws.dir, 'wishlist', {
    title: 'Wishlist',
    entries: [{ name: 'Mana Crypt', cardId: 1 }],
  })
})

afterEach(async () => {
  await ws.dispose()
})

/** Either arm of the route's response, so the refusals stay typed too. */
type MetadataBody = MetadataResponse | { success: false; message: string }

function put(target: string, body: unknown): Promise<{ status: number; body: MetadataBody }> {
  return callJson<MetadataBody>(handleMetadataSave, 'PUT', `/api/metadata/${target}`, body)
}

/** Narrow a response to its success arm, failing the test when the write was refused. */
function expectSuccess(body: MetadataBody): MetadataResponse {
  if (!body.success) throw new Error(`expected a successful metadata write, got: ${body.message}`)
  return body
}

/** The YAML mapping and the markdown body below it, as gray-matter splits them. */
async function onDisk(filePath: string): Promise<{ data: Record<string, unknown>; body: string }> {
  const parsed = matter(await fs.readFile(filePath, 'utf-8'))
  return { data: parsed.data, body: parsed.content }
}

describe('writing a cover image', () => {
  test('each mode reaches disk in the mapping form, card lines untouched', async () => {
    const before = (await onDisk(deckPath)).body

    for (const image of [
      { card: 2 },
      { file: 'alters/burn.png' },
      { url: 'https://example.com/burn.jpg' },
    ]) {
      const { status, body } = await put('deck/burn', { image })
      expect(status).toBe(200)
      expect(expectSuccess(body).frontMatter).toMatchObject({ name: 'Burn', image })

      const file = await onDisk(deckPath)
      expect(file.data.image).toEqual(image)
      // The body below the block is what a metadata write must never touch.
      expect(file.body).toBe(before)
    }
  })

  test('null clears the key and leaves the rest of the block alone', async () => {
    await put('deck/burn', { image: { url: 'https://example.com/burn.jpg' } })
    const { body } = await put('deck/burn', { image: null })
    expect('image' in expectSuccess(body).frontMatter).toBeFalse()

    const file = await onDisk(deckPath)
    expect('image' in file.data).toBeFalse()
    expect(file.data).toMatchObject({ name: 'Burn', format: 'modern' })
  })

  test('a collection takes labels and an image in one body', async () => {
    const { status, body } = await put('collection/binder', {
      labels: ['sale'],
      image: { card: 1 },
    })
    expect(status).toBe(200)
    expect(expectSuccess(body).frontMatter).toMatchObject({
      labels: ['sale'],
      image: { card: 1 },
    })

    const file = await onDisk(collectionPath)
    expect(file.data).toMatchObject({ labels: ['sale'], image: { card: 1 } })
    expect(file.body).toContain('- Sol Ring (C21:263) &1')
  })

  test('a wanted list is written, not refused — the cover is its one key', async () => {
    const { status, body } = await put('wanted/wishlist', { image: { card: 1 } })
    expect(status).toBe(200)
    expect(expectSuccess(body).frontMatter).toEqual({ image: { card: 1 } })

    const file = await onDisk(wantedPath)
    expect(file.data.image).toEqual({ card: 1 })
    expect(file.body).toContain('- Mana Crypt &1')
  })
})

describe('refusals', () => {
  test('a scalar image is a 400 — there is no scalar spelling', async () => {
    const before = await fs.readFile(deckPath, 'utf-8')
    const { status, body } = await put('deck/burn', { image: '&12' })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('must be a mapping')
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)
  })

  test('an art path escaping the art directory is refused in the parser’s own words', async () => {
    const { status, body } = await put('deck/burn', { image: { file: '../secrets.png' } })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('escapes the art directory')
  })

  test('a card id no line carries is a 400 naming the raw id', async () => {
    const before = await fs.readFile(wantedPath, 'utf-8')
    const { status, body } = await put('wanted/wishlist', { image: { card: 99 } })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('&99')
    expect(await fs.readFile(wantedPath, 'utf-8')).toBe(before)
  })

  test('a missing art file is accepted — it may be added later', async () => {
    const { status } = await put('collection/binder', { image: { file: 'alters/not-yet.png' } })
    expect(status).toBe(200)
    expect(await fs.readFile(collectionPath, 'utf-8')).toContain(
      'image:\n  file: alters/not-yet.png',
    )
  })

  test('labels on a wanted list are refused by name, not silently dropped', async () => {
    const { status, body } = await put('wanted/wishlist', { labels: ['sale'] })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain("Unknown metadata field 'labels'")
    expect(JSON.stringify(body)).toContain('Accepted fields: description, image')
  })

  test('an unknown wanted list is a 404 named as a wanted list', async () => {
    const { status, body } = await put('wanted/nope', { image: { card: 1 } })
    expect(status).toBe(404)
    expect(JSON.stringify(body)).toContain('Wanted list')
  })

  test('a stale contentHash still conflicts on the wanted branch', async () => {
    const hash = computeHash(await fs.readFile(wantedPath, 'utf-8'))
    await put('wanted/wishlist', { image: { card: 1 } })
    const stale = await put('wanted/wishlist', {
      image: { url: 'https://example.com/x.jpg' },
      contentHash: hash,
    })
    expect(stale.status).toBe(409)
    expect((await onDisk(wantedPath)).data.image).toEqual({ card: 1 })
  })

  test('an unrecorded hand edit keeps its stale sidecar', async () => {
    // The write is front-matter only; stamping the sidecar would make
    // `detect-changes` treat the hand-added card line as already recorded.
    const sidecarPath = collectionPath + '.sha256'
    const staleHash = computeHash('something else entirely\n')
    await fs.writeFile(sidecarPath, staleHash + '\n')

    await put('collection/binder', { image: { card: 2 } })
    expect((await fs.readFile(sidecarPath, 'utf-8')).trim()).toBe(staleHash)
  })
})

describe('load projection', () => {
  test('every list type reports its stored cover on ?view=cards', async () => {
    await put('deck/burn', { image: { card: 1 } })
    await put('collection/binder', { image: { file: 'alters/binder.png' } })
    await put('wanted/wishlist', { image: { url: 'https://example.com/w.jpg' } })

    const deck = await callJson<DeckLoadResult>(handleDeckLoad, 'GET', '/api/deck/burn?view=cards')
    expect(deck.body.image).toEqual({ card: 1 })

    const collection = await callJson<CollectionLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(collection.body.image).toEqual({ file: 'alters/binder.png' })

    const wanted = await callJson<WantedLoadResult>(
      handleWantedListLoad,
      'GET',
      '/api/wanted/wishlist?view=cards',
    )
    expect(wanted.body.image).toEqual({ url: 'https://example.com/w.jpg' })
  })

  test('a list with no cover reports none rather than a null', async () => {
    const deck = await callJson<DeckLoadResult>(handleDeckLoad, 'GET', '/api/deck/burn?view=cards')
    expect(deck.body.image).toBeUndefined()
  })
})
