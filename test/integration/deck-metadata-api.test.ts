import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { handleMetadataSave, type MetadataResponse } from '../../src/admin/api/metadata'
import { bindWorkspace, writeCollectionFile, writeDeckFile } from './helpers/workspace'
import type { BoundWorkspace } from './helpers/workspace'

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

async function put(target: string, body: unknown): Promise<MetadataCall> {
  const resp = await handleMetadataSave(
    new Request(`http://localhost/api/metadata/${target}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: resp.status, body: (await resp.json()) as MetadataBody }
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

  test('flat lists carry no front matter, so they are refused with a pointer at rename', async () => {
    await writeCollectionFile(ws.dir, 'binder', { title: 'Binder', entries: [] })
    const { status, body } = await put('collection/binder', { description: 'nope' })
    expect(status).toBe(400)
    expect(body).toMatchObject({ success: false })
    expect(JSON.stringify(body)).toContain('rename')
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

  test('the hash sidecar is written alongside the deck', async () => {
    const { body } = await put('deck/my-deck', { description: 'Hashed' })
    const sidecar = await fs.readFile(path.join(ws.dir, 'decks', 'my-deck.md.sha256'), 'utf-8')
    expect(sidecar.trim()).toBe(expectSuccess(body).contentHash)
  })
})
