import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  handleArtSave,
  parseCardArtSaveBody,
  type CardArtSaveResponse,
} from '../../src/admin/api/art'
import { handleCollectionLoad } from '../../src/admin/api/collection-load'
import type { CollectionCardsLoadResult } from '../../src/admin/api/load-results'
import { handleCollectionSave } from '../../src/admin/api/collection-save'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import {
  createAddChange,
  createRemoveChange,
  createSetLabelChange,
  type ChangeEvent,
} from '../../src/changes/change-event'
import type { CardLabel } from '../../src/card/card-labels'
import { DEFAULT_SECTION, type DeckData } from '../../src/list/deck'
import { computeHash } from '../../src/changes/content-hash'
import { artSidecarPath, saveCardArt } from '../../src/list/card-art'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
} from '../helpers/workspace'
import type { BoundWorkspace } from '../helpers/workspace'
import { callJson } from './helpers/request'

/**
 * `PUT /api/art/:type/:slug` against real list files and a real art directory.
 *
 * The reference grammar itself is unit-tested in test/unit/card-art.test.ts;
 * what matters here is the route's file side effects — which sidecar it writes,
 * that clearing the last entry removes it, and that a reference the workspace
 * cannot satisfy is refused before anything is written.
 */

let ws: BoundWorkspace
let collectionPath: string
let deckPath: string
let wantedPath: string

const IMAGE = 'proxies/sol-ring.png'

type ArtBody = CardArtSaveResponse | { success: false; message: string }

function put(
  type: string,
  slug: string,
  body: unknown,
): Promise<{ status: number; body: ArtBody }> {
  return callJson<ArtBody>(handleArtSave, 'PUT', `/api/art/${type}/${slug}`, body)
}

function expectSuccess(body: ArtBody): CardArtSaveResponse {
  if (!body.success) throw new Error(`expected a successful art write, got: ${body.message}`)
  return body
}

async function readSidecar(listPath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(artSidecarPath(listPath), 'utf-8'))
}

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  collectionPath = await writeCollectionFile(ws.dir, 'binder', {
    title: 'Binder',
    entries: [
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
    ],
  })
  deckPath = await writeDeckFile(ws.dir, 'goblins', {
    frontMatter: { name: 'Goblins' },
    cards: [{ name: 'Goblin Guide', quantity: 4, cardId: 1 }],
  })
  wantedPath = await writeWantedFile(ws.dir, 'needs', {
    title: 'Needs',
    entries: [{ name: 'Mox Ruby', set: 'lea', collectorNumber: '265', cardId: 1 }],
  })
  await fs.mkdir(path.join(ws.dir, 'art', 'proxies'), { recursive: true })
  await fs.writeFile(path.join(ws.dir, 'art', IMAGE), 'not really a png')
})

afterEach(async () => {
  await ws.dispose()
})

