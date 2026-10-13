import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleImportDeck, type ImportDeckResponse } from '../../src/admin/api/import-deck'
import { renderSyncMessage, syncMessage } from '../../src/sync/message'
import { keyedMessage } from '../helpers/api-message'
import { pseudoCatalog, withSyntheticLocaleAsync } from '../helpers/sync-text'
import { apiRequest } from './helpers/request'
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

/** A whole import-deck answer: the status, and the body (a success or a refusal). */
type ImportDeckReply = { status: number; body: ImportDeckResponse }

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

describe('POST /api/import-deck reporting (Integration)', () => {
  /** The route's full answer, parsed. */
  async function importDeck(body: unknown): Promise<ImportDeckReply> {
    const resp = await handleImportDeck(apiRequest('POST', '/api/import-deck', body))
    return { status: resp.status, body: (await resp.json()) as ImportDeckResponse }
  }

  test('tells a line imported without its labels from a line it skipped', async () => {
    // One skipped line, one label the deck cannot carry, one conflicting labels
    // token: the two kept cards are counted apart from the lost line, by the
    // parser's mark rather than by comparing warning text.
    const { status, body } = await importDeck({
      mode: 'text',
      name: 'Mixed',
      content: '1 Sol Ring [keep]\nnot a card line\n1 Arcane Signet [sale,no-sale]\n',
    })
    expect(status).toBe(200)
    expect(body.messageParams).toEqual({
      name: 'Mixed',
      notes: {
        list: [
          { messageKey: 'admin.api.importDeck.skippedNote', messageParams: { count: 1 } },
          { messageKey: 'admin.api.importDeck.labelsDroppedNote', messageParams: { count: 2 } },
        ],
        join: 'concat',
      },
    })
    expect(body.warnings.map((warning) => warning.labelsDropped === true)).toEqual([
      true,
      false,
      true,
    ])
    expect(body.warnings[1]?.messageKey).toBe('domain.import.text.malformedLine')
  })

  test('a deck service’s error reply answers English plus its key, whatever the server speaks', async () => {
    stub.restore()
    stub = stubFetch({
      'https://www.mtggoldfish.com/deck/404': () =>
        new Response('', { status: 404, statusText: 'Not Found' }),
    })
    const { status, body } = await withSyntheticLocaleAsync('en-XA', pseudoCatalog(), (locale) => {
      // Vacuity guard: the pseudo-locale is in force and words this differently.
      const english = syncMessage('domain.import.url.mtgGoldfishPageFailed', {
        status: 404,
        statusText: 'Not Found',
      })
      expect(renderSyncMessage(english, locale)).not.toBe(english.message)
      return importDeck({
        mode: 'url',
        url: 'https://www.mtggoldfish.com/deck/404',
        syncPrintings: true,
      })
    })
    expect(status).toBe(500)
    expect(body.messageKey).toBe('domain.import.url.mtgGoldfishPageFailed')
    expect(keyedMessage(body)).toBe('Failed to fetch MTGGoldfish page: 404 Not Found')
  })
})
