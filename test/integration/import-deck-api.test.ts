import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleImportDeck } from '../../src/admin/api/import-deck'
import type { ApiMessage } from '../../src/api/result'
import {
  ARCHIDEKT_DECK_ID,
  ARCHIDEKT_DECK_URL,
  REMOTE_FOIL_DECK,
  readImportedDeck,
} from './helpers/import-fixtures'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

/**
 * The admin import endpoint's printing contract: a URL import must state
 * `syncPrintings` (there is nobody to prompt over HTTP), a text import must
 * not, and the answer decides whether the written deck keeps the printings
 * the source lists. The URL fetch itself and the save are covered elsewhere.
 */

const SOURCE_URL = `https://archidekt.com/decks/${ARCHIDEKT_DECK_ID}`

let ws: BoundWorkspace
let dir: string
let stub: StubbedFetch

type PostResult = { status: number; message: string }

async function postImport(body: unknown): Promise<PostResult> {
  const resp = await handleImportDeck(
    new Request('http://localhost/api/import-deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  const payload = (await resp.json()) as ApiMessage
  return { status: resp.status, message: payload.message }
}

beforeEach(async () => {
  ws = await bindWorkspace({ init: true })
  dir = ws.dir
  stub = stubFetch({ [ARCHIDEKT_DECK_URL]: () => Response.json(REMOTE_FOIL_DECK) })
})

afterEach(async () => {
  stub.restore()
  await ws.dispose()
})

describe('POST /api/import-deck printings (Integration)', () => {
  test('a URL import without syncPrintings is refused, naming the field', async () => {
    const { status, message } = await postImport({ mode: 'url', url: SOURCE_URL })
    expect(status).toBe(400)
    expect(message).toContain('syncPrintings is required')
    expect(await fs.readdir(path.join(dir, 'decks')).catch(() => [])).toEqual([])
  })

  test('syncPrintings: true keeps the printings the source lists', async () => {
    const { status } = await postImport({ mode: 'url', url: SOURCE_URL, syncPrintings: true })
    expect(status).toBe(200)
    expect(await readImportedDeck(dir)).toContain('1 Sol Ring (LTC:284) [foil] &1')
  })

  test('syncPrintings: false writes bare card names', async () => {
    const { status } = await postImport({ mode: 'url', url: SOURCE_URL, syncPrintings: false })
    expect(status).toBe(200)
    const deck = await readImportedDeck(dir)
    expect(deck).toContain('1 Sol Ring &1')
    expect(deck).not.toContain('LTC')
    expect(deck).not.toContain('[foil]')
  })

  test('a name/ID conflict without overwrite is a 400 naming the file, not a 500', async () => {
    const body = { mode: 'text', content: '1 Sol Ring', name: 'Dup' }
    expect((await postImport(body)).status).toBe(200)

    const { status, message } = await postImport(body)
    expect(status).toBe(400)
    expect(message).toContain("Import conflict for 'Dup.md'")
  })

  test('a deck name with nothing usable in a file name is a 400', async () => {
    const { status, message } = await postImport({
      mode: 'text',
      content: '1 Sol Ring',
      name: '???',
    })
    expect(status).toBe(400)
    expect(message).toContain('no characters usable in a file name')
    expect(await fs.readdir(path.join(dir, 'decks')).catch(() => [])).toEqual([])
  })

  test('overwriting a deck matched by source id commits the file it replaced', async () => {
    // The import's own slug (`Fetched Deck.md`) is not the file written when an
    // existing deck carries the same source id: that deck is replaced in place.
    await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'decks', 'Renamed.md'),
      `---\nname: Renamed\nsourceId: '${ARCHIDEKT_DECK_ID}'\n---\n1 Mountain &1\n`,
    )

    const { status } = await postImport({
      mode: 'url',
      url: SOURCE_URL,
      syncPrintings: true,
      overwrite: true,
    })

    expect(status).toBe(200)
    const files = (await fs.readdir(path.join(dir, 'decks'))).filter((f) => f.endsWith('.md'))
    expect(files).toEqual(['Renamed.md'])
    expect(await fs.readFile(path.join(dir, 'decks', 'Renamed.md'), 'utf-8')).toContain('Sol Ring')
  })

  test('a text import rejects syncPrintings — pasted text states its own printings', async () => {
    const { status, message } = await postImport({
      mode: 'text',
      content: '1 Sol Ring (LTC:284)',
      syncPrintings: false,
    })
    expect(status).toBe(400)
    expect(message).toContain('only applies to URL imports')
    expect(await fs.readdir(path.join(dir, 'decks')).catch(() => [])).toEqual([])
  })
})