describe('handleArtSave', () => {
  test('writes a file reference into the collection’s sidecar', async () => {
    const { status, body } = await put('collection', 'binder', {
      cardId: 2,
      art: { file: IMAGE },
    })
    expect(status).toBe(200)
    expect(expectSuccess(body).art).toEqual({ file: IMAGE })
    expect(await readSidecar(collectionPath)).toEqual({ '2': { file: IMAGE } })
  })

  test('writes a URL reference into a deck’s sidecar', async () => {
    const { status } = await put('deck', 'goblins', {
      cardId: 1,
      art: { url: 'https://example.com/guide.png' },
    })
    expect(status).toBe(200)
    expect(await readSidecar(deckPath)).toEqual({
      '1': { url: 'https://example.com/guide.png' },
    })
  })

  test('writes a file reference into a wanted list’s sidecar', async () => {
    // Wanted lists carry no labels, but custom art is available on all three
    // types — the route must not have inherited the label surface's gate.
    const { status } = await put('wanted', 'needs', { cardId: 1, art: { file: IMAGE } })
    expect(status).toBe(200)
    expect(await readSidecar(wantedPath)).toEqual({ '1': { file: IMAGE } })
  })

  test('a second card joins the sidecar without disturbing the first', async () => {
    await put('collection', 'binder', { cardId: 1, art: { file: IMAGE } })
    await put('collection', 'binder', { cardId: 2, art: { url: 'https://example.com/b.png' } })
    expect(await readSidecar(collectionPath)).toEqual({
      '1': { file: IMAGE },
      '2': { url: 'https://example.com/b.png' },
    })
  })

  test('clearing the last entry removes the sidecar entirely', async () => {
    await put('collection', 'binder', { cardId: 1, art: { file: IMAGE } })
    const { status, body } = await put('collection', 'binder', { cardId: 1, art: null })
    expect(status).toBe(200)
    expect(expectSuccess(body).art).toBeNull()
    expect(await fs.exists(artSidecarPath(collectionPath))).toBeFalse()
  })

  test('clearing a card that had none leaves no sidecar behind', async () => {
    const { status } = await put('collection', 'binder', { cardId: 1, art: null })
    expect(status).toBe(200)
    expect(await fs.exists(artSidecarPath(collectionPath))).toBeFalse()
  })

  test('refuses a card id the list does not have', async () => {
    const { status, body } = await put('collection', 'binder', { cardId: 99, art: { file: IMAGE } })
    expect(status).toBe(400)
    expect(body).toMatchObject({ success: false })
    expect(body.message).toContain('99')
    expect(await fs.exists(artSidecarPath(collectionPath))).toBeFalse()
  })

  test('refuses a file that escapes the art directory', async () => {
    const { status, body } = await put('collection', 'binder', {
      cardId: 1,
      art: { file: '../secrets/key.png' },
    })
    expect(status).toBe(400)
    expect(body.message).toContain('escapes the art directory')
  })

  test('refuses a file that is not in the art directory, naming the path checked', async () => {
    const { status, body } = await put('collection', 'binder', {
      cardId: 1,
      art: { file: 'proxies/missing.png' },
    })
    expect(status).toBe(400)
    expect(body.message).toContain(path.join(ws.dir, 'art', 'proxies', 'missing.png'))
    expect(await fs.exists(artSidecarPath(collectionPath))).toBeFalse()
  })

  test('refuses a file that is not an image, even when it is there', async () => {
    await fs.writeFile(path.join(ws.dir, 'art', 'notes.txt'), 'not an image')
    const { status, body } = await put('collection', 'binder', {
      cardId: 1,
      art: { file: 'notes.txt' },
    })
    expect(status).toBe(400)
    expect(body.message).toContain('not an image file')
    expect(await fs.exists(artSidecarPath(collectionPath))).toBeFalse()
  })

  test('refuses a reference that is neither a file nor a url', async () => {
    const { status, body } = await put('collection', 'binder', { cardId: 1, art: { path: IMAGE } })
    expect(status).toBe(400)
    expect(body.message).toContain('no such key: path')
  })

  test('refuses a body missing its art field', async () => {
    const { status, body } = await put('collection', 'binder', { cardId: 1 })
    expect(status).toBe(400)
    expect(body.message).toContain('art is required')
  })

  test('refuses a list that does not exist', async () => {
    const { status, body } = await put('collection', 'nope', { cardId: 1, art: null })
    expect(status).toBe(404)
    expect(body).toMatchObject({ success: false })
  })

  test('refuses a write onto an unreadable sidecar, leaving its bytes untouched', async () => {
    // The route is read-modify-write, so a sidecar it cannot parse is the one
    // case where succeeding would *lose* data: every entry it could not read
    // would be dropped on the way back out, for cards this request never named.
    const hand = '{ "1": { "file": "keep-this.png" }, oops\n'
    await fs.writeFile(artSidecarPath(collectionPath), hand)

    const { status, body } = await put('collection', 'binder', { cardId: 2, art: { file: IMAGE } })
    expect(status).toBe(400)
    expect(body.message).toContain('not valid JSON')
    expect(await fs.readFile(artSidecarPath(collectionPath), 'utf-8')).toBe(hand)
  })
})

describe('parseCardArtSaveBody', () => {
  /** The refusal message, or a thrown failure naming what parsed instead. */
  function refusal(raw: Record<string, unknown>): string {
    const parsed = parseCardArtSaveBody(raw)
    if (typeof parsed !== 'string') {
      throw new Error(`expected a refusal, got: ${JSON.stringify(parsed)}`)
    }
    return parsed
  }

  test('refuses an unknown top-level field rather than dropping it', () => {
    // A typo'd field must not read as a successful write that changed nothing.
    expect(refusal({ cardId: 1, art: null, listType: 'collection' })).toContain('listType')
  })

  test('refuses a cardId that is not an &N', () => {
    for (const cardId of ['1', 0, -1, 1.5, Number.NaN, null, undefined]) {
      expect(refusal({ cardId, art: null })).toContain('&N')
    }
  })

  test('accepts both reference shapes and the clear', () => {
    expect(parseCardArtSaveBody({ cardId: 3, art: { file: IMAGE } })).toEqual({
      cardId: 3,
      art: { file: IMAGE },
    })
    expect(parseCardArtSaveBody({ cardId: 3, art: { url: 'https://example.com/a.png' } })).toEqual({
      cardId: 3,
      art: { url: 'https://example.com/a.png' },
    })
    expect(parseCardArtSaveBody({ cardId: 3, art: null })).toEqual({ cardId: 3, art: null })
  })
})

