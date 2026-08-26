import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { handleMetadataSave, type MetadataResponse } from '../../src/admin/api/metadata'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
} from './helpers/workspace'
import type { BoundWorkspace } from './helpers/workspace'
import { callJson } from './helpers/request'
import { computeHash } from '../../src/changes/content-hash'

/**
 * `PUT /api/metadata/:type/:slug` — front-matter writes against real deck files.
 * The body validator is unit-tested; what matters here is the file side effect:
 * the YAML block is replaced and the card lines below it are left byte for byte
 * as they were, so a metadata edit never rewrites a deck.
 */

let ws: BoundWorkspace
let deckPath: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  deckPath = await writeDeckFile(ws.dir, 'my-deck', {
    frontMatter: { name: 'My Deck', format: 'commander', created: '2026-01-01T00:00:00.000Z' },
    cards: [
      { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
      { quantity: 2, name: 'Lightning Bolt', cardId: 2 },
    ],
  })
})

afterEach(async () => {
  await ws.dispose()
})

/** Either arm of the route's response, so the error cases stay typed too. */
type MetadataBody = MetadataResponse | { success: false; message: string }

type MetadataCall = { status: number; body: MetadataBody }

function put(target: string, body: unknown): Promise<MetadataCall> {
  return callJson<MetadataBody>(handleMetadataSave, 'PUT', `/api/metadata/${target}`, body)
}

/** Narrow a response to its success arm, failing the test when the write was refused. */
function expectSuccess(body: MetadataBody): MetadataResponse {
  if (!body.success) throw new Error(`expected a successful metadata write, got: ${body.message}`)
  return body
}

/** The markdown body below the front matter, as gray-matter splits it. */
async function deckBody(): Promise<string> {
  return matter(await fs.readFile(deckPath, 'utf-8')).content
}