describe('a save reconciles the sidecar against the ids it freed', () => {
  /** POST the collection save route with the file's current hash. */
  async function save(changes: ChangeEvent[]): Promise<Response> {
    const contentHash = computeHash(await fs.readFile(collectionPath, 'utf-8'))
    return handleCollectionSave(
      new Request('http://localhost/api/collection/binder/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes, contentHash }),
      }),
    )
  }

  test('a removed card’s art does not pass to the card that reuses its &N', async () => {
    await put('collection', 'binder', { cardId: 2, art: { file: IMAGE } })

    // `&2` is released by the removal and handed straight to the added card.
    const resp = await save([
      createRemoveChange('Lightning Bolt', { cardId: 2, set: 'lea', collectorNumber: '161' }),
      createAddChange('Mox Ruby', { set: 'lea', collectorNumber: '265' }),
    ])
    expect(resp.status).toBe(200)
    expect(await fs.readFile(collectionPath, 'utf-8')).toContain('- Mox Ruby (LEA:265) &2')

    // Nothing is left filed under `&2`, so the newcomer renders its own art.
    expect(await fs.exists(artSidecarPath(collectionPath))).toBeFalse()
    const { body } = await callJson<CollectionCardsLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(body.customArt).toBeUndefined()
  })

  test('a removal and a re-add of the same card do not keep its art', async () => {
    await put('collection', 'binder', { cardId: 2, art: { file: IMAGE } })

    // The re-add lands on the `&2` the removal freed, and the written file is
    // byte for byte the one that was there — only the changes say the card that
    // owned the art left the list. Art returns by undoing the removal (which
    // takes it out of this payload) or by a re-add that names art of its own.
    const resp = await save([
      createRemoveChange('Lightning Bolt', { cardId: 2, set: 'lea', collectorNumber: '161' }),
      createAddChange('Lightning Bolt', { set: 'lea', collectorNumber: '161' }),
    ])
    expect(resp.status).toBe(200)
    expect(await fs.readFile(collectionPath, 'utf-8')).toContain('- Lightning Bolt (LEA:161) &2')
    expect(await fs.exists(artSidecarPath(collectionPath))).toBeFalse()
  })

  test('a card the save left alone keeps its art while another is removed', async () => {
    await put('collection', 'binder', { cardId: 1, art: { file: IMAGE } })

    const resp = await save([
      createRemoveChange('Lightning Bolt', { cardId: 2, set: 'lea', collectorNumber: '161' }),
    ])
    expect(resp.status).toBe(200)
    expect(await readSidecar(collectionPath)).toEqual({ '1': { file: IMAGE } })
  })

  test('a sidecar the reconcile cannot read comes back as an artWarnings warning', async () => {
    await fs.writeFile(artSidecarPath(collectionPath), '{ this is not json')

    // The removal frees `&2`, so the reconcile has work to do — and cannot do
    // it. The card lines were written all the same, so this is a warning on a
    // successful save rather than a failure: the response has to say so, or the
    // sidecar goes on filing art under a number the next card added inherits.
    const resp = await save([
      createRemoveChange('Lightning Bolt', { cardId: 2, set: 'lea', collectorNumber: '161' }),
    ])
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as { success: boolean; artWarnings?: string[] }
    expect(body.success).toBeTrue()
    expect((body.artWarnings ?? []).join('\n')).toContain('not valid JSON')
    expect(await fs.readFile(collectionPath, 'utf-8')).not.toContain('Lightning Bolt')
  })

  test('a clean save says nothing about the sidecar', async () => {
    await put('collection', 'binder', { cardId: 1, art: { file: IMAGE } })
    const resp = await save([
      createRemoveChange('Lightning Bolt', { cardId: 2, set: 'lea', collectorNumber: '161' }),
    ])
    expect(resp.status).toBe(200)
    expect(((await resp.json()) as { artWarnings?: string[] }).artWarnings).toBeUndefined()
  })

  test('a save that touches no ids leaves the sidecar alone', async () => {
    await put('collection', 'binder', { cardId: 1, art: { file: IMAGE } })
    const before = await fs.stat(artSidecarPath(collectionPath))

    const resp = await save([createAddChange('Mox Ruby', { set: 'lea', collectorNumber: '265' })])
    expect(resp.status).toBe(200)

    expect((await fs.stat(artSidecarPath(collectionPath))).mtimeMs).toBe(before.mtimeMs)
    expect(await readSidecar(collectionPath)).toEqual({ '1': { file: IMAGE } })
  })
})

describe('a deck line the save only re-quantified keeps its art', () => {
  /** The deck body the client posts back: one line, `labels` and quantity as given. */
  function goblins(quantity: number, labels: CardLabel[]): DeckData {
    return {
      name: 'Goblins',
      sections: [
        { name: DEFAULT_SECTION, cards: [{ name: 'Goblin Guide', quantity, cardId: 1, labels }] },
      ],
    }
  }

  async function saveDeck(deck: DeckData, changes: ChangeEvent[]): Promise<Response> {
    const contentHash = computeHash(await fs.readFile(deckPath, 'utf-8'))
    return handleDeckSave(
      new Request('http://localhost/api/deck/goblins/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes, deck, frontMatter: { name: 'Goblins' }, contentHash }),
      }),
    )
  }

  test('an increment, a label edit, and a decrement leave the art in place', async () => {
    // A one-copy line: labels are part of a change's identity now, so the
    // increment and the decrement around the label edit no longer cancel and
    // both reach the save. Counting removals against the copies alone would
    // read the single `remove` as "the line is gone" and delete the art of a
    // line that is still right there.
    await writeDeckFile(ws.dir, 'goblins', {
      frontMatter: { name: 'Goblins' },
      cards: [{ name: 'Goblin Guide', quantity: 1, cardId: 1 }],
    })
    await put('deck', 'goblins', { cardId: 1, art: { file: IMAGE } })

    const resp = await saveDeck(goblins(1, ['proxy']), [
      createAddChange('Goblin Guide', { cardId: 1 }),
      createSetLabelChange('Goblin Guide', { cardId: 1, labels: ['proxy'] }),
      createRemoveChange('Goblin Guide', { cardId: 1 }),
    ])
    expect(resp.status).toBe(200)
    expect(await readSidecar(deckPath)).toEqual({ '1': { file: IMAGE } })
  })

  test('taking the last copy of that line out still drops its art', async () => {
    await writeDeckFile(ws.dir, 'goblins', {
      frontMatter: { name: 'Goblins' },
      cards: [{ name: 'Goblin Guide', quantity: 1, cardId: 1 }],
    })
    await put('deck', 'goblins', { cardId: 1, art: { file: IMAGE } })

    const resp = await saveDeck({ name: 'Goblins', sections: [] }, [
      createRemoveChange('Goblin Guide', { cardId: 1 }),
    ])
    expect(resp.status).toBe(200)
    expect(await fs.exists(artSidecarPath(deckPath))).toBeFalse()
  })
})

describe('list loads carry the raw references', () => {
  test('a collection load returns customArt keyed by card id', async () => {
    await put('collection', 'binder', { cardId: 2, art: { file: IMAGE } })

    const { body } = await callJson<CollectionCardsLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(body.customArt).toEqual({ '2': { file: IMAGE } })
    expect(body.warnings).toEqual([])
    expect(body.artWarnings).toBeUndefined()
  })

  test('a list with no sidecar omits customArt', async () => {
    const { body } = await callJson<CollectionCardsLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(body.customArt).toBeUndefined()
  })

  test('art filed under a card the list no longer has is an art warning', async () => {
    // Written straight to the sidecar: the route refuses an unknown id, so an
    // orphan can only arrive by a hand edit or a card removed behind Ritual's back.
    await saveCardArt(collectionPath, new Map([[99, { file: IMAGE }]]))

    const { status, body } = await callJson<CollectionCardsLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(status).toBe(200)
    expect((body.artWarnings ?? []).join('\n')).toContain('99')
    // Never the save-blocking channel: that one means unreadable card lines,
    // and a bad sidecar must not make the list unsaveable.
    expect(body.warnings).toEqual([])
    // The list still loads, and no card claims the orphaned reference.
    expect(body.customArt).toBeUndefined()
  })

  test('a paged load does not report the cards it filtered out as orphans', async () => {
    await put('collection', 'binder', { cardId: 2, art: { file: IMAGE } })

    const { body } = await callJson<CollectionCardsLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards&limit=1',
    )
    expect(body.artWarnings).toBeUndefined()
  })

  test('an unreadable sidecar becomes an art warning rather than a failure', async () => {
    await fs.writeFile(artSidecarPath(collectionPath), '{ not json')

    const { status, body } = await callJson<CollectionCardsLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(status).toBe(200)
    expect(body.entries).toHaveLength(2)
    expect(body.customArt).toBeUndefined()
    expect((body.artWarnings ?? []).join('\n')).toContain('not valid JSON')
    expect(body.warnings).toEqual([])
  })

  test('a list whose art is fine but whose lines are not keeps the channels apart', async () => {
    // A non-bullet line the parser has to skip: exactly what `warnings` means.
    await fs.appendFile(collectionPath, 'stray text a save would delete\n')
    await put('collection', 'binder', { cardId: 2, art: { file: IMAGE } })

    const { body } = await callJson<CollectionCardsLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(body.warnings.length).toBeGreaterThan(0)
    expect(body.artWarnings).toBeUndefined()
  })
})