describe('handleMetadataSave', () => {
  test('writes the given fields and leaves the card lines byte-identical', async () => {
    const before = await deckBody()

    const { status, body } = await put('deck/my-deck', {
      description: 'A ramp deck.',
      tags: ['ramp', 'budget'],
      format: 'modern',
      sourceUrl: 'https://archidekt.com/decks/123',
      sourceId: '123',
    })

    expect(status).toBe(200)
    expect(expectSuccess(body).frontMatter).toMatchObject({
      name: 'My Deck',
      created: '2026-01-01T00:00:00.000Z',
      description: 'A ramp deck.',
      tags: ['ramp', 'budget'],
      format: 'modern',
      sourceUrl: 'https://archidekt.com/decks/123',
      sourceId: '123',
    })
    expect(await deckBody()).toBe(before)

    const onDisk = matter(await fs.readFile(deckPath, 'utf-8')).data
    expect(onDisk.description).toBe('A ramp deck.')
    expect(onDisk.format).toBe('modern')
  })

  test('an empty tags array clears the key exactly like null', async () => {
    await put('deck/my-deck', { tags: ['ramp'] })
    const { body } = await put('deck/my-deck', { tags: [] })
    expect('tags' in expectSuccess(body).frontMatter).toBeFalse()
  })

  test.each([
    ['description', 'temporary'],
    ['tags', ['ramp']],
  ])('a null clears %s rather than writing YAML null', async (key, seed) => {
    // Assert the seed landed: without it, the clear below would pass vacuously
    // on a key that was never written in the first place.
    const seeded = await put('deck/my-deck', { [key]: seed })
    expect(key in expectSuccess(seeded.body).frontMatter).toBeTrue()

    const { body } = await put('deck/my-deck', { [key]: null })

    expect(key in expectSuccess(body).frontMatter).toBeFalse()
    const onDisk = await fs.readFile(deckPath, 'utf-8')
    expect(matter(onDisk).data[key]).toBeUndefined()
    // Scoped to the YAML block rather than the whole file, so a card name or note
    // containing the key never makes this pass or fail for the wrong reason: the
    // key must be gone, not written as `key: null`.
    expect(onDisk.split('---')[1] ?? '').not.toContain(`${key}:`)
  })

  test('a metadata write records no changelog — the changelog is card-level', async () => {
    await put('deck/my-deck', { description: 'A ramp deck.', tags: ['ramp'] })
    expect(await fs.exists(path.join(ws.dir, 'decks', 'my-deck.changes.md'))).toBeFalse()
  })

  test('a body whose very first line is a horizontal rule keeps its card lines', async () => {
    // Written raw: the body must start with `---` on the line immediately after
    // the closing delimiter. Handing that body to gray-matter as a *string* makes
    // it re-parse the rule as a second front-matter block, which turns the card
    // list into YAML keys and destroys it.
    await fs.writeFile(
      deckPath,
      '---\nname: My Deck\nformat: commander\n---\n---\n\n## Main\n1 Sol Ring (C21:240) &1\n',
    )

    await put('deck/my-deck', { description: 'Ruled.' })

    const after = await fs.readFile(deckPath, 'utf-8')
    expect(after).toContain('1 Sol Ring (C21:240) &1')
    expect(matter(after).data).toMatchObject({ name: 'My Deck', description: 'Ruled.' })
  })

  test('the returned hash reflects the write, and a stale hash is a 409', async () => {
    const firstHash = expectSuccess(
      (await put('deck/my-deck', { description: 'One' })).body,
    ).contentHash
    const second = await put('deck/my-deck', { description: 'Two', contentHash: firstHash })
    expect(second.status).toBe(200)
    expect(expectSuccess(second.body).contentHash).not.toBe(firstHash)

    // Replaying the now-stale hash must not clobber the newer write.
    const stale = await put('deck/my-deck', { description: 'Three', contentHash: firstHash })
    expect(stale.status).toBe(409)
    expect(matter(await fs.readFile(deckPath, 'utf-8')).data.description).toBe('Two')
  })

  test('a deck-only field on a collection is an unknown field, not silence', async () => {
    await writeCollectionFile(ws.dir, 'binder', { title: 'Binder', entries: [] })
    const { status, body } = await put('collection/binder', { tags: ['nope'] })
    expect(status).toBe(400)
    expect(body).toMatchObject({ success: false })
    expect(JSON.stringify(body)).toContain("Unknown metadata field 'tags'")
  })

  test('a wanted list takes description and image, so labels there are unknown', async () => {
    const { status, body } = await put('wanted/anything', { labels: ['sale'] })
    expect(status).toBe(400)
    expect(body).toMatchObject({ success: false })
    expect(JSON.stringify(body)).toContain("Unknown metadata field 'labels'")
  })

  test('a wanted list accepts a description write, card lines untouched', async () => {
    const wantedPath = await writeWantedFile(ws.dir, 'needs', {
      title: 'Needs',
      entries: [{ name: 'Sol Ring', cardId: 1 }],
    })
    const { status, body } = await put('wanted/needs', { description: 'Cards I still need.' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ frontMatter: { description: 'Cards I still need.' } })

    const content = await fs.readFile(wantedPath, 'utf-8')
    expect(content).toContain('- Sol Ring &1')
    expect(matter(content).data).toEqual({ description: 'Cards I still need.' })
  })

  test('an unknown field is a 400 and writes nothing', async () => {
    const before = await fs.readFile(deckPath, 'utf-8')
    const { status } = await put('deck/my-deck', { colour: 'blue' })
    expect(status).toBe(400)
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)
  })

  test('an unknown deck is a 404', async () => {
    const { status } = await put('deck/nope', { description: 'x' })
    expect(status).toBe(404)
  })

  test('the hash sidecar is refreshed when it already matched the file', async () => {
    const sidecarPath = path.join(ws.dir, 'decks', 'my-deck.md.sha256')
    await fs.writeFile(sidecarPath, computeHash(await fs.readFile(deckPath, 'utf-8')) + '\n')

    const { body } = await put('deck/my-deck', { description: 'Hashed' })
    expect((await fs.readFile(sidecarPath, 'utf-8')).trim()).toBe(expectSuccess(body).contentHash)
  })

  test('an unrecorded hand edit keeps its stale sidecar, so detect-changes still sees it', async () => {
    // The write is front-matter only and says nothing about the card lines
    // below. Stamping the sidecar here would make `detect-changes` treat the
    // hand-added card line as already recorded and drop its changelog entry.
    const sidecarPath = path.join(ws.dir, 'decks', 'my-deck.md.sha256')
    const staleHash = computeHash(await fs.readFile(deckPath, 'utf-8'))
    await fs.writeFile(sidecarPath, staleHash + '\n')
    await fs.appendFile(deckPath, '1 Mox Ruby &3\n')

    const { body } = await put('deck/my-deck', { description: 'Hand edited' })

    expect((await fs.readFile(sidecarPath, 'utf-8')).trim()).toBe(staleHash)
    // The returned hash still describes the new content — it is computed, not
    // read back from the sidecar.
    expect(expectSuccess(body).contentHash).toBe(computeHash(await fs.readFile(deckPath, 'utf-8')))
  })

  test('a sourceId that names a different Archidekt deck than sourceUrl is refused', async () => {
    // A sync addresses the deck by sourceId while every surface shows sourceUrl,
    // so this pair would push one deck's cards into another.
    await put('deck/my-deck', {
      sourceId: '999',
      sourceUrl: 'https://archidekt.com/decks/999',
    })
    const before = await fs.readFile(deckPath, 'utf-8')

    const { status, body } = await put('deck/my-deck', { sourceId: '123' })

    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('must name the same deck')
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)
  })

  test('a non-Archidekt source is left alone: its id follows the other service', async () => {
    const { status } = await put('deck/my-deck', {
      sourceId: 'abc123',
      sourceUrl: 'https://moxfield.com/decks/abc123',
    })
    expect(status).toBe(200)
  })
})
