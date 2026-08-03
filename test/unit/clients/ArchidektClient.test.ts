import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import {
  ArchidektClient,
  DEFAULT_CSV_UPLOAD_FILE_NAME,
  MAX_LIST_PAGES,
  nextPageUrl,
  type CollectionCsvUploadOptions,
} from '../../../src/clients/ArchidektClient'
import { MemoryLogger, resetLogger, setLogger } from '../../test-utils'
import {
  type ArchidektCardSearchResult,
  type ArchidektDeckResponse,
  parseArchidektDeckResponse,
} from '../../../src/importers/archidekt-types'
import {
  ARCHIDEKT_CSV_CHUNK_SIZE,
  ARCHIDEKT_GAME_PAPER,
  ARCHIDEKT_LANGUAGE_ENGLISH,
  type ArchidektCollectionPage,
  type ArchidektCollectionRecord,
  type CollectionUpsertBody,
} from '../../../src/importers/archidekt-collection'

describe('ArchidektClient', () => {
  test('should fetch public decks', async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 1,
              name: 'Deck 1',
              updatedAt: '2023-01-01',
              deckFormat: 3,
              owner: { username: 'user1' },
            },
            {
              id: 2,
              name: 'Deck 2',
              updatedAt: '2023-01-02',
              deckFormat: 1,
              owner: { username: 'user1' },
            },
          ],
        }),
      )
    })

    const client = new ArchidektClient({ fetch: mockFetch })
    const decks = await client.fetchPublicDecks('user1')

    expect(mockFetch).toHaveBeenCalled()
    expect(decks).toHaveLength(2)
    expect(decks[0]?.id).toBe(1)
    expect(decks[1]?.name).toBe('Deck 2')
  })

  test('should fetch own decks with JWT token', async () => {
    const mockFetch = mock(async (_url: string | URL | Request, opts?: RequestInit) => {
      if ((opts?.headers as Record<string, string> | undefined)?.Authorization !== 'JWT mytoken') {
        return new Response('Unauthorized', { status: 401 })
      }
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 3,
              name: 'My Private Deck',
              updatedAt: '2023-01-03',
              deckFormat: 3,
              owner: { username: 'me' },
            },
          ],
        }),
      )
    })

    const client = new ArchidektClient({ fetch: mockFetch })
    const decks = await client.fetchOwnDecks('mytoken')

    expect(mockFetch).toHaveBeenCalled()
    expect(decks).toHaveLength(1)
    expect(decks[0]?.name).toBe('My Private Deck')
  })

  test('should throw error on failure', async () => {
    const mockFetch = mock(async () => new Response('Error', { status: 500 }))
    const client = new ArchidektClient({ fetch: mockFetch })

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.fetchPublicDecks('bad')).rejects.toThrow('Failed to fetch public decks')
  })

  test('should fall back to the Main section for unknown category IDs', async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: 1,
          name: 'Test Deck',
          cards: [
            {
              quantity: 1,
              card: { oracleCard: { name: 'Card A' } },
              categories: [99],
            },
          ],
          categories: [{ id: 1, name: 'Commander' }],
        }),
      )
    })
    const client = new ArchidektClient({ fetch: mockFetch })
    const deck = await client.fetchDeck('1')
    const main = deck.sections.find((s) => s.name === 'Main')
    expect(main).toBeDefined()
    expect(main?.cards).toEqual([{ name: 'Card A', quantity: 1 }])
  })

  test('should parse categories and description from deck response', async () => {
    const mockFetch = mock(async (_url: string | URL | Request, opts?: RequestInit) => {
      if ((opts?.headers as Record<string, string> | undefined)?.Authorization !== 'JWT mytoken') {
        return new Response('Unauthorized', { status: 401 })
      }
      return new Response(
        JSON.stringify({
          id: 12345,
          name: 'Test Deck',
          description: '{"ops":[{"insert":"Hello world"}]}',
          categories: [
            { id: 1, name: 'Commander' },
            { id: 2, name: 'Land' },
          ],
          cards: [
            {
              card: { oracleCard: { name: 'Sol Ring' } },
              quantity: 1,
              categories: [1],
            },
            {
              card: { oracleCard: { name: 'Forest' } },
              quantity: 10,
              categories: [2],
            },
          ],
        }),
      )
    })

    const client = new ArchidektClient({ fetch: mockFetch })
    const deck = await client.fetchDeck('12345', 'mytoken')

    expect(deck.name).toBe('Test Deck')
    expect(deck.sourceId).toBe('12345')
    expect(deck.description).toBe('Hello world')
    expect(deck.sections).toHaveLength(2)

    const commander = deck.sections.find((s) => s.name === 'Commander')
    expect(commander).toBeDefined()
    expect(commander?.cards).toHaveLength(1)
    expect(commander?.cards[0]?.name).toBe('Sol Ring')

    const main = deck.sections.find((s) => s.name === 'Main')
    expect(main).toBeDefined()
    expect(main?.cards).toHaveLength(1)
    expect(main?.cards[0]?.name).toBe('Forest')
    expect(main?.cards[0]?.quantity).toBe(10)
  })

  test('should parse a response with no categories and no cards', () => {
    const response: ArchidektDeckResponse = { name: 'X', cards: [] }
    expect(parseArchidektDeckResponse(response, '1').sections).toHaveLength(0)
  })

  test('maps the Archidekt format id onto a canonical format key', () => {
    const commander: ArchidektDeckResponse = { name: 'X', deckFormat: 3, cards: [] }
    expect(parseArchidektDeckResponse(commander, '1').format).toBe('commander')

    const oathbreaker: ArchidektDeckResponse = { name: 'X', deckFormat: 15, cards: [] }
    expect(parseArchidektDeckResponse(oathbreaker, '1').format).toBe('oathbreaker')
  })

  test('leaves the format unset for an Archidekt-only or missing format', () => {
    const custom: ArchidektDeckResponse = { name: 'X', deckFormat: 7, cards: [] }
    expect(parseArchidektDeckResponse(custom, '1').format).toBeUndefined()

    const none: ArchidektDeckResponse = { name: 'X', cards: [] }
    expect(parseArchidektDeckResponse(none, '1').format).toBeUndefined()
  })

  test('carries each entry printing (set, collector number, finish) into the deck', () => {
    const response: ArchidektDeckResponse = {
      name: 'Printings',
      cards: [
        {
          quantity: 2,
          modifier: 'Foil',
          card: {
            name: 'Lightning Bolt',
            oracleCard: { name: 'Lightning Bolt' },
            collectorNumber: '161',
            edition: { editioncode: 'LEA' },
          },
        },
        {
          quantity: 1,
          modifier: 'Normal',
          card: {
            name: 'Lightning Bolt',
            oracleCard: { name: 'Lightning Bolt' },
            collectorNumber: '146',
            edition: { editioncode: 'm10' },
          },
        },
      ],
    }

    const cards = parseArchidektDeckResponse(response, '1').sections[0]?.cards
    // Set codes are lowercased internally however Archidekt spells them; the two
    // printings of the same card stay separate lines.
    expect(cards).toEqual([
      {
        name: 'Lightning Bolt',
        quantity: 2,
        set: 'lea',
        collectorNumber: '161',
        finish: 'foil',
      },
      {
        name: 'Lightning Bolt',
        quantity: 1,
        set: 'm10',
        collectorNumber: '146',
        finish: undefined,
      },
    ])
  })

  test('merges entries of the same card and printing in one section', () => {
    const entry = {
      quantity: 3,
      card: {
        name: 'Mountain',
        oracleCard: { name: 'Mountain' },
        collectorNumber: '274',
        edition: { editioncode: 'm20' },
      },
    }
    const response: ArchidektDeckResponse = { name: 'Merge', cards: [entry, { ...entry }] }

    const cards = parseArchidektDeckResponse(response, '1').sections[0]?.cards
    expect(cards).toHaveLength(1)
    expect(cards?.[0]).toMatchObject({ name: 'Mountain', quantity: 6, set: 'm20' })
  })

  test('maps the etched modifier and tolerates a missing printing', () => {
    const response: ArchidektDeckResponse = {
      name: 'Etched',
      cards: [
        {
          quantity: 1,
          modifier: 'Etched',
          card: { name: 'Sol Ring', oracleCard: { name: 'Sol Ring' } },
        },
      ],
    }
    expect(parseArchidektDeckResponse(response, '1').sections[0]?.cards[0]).toEqual({
      name: 'Sol Ring',
      quantity: 1,
      set: undefined,
      collectorNumber: undefined,
      finish: 'etched',
    })
  })

  test('drops half a printing rather than carrying a set a card line cannot write', () => {
    // A card line is `(SET:NUM)` or nothing, so an entry with a set but no
    // collector number would serialize with the set silently gone — and would
    // compare as a distinct printing, producing two byte-identical lines.
    const response: ArchidektDeckResponse = {
      name: 'Half',
      cards: [
        { quantity: 3, card: { name: 'Forest', edition: { editioncode: 'UNF' } } },
        { quantity: 2, card: { name: 'Forest', edition: { editioncode: 'THB' } } },
      ],
    }
    const cards = parseArchidektDeckResponse(response, '1').sections[0]?.cards
    expect(cards).toHaveLength(1)
    expect(cards?.[0]).toMatchObject({ name: 'Forest', quantity: 5, set: undefined })
  })

  test('reports entries it had to skip for having no card name', () => {
    const logger = new MemoryLogger()
    setLogger(logger)
    try {
      const response: ArchidektDeckResponse = {
        name: 'Nameless',
        cards: [{ quantity: 1, card: undefined }, { quantity: 1 }],
      }
      expect(parseArchidektDeckResponse(response, '9').sections).toHaveLength(0)
      expect(logger.entries.filter((e) => e.level === 'warn')).toHaveLength(1)
      expect(String(logger.entries[0]?.args[0])).toContain('skipped 2 card entries')
    } finally {
      resetLogger()
    }
  })

  test('should throw error when fetchDeck fails', async () => {
    const mockFetch = mock(
      async () => new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    )
    const client = new ArchidektClient({ fetch: mockFetch })
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.fetchDeck('bad-id')).rejects.toThrow(/Failed to fetch deck/)
  })
})

// ── Collection API ──────────────────────────────────────────────────────

interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  /** The parsed JSON request body, or undefined when the request carried none. */
  body: unknown
}

interface RecordingClient {
  client: ArchidektClient
  requests: RecordedRequest[]
}

/** An ArchidektClient over a mock HttpClient that records every request it makes. */
function recordingClient(respond: (request: RecordedRequest) => Response): RecordingClient {
  const requests: RecordedRequest[] = []
  const fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const request: RecordedRequest = {
      url: url.toString(),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    requests.push(request)
    return respond(request)
  }
  return { client: new ArchidektClient({ fetch }), requests }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload))
}

function collectionRecord(): ArchidektCollectionRecord {
  return {
    id: 501,
    quantity: 2,
    modifier: 'Foil',
    language: ARCHIDEKT_LANGUAGE_ENGLISH,
    condition: 2,
    purchasePrice: null,
    tags: [],
    createdAt: '2026-07-01T00:00:00Z',
    modifiedAt: '2026-07-02T00:00:00Z',
    card: {
      id: 90210,
      uid: '00000000-0000-4000-8000-000000000001',
      collectorNumber: '106',
      options: ['Normal', 'Foil'],
      oracleCard: { id: 7, name: 'Loot, Exuberant Explorer' },
      edition: { editioncode: 'fdn' },
    },
  }
}

function collectionPage(): ArchidektCollectionPage {
  return {
    count: 1,
    results: [collectionRecord()],
    next: null,
    previous: null,
    page: 1,
    totalPages: 1,
    tags: [{ id: 3, name: 'Trade', color: '#ff0000' }],
    isPublic: true,
    owner: { id: 424242, username: 'test-user', avatar: '' },
  }
}

function upsertBody(): CollectionUpsertBody {
  return {
    game: ARCHIDEKT_GAME_PAPER,
    quantity: 3,
    card: 90210,
    modifier: 'Etched',
    language: ARCHIDEKT_LANGUAGE_ENGLISH,
    condition: 1,
    tags: [],
    purchasePrice: null,
  }
}

describe('ArchidektClient collection API', () => {
  test('fetches a collection page unauthenticated', async () => {
    const { client, requests } = recordingClient(() => jsonResponse(collectionPage()))

    const page = await client.fetchCollectionPage(424242, 2)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://archidekt.com/api/collection/424242/v2/?game=1&page=2')
    expect(requests[0]?.method).toBe('GET')
    expect(requests[0]?.headers).toEqual({})
    expect(page.results[0]?.card.edition.editioncode).toBe('fdn')
    expect(page.owner.id).toBe(424242)
    expect(page.next).toBeNull()
  })

  test('sends the JWT when fetching a private collection', async () => {
    const { client, requests } = recordingClient((request) =>
      request.headers.Authorization === 'JWT mytoken'
        ? jsonResponse(collectionPage())
        : new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    )

    const page = await client.fetchCollectionPage(424242, 1, 'mytoken')

    expect(requests[0]?.headers.Authorization).toBe('JWT mytoken')
    expect(page.count).toBe(1)
  })

  test('throws when a collection page is not visible', async () => {
    const { client } = recordingClient(
      () => new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    )

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.fetchCollectionPage(999, 1)).rejects.toThrow(
      'Failed to fetch collection page 1 for user 999: 404 Not Found',
    )
  })

  test('creates a record with no id in the body', async () => {
    const { client, requests } = recordingClient(() =>
      jsonResponse({ id: 777, createdAt: 'now', modifiedAt: 'now' }),
    )

    const created = await client.createCollectionRecord(upsertBody(), 'mytoken')

    expect(requests[0]?.url).toBe('https://archidekt.com/api/collection/v2/')
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.headers).toEqual({
      Authorization: 'JWT mytoken',
      'Content-Type': 'application/json',
    })
    expect(requests[0]?.body).toEqual(upsertBody())
    expect(created.id).toBe(777)
  })

  test('updates a record, merging the id from the URL into the body', async () => {
    const { client, requests } = recordingClient(() =>
      jsonResponse({ id: 501, createdAt: 'then', modifiedAt: 'now' }),
    )

    await client.updateCollectionRecord(501, upsertBody(), 'mytoken')

    expect(requests[0]?.url).toBe('https://archidekt.com/api/collection/v2/501/')
    expect(requests[0]?.method).toBe('PATCH')
    expect(requests[0]?.body).toEqual({ ...upsertBody(), id: 501 })
  })

  test('reports the response body when a write fails', async () => {
    const { client } = recordingClient(() => new Response('bad printing id', { status: 400 }))

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.createCollectionRecord(upsertBody(), 'mytoken')).rejects.toThrow(
      'createCollectionRecord failed (400): bad printing id',
    )
  })

  test('deletes records in batches of 25', async () => {
    const { client, requests } = recordingClient(() => new Response(null, { status: 204 }))
    const ids = Array.from({ length: 51 }, (_, i) => i + 1)

    await client.deleteCollectionRecords(ids, 'mytoken')

    expect(requests).toHaveLength(3)
    const batches = requests.map((r) => (r.body as { ids: number[] }).ids)
    expect(batches.map((b) => b.length)).toEqual([25, 25, 1])
    expect(batches.flat()).toEqual(ids)
    for (const request of requests) {
      expect(request.url).toBe('https://archidekt.com/api/collection/bulk/')
      expect(request.method).toBe('DELETE')
      expect(request.headers.Authorization).toBe('JWT mytoken')
    }
  })

  test('makes no request when there is nothing to delete', async () => {
    const { client, requests } = recordingClient(() => new Response(null, { status: 204 }))

    await client.deleteCollectionRecords([], 'mytoken')

    expect(requests).toHaveLength(0)
  })

  test('stops at the failing delete batch', async () => {
    let sent = 0
    const { client, requests } = recordingClient(() => {
      sent += 1
      return sent === 2
        ? new Response('nope', { status: 500 })
        : new Response(null, { status: 204 })
    })
    const ids = Array.from({ length: 60 }, (_, i) => i + 1)

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.deleteCollectionRecords(ids, 'mytoken')).rejects.toThrow(
      'deleteCollectionRecords (25 records) failed (500): nope',
    )
    expect(requests).toHaveLength(2)
  })
})

// ── CSV bulk upload ─────────────────────────────────────────────────────

/** One recorded multipart request: the form itself, plus what it was sent as. */
interface RecordedUpload {
  url: string
  method: string
  headers: Record<string, string>
  form: FormData
}

interface UploadRecorder {
  client: ArchidektClient
  uploads: RecordedUpload[]
}

/**
 * An ArchidektClient whose transport records the multipart form of every
 * request. A body that is not FormData fails the test loudly rather than
 * quietly recording nothing — the upload contract IS the form.
 */
function uploadRecorder(respond: (chunk: number) => Response): UploadRecorder {
  const uploads: RecordedUpload[] = []
  const fetch = (url: string | URL, init?: RequestInit): Promise<Response> => {
    if (!(init?.body instanceof FormData)) {
      throw new Error(`expected a FormData body, got ${typeof init?.body}`)
    }
    uploads.push({
      url: url.toString(),
      method: init.method ?? 'GET',
      headers: (init.headers as Record<string, string> | undefined) ?? {},
      form: init.body,
    })
    return Promise.resolve(respond(uploads.length))
  }
  return { client: new ArchidektClient({ fetch }), uploads }
}

const UID_COLUMNS: CollectionCsvUploadOptions = {
  columns: ['uid', 'quantity', 'modifier', 'condition'],
  header: true,
}

const CSV_HEADER = 'Scryfall ID,Quantity,Variant,Condition'

/** `uid-N,1,Normal,NM` data rows under the archidekt preset's header. */
function csvWithRows(count: number): string {
  const rows = Array.from({ length: count }, (_, i) => `uid-${i + 1},1,Normal,NM`)
  return [CSV_HEADER, ...rows].join('\n') + '\n'
}

/** One `{ data: [...] }` response with a clean result per row. */
function uploadResponse(rowCount: number): Response {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: rowCount }, () => ({
        ambiguous: false,
        notFound: false,
        errors: [],
      })),
    }),
  )
}

/** The uploaded file's name and text. */
type UploadedFile = { name: string; text: string }

/** The uploaded file's text, and the form fields as plain strings. */
async function uploadedFile(upload: RecordedUpload): Promise<UploadedFile> {
  const file = upload.form.get('file')
  if (!(file instanceof File)) throw new Error('the form carried no file')
  return { name: file.name, text: await file.text() }
}

function formFields(upload: RecordedUpload): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, value] of upload.form.entries()) {
    if (typeof value === 'string') fields[key] = value
  }
  return fields
}

describe('ArchidektClient.uploadCollectionCsv', () => {
  // Pacing between chunks is pinned where the clock seams live
  // (archidekt-rate-limit.test.ts, 'CSV chunk uploads pace between chunks too');
  // what this asserts is the split itself and the form each chunk carries.
  test('sends one chunk per 2000 data rows, the header on the first chunk only', async () => {
    const rowCount = ARCHIDEKT_CSV_CHUNK_SIZE + 1
    const { client, uploads } = uploadRecorder((chunk) =>
      uploadResponse(chunk === 1 ? ARCHIDEKT_CSV_CHUNK_SIZE : 1),
    )

    const result = await client.uploadCollectionCsv(csvWithRows(rowCount), UID_COLUMNS, 'mytoken')

    expect(uploads).toHaveLength(2)
    expect(uploads.map((u) => formFields(u).chunk)).toEqual(['1', '2'])
    expect(uploads.map((u) => formFields(u).chunkSize)).toEqual([
      String(ARCHIDEKT_CSV_CHUNK_SIZE),
      String(ARCHIDEKT_CSV_CHUNK_SIZE),
    ])

    const first = await uploadedFile(uploads[0]!)
    const second = await uploadedFile(uploads[1]!)
    const firstLines = first.text.trimEnd().split('\n')
    const secondLines = second.text.trimEnd().split('\n')
    // Archidekt treats the chunks as one continuous file and honors `skip` only
    // for chunk 1 (verified live 2026-07-27: a header repeated on chunk 2 was
    // imported as a card row) — so the header rides the first chunk alone, and
    // only the first chunk asks for a skipped line.
    expect(firstLines[0]).toBe(CSV_HEADER)
    expect(firstLines).toHaveLength(ARCHIDEKT_CSV_CHUNK_SIZE + 1)
    expect(firstLines[1]).toBe('uid-1,1,Normal,NM')
    expect(firstLines.at(-1)).toBe(`uid-${ARCHIDEKT_CSV_CHUNK_SIZE},1,Normal,NM`)
    expect(secondLines).toEqual([`uid-${rowCount},1,Normal,NM`])
    // Byte-exact: no leading blank line, no stray header, one trailing newline.
    expect(second.text).toBe(`uid-${rowCount},1,Normal,NM\n`)
    expect(uploads.map((u) => formFields(u).skip)).toEqual(['true', 'false'])

    // Row results are numbered across the whole upload, not per chunk.
    expect(result.rowCount).toBe(rowCount)
    expect(result.chunkCount).toBe(2)
    expect(result.rows).toHaveLength(rowCount)
    expect(result.rows.at(-1)?.row).toBe(rowCount - 1)
    expect(result.unreadable).toEqual([])
  })

  test('builds the upload/v2 form and lets FormData set its own content type', async () => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(2))

    await client.uploadCollectionCsv(csvWithRows(2), UID_COLUMNS, 'mytoken')

    const upload = uploads[0]!
    expect(upload.url).toBe('https://archidekt.com/api/collection/upload/v2/')
    expect(upload.method).toBe('POST')
    expect(upload.headers).toEqual({ Authorization: 'JWT mytoken' })
    expect(formFields(upload)).toEqual({
      fileType: 'csv',
      'columns[0]': 'uid',
      'columns[1]': 'quantity',
      'columns[2]': 'modifier',
      'columns[3]': 'condition',
      chunk: '1',
      chunkSize: String(ARCHIDEKT_CSV_CHUNK_SIZE),
      ifFound: 'add',
      skip: 'true',
      skipAmbiguousImports: 'true',
      defaultGame: '1',
      defaultLanguage: '1',
      defaultCondition: '1',
    })
    const file = await uploadedFile(upload)
    expect(file.name).toBe(DEFAULT_CSV_UPLOAD_FILE_NAME)
    expect(file.text).toBe(`${CSV_HEADER}\nuid-1,1,Normal,NM\nuid-2,1,Normal,NM\n`)
  })

  test('a header-less CSV skips nothing and uploads every row', async () => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(1))

    const result = await client.uploadCollectionCsv(
      'uid-1,1,Normal,NM\n',
      { ...UID_COLUMNS, header: false, fileName: 'mine.csv' },
      'mytoken',
    )

    expect(formFields(uploads[0]!).skip).toBe('false')
    expect(await uploadedFile(uploads[0]!)).toEqual({
      name: 'mine.csv',
      text: 'uid-1,1,Normal,NM\n',
    })
    expect(result.rowCount).toBe(1)
  })

  test('a quoted newline never splits a row', async () => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(1))

    await client.uploadCollectionCsv(
      `${CSV_HEADER}\n"uid\n-1",1,Normal,NM\n`,
      UID_COLUMNS,
      'mytoken',
    )

    expect((await uploadedFile(uploads[0]!)).text).toBe(`${CSV_HEADER}\n"uid\n-1",1,Normal,NM\n`)
  })

  test('reports every per-row outcome Archidekt sent', async () => {
    // Rows 1–2 use the live-verified shape (raw echo + imported verdict, 2026-07-27);
    // row 3 the older flags-only shape — both must come through.
    const { client } = uploadRecorder(
      () =>
        new Response(
          JSON.stringify({
            data: [
              {
                raw: '"uid-1","1","Normal","NM"\r\n',
                lineNumber: 2,
                id: 479503995,
                imported: true,
                ambiguous: false,
                notFound: false,
                errors: [],
              },
              {
                raw: '"uid-2","1","Normal","NM"\r\n',
                lineNumber: 3,
                id: null,
                imported: false,
                ambiguous: true,
                notFound: false,
                errors: [],
              },
              { ambiguous: false, notFound: true, errors: ['No card matched uid-3'] },
            ],
          }),
        ),
    )

    const result = await client.uploadCollectionCsv(csvWithRows(3), UID_COLUMNS, 'mytoken')

    expect(result.rows).toEqual([
      {
        row: 0,
        raw: '"uid-1","1","Normal","NM"\r\n',
        imported: true,
        ambiguous: false,
        notFound: false,
        errors: [],
      },
      {
        row: 1,
        raw: '"uid-2","1","Normal","NM"\r\n',
        imported: false,
        ambiguous: true,
        notFound: false,
        errors: [],
      },
      {
        row: 2,
        raw: undefined,
        imported: undefined,
        ambiguous: false,
        notFound: true,
        errors: ['No card matched uid-3'],
      },
    ])
    expect(result.unreadable).toEqual([])
  })

  test.each<[string, string, string]>([
    ['a non-JSON body', '<html>502 Bad Gateway</html>', 'the response was not JSON'],
    [
      'JSON without a data array',
      '{"detail":"ok"}',
      'the response carried no "data" array of per-row results',
    ],
    ['a bare array', '[1,2]', 'the response carried no "data" array of per-row results'],
  ])('carries %s through as unreadable instead of throwing', async (_label, body, message) => {
    const { client } = uploadRecorder(() => new Response(body))

    const result = await client.uploadCollectionCsv(csvWithRows(2), UID_COLUMNS, 'mytoken')

    expect(result.rows).toEqual([])
    expect(result.unreadable).toEqual([{ chunk: 1, message, body }])
    // The upload still happened, so the caller must not read this as "nothing sent".
    expect(result.rowCount).toBe(2)
    expect(result.chunkCount).toBe(1)
  })

  test('keeps the rows it can read when only part of the payload is odd', async () => {
    const body = JSON.stringify({
      data: ['nope', { ambiguous: false, notFound: false, errors: 'one bad row' }],
    })
    const { client } = uploadRecorder(() => new Response(body))

    const result = await client.uploadCollectionCsv(csvWithRows(3), UID_COLUMNS, 'mytoken')

    // Non-string error entries survive as JSON rather than being dropped.
    expect(result.rows).toEqual([
      {
        row: 1,
        raw: undefined,
        imported: undefined,
        ambiguous: false,
        notFound: false,
        errors: ['one bad row'],
      },
    ])
    expect(result.unreadable).toEqual([
      { chunk: 1, message: '1 of 2 row results in "data" were not objects', body },
      { chunk: 1, message: 'the response reported 2 row results for 3 uploaded rows', body },
    ])
  })

  test('truncates a huge unreadable body instead of carrying all of it', async () => {
    const { client } = uploadRecorder(() => new Response('x'.repeat(900)))

    const result = await client.uploadCollectionCsv(csvWithRows(1), UID_COLUMNS, 'mytoken')

    expect(result.unreadable[0]?.body).toBe(`${'x'.repeat(500)}…`)
  })

  test('a non-ok chunk fails with the response body, naming the chunk', async () => {
    const { client, uploads } = uploadRecorder((chunk) =>
      chunk === 1
        ? uploadResponse(ARCHIDEKT_CSV_CHUNK_SIZE)
        : new Response('bad csv', { status: 400 }),
    )

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(
      client.uploadCollectionCsv(csvWithRows(ARCHIDEKT_CSV_CHUNK_SIZE + 1), UID_COLUMNS, 'mytoken'),
    ).rejects.toThrow('uploadCollectionCsv (chunk 2) failed (400): bad csv')
    expect(uploads).toHaveLength(2)
  })

  test('a CSV with no data rows makes no request at all', async () => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(0))

    const result = await client.uploadCollectionCsv(`${CSV_HEADER}\n`, UID_COLUMNS, 'mytoken')

    expect(uploads).toEqual([])
    expect(result).toEqual({ rowCount: 0, chunkCount: 0, rows: [], unreadable: [] })
  })

  test.each<[string, CollectionCsvUploadOptions, string]>([
    [
      'a mapping that pins no printing',
      { columns: ['quantity', 'condition'], header: true },
      "must include 'uid'",
    ],
    ['no columns at all', { columns: [], header: true }, 'needs at least one column'],
  ])('refuses %s before sending anything', async (_label, options, message) => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(1))

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.uploadCollectionCsv(csvWithRows(1), options, 'mytoken')).rejects.toThrow(
      message,
    )
    expect(uploads).toEqual([])
  })

  test('refuses an unreadable CSV before sending anything', async () => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(1))

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(
      client.uploadCollectionCsv(`${CSV_HEADER}\n"uid-1,1,Normal,NM\n`, UID_COLUMNS, 'mytoken'),
    ).rejects.toThrow('the CSV could not be read — Unterminated quoted field starting on line 2')
    expect(uploads).toEqual([])
  })

  test('a name + collector number + edition mapping is accepted too', async () => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(1))

    await client.uploadCollectionCsv(
      'Sol Ring,263,c21,1\n',
      {
        columns: ['oracleCard__name', 'collectorNumber', 'edition__editioncode', 'quantity'],
        header: false,
      },
      'mytoken',
    )

    expect(formFields(uploads[0]!)['columns[2]']).toBe('edition__editioncode')
  })
})

describe('ArchidektClient.searchCards printing pinning', () => {
  function searchResult(id: number, collectorNumber: string): ArchidektCardSearchResult {
    return {
      id,
      collectorNumber,
      options: ['Normal', 'Foil'],
      oracleCard: { name: 'Loot, Exuberant Explorer', defaultCategory: 'Creature' },
    }
  }

  test('pins the printing by collector number', async () => {
    const { client, requests } = recordingClient(() =>
      jsonResponse({ results: [searchResult(1, '105'), searchResult(2, '106')] }),
    )

    const result = await client.searchCards('Loot, Exuberant Explorer', 'FDN', 'mytoken', '106')

    const url = new URL(requests[0]!.url)
    expect(url.searchParams.get('nameSearch')).toBe('Loot, Exuberant Explorer')
    expect(url.searchParams.get('editionSearch')).toBe('fdn')
    expect(url.searchParams.get('collectorNumber')).toBe('106')
    expect(typeof result === 'string' ? result : result.id).toBe(2)
  })

  test('omits the collector number from the query when none is given', async () => {
    const { client, requests } = recordingClient(() =>
      jsonResponse({ results: [searchResult(1, '105')] }),
    )

    await client.searchCards('Loot, Exuberant Explorer', 'fdn', 'mytoken')

    expect(new URL(requests[0]!.url).searchParams.has('collectorNumber')).toBe(false)
  })

  test('reports the pinned printing in the not-found error', async () => {
    const { client } = recordingClient(() => jsonResponse({ results: [searchResult(1, '105')] }))

    const result = await client.searchCards('Loot, Exuberant Explorer', 'fdn', 'mytoken', '106')

    expect(result).toBe('Card not found on Archidekt: Loot, Exuberant Explorer (FDN:106)')
  })

  /**
   * Archidekt indexes the oracle (front-face) name; Ritual's list files and the
   * Scryfall cache spell the full `Front // Back` name. Searching for the latter
   * matches nothing, so every double-faced card would otherwise fail to push.
   */
  test('searches a double-faced card by its front face', async () => {
    const dfc: ArchidektCardSearchResult = {
      id: 77,
      collectorNumber: '51',
      options: ['Normal', 'Foil'],
      oracleCard: { name: 'Delver of Secrets', defaultCategory: 'Creature' },
    }
    const { client, requests } = recordingClient(() => jsonResponse({ results: [dfc] }))

    const result = await client.searchCards(
      'Delver of Secrets // Insectile Aberration',
      'isd',
      'mytoken',
      '51',
    )

    expect(new URL(requests[0]!.url).searchParams.get('nameSearch')).toBe('Delver of Secrets')
    expect(typeof result === 'string' ? result : result.id).toBe(77)
  })

  test('accepts a uniquely pinned printing whose name is spelled differently', async () => {
    // A set plus a collector number identifies exactly one printing, so a lone
    // survivor of the pin is the right card whatever Archidekt calls it.
    const split: ArchidektCardSearchResult = {
      id: 88,
      collectorNumber: '225',
      options: ['Normal'],
      oracleCard: { name: 'Wear', defaultCategory: 'Instant' },
    }
    const { client } = recordingClient(() => jsonResponse({ results: [split] }))

    const result = await client.searchCards('Wear // Tear', 'dgm', 'mytoken', '225')

    expect(typeof result === 'string' ? result : result.id).toBe(88)
  })

  test('still refuses a different card when nothing pins the printing', async () => {
    const { client } = recordingClient(() => jsonResponse({ results: [searchResult(1, '105')] }))

    const result = await client.searchCards('Some Other Card', undefined, 'mytoken')

    expect(result).toBe('Card not found on Archidekt: Some Other Card')
  })
})

// ── Deck list pagination ────────────────────────────────────────────────

function deckPage(id: number, next: string | null): string {
  return JSON.stringify({
    count: 3,
    next,
    results: [
      { id, name: `Deck ${id}`, updatedAt: '2023-01-01', deckFormat: 3, owner: { username: 'u' } },
    ],
  })
}

describe('ArchidektClient deck list pagination', () => {
  let logger: MemoryLogger

  beforeEach(() => {
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(() => {
    resetLogger()
  })

  const warnings = (): string[] =>
    logger.entries.filter((e) => e.level === 'warn').map((e) => String(e.args[0]))

  test('follows every `next` link and returns all pages', async () => {
    const urls: string[] = []
    const mockFetch = mock(async (url: string | URL) => {
      const asString = url.toString()
      urls.push(asString)
      if (asString.includes('page=3')) return new Response(deckPage(3, null))
      if (asString.includes('page=2')) {
        return new Response(deckPage(2, 'http://archidekt.com/api/decks/v3/?page=3'))
      }
      return new Response(deckPage(1, 'http://archidekt.com/api/decks/v3/?page=2'))
    })

    const client = new ArchidektClient({ fetch: mockFetch }, { minRequestIntervalMs: 0 })
    const decks = await client.fetchPublicDecks('user1')

    expect(decks.map((d) => d.id)).toEqual([1, 2, 3])
    expect(urls).toHaveLength(3)
    // The http:// link Archidekt serves is upgraded, so no page costs a redirect.
    expect(urls[1]).toBe('https://archidekt.com/api/decks/v3/?page=2')
    expect(warnings()).toEqual([])
  })

  test('fetchOwnDecks paginates too, keeping the auth header on every page', async () => {
    const seenAuth: (string | undefined)[] = []
    const mockFetch = mock(async (url: string | URL, init?: RequestInit) => {
      seenAuth.push((init?.headers as Record<string, string> | undefined)?.Authorization)
      return url.toString().includes('page=2')
        ? new Response(deckPage(2, null))
        : new Response(deckPage(1, 'https://archidekt.com/api/decks/curated/self/?page=2'))
    })

    const client = new ArchidektClient({ fetch: mockFetch }, { minRequestIntervalMs: 0 })
    const decks = await client.fetchOwnDecks('mytoken')

    expect(decks.map((d) => d.id)).toEqual([1, 2])
    expect(seenAuth).toEqual(['JWT mytoken', 'JWT mytoken'])
  })

  test('stops and warns when the server repeats a page link', async () => {
    const mockFetch = mock(
      async () => new Response(deckPage(1, 'https://archidekt.com/api/decks/v3/?page=2')),
    )

    const client = new ArchidektClient({ fetch: mockFetch }, { minRequestIntervalMs: 0 })
    const decks = await client.fetchPublicDecks('user1')

    // Page 1 -> page 2 -> page 2 again: the walk ends rather than looping.
    expect(decks).toHaveLength(2)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(warnings()[0]).toContain('already served')
  })

  test('stops and warns at the page cap', async () => {
    let page = 0
    const mockFetch = mock(async () => {
      page++
      return new Response(deckPage(page, `https://archidekt.com/api/decks/v3/?page=${page + 1}`))
    })

    const client = new ArchidektClient({ fetch: mockFetch }, { minRequestIntervalMs: 0 })
    const decks = await client.fetchPublicDecks('user1')

    expect(decks).toHaveLength(MAX_LIST_PAGES)
    expect(warnings()[0]).toContain(`Stopped after ${MAX_LIST_PAGES} pages`)
  })

  test('a missing `next` ends the walk without a warning', async () => {
    // Nothing to follow is the normal end of a walk, not a truncation.
    expect(nextPageUrl(null)).toBeUndefined()
    expect(nextPageUrl('')).toBeUndefined()
    expect(warnings()).toEqual([])
  })

  test.each([
    ['not a url', 'unparseable'],
    ['https://evil.example.com/api/decks/v3/?page=2', 'unexpected host'],
  ])('a `next` of %p is declined out loud', (next, reason) => {
    // A silently-declined link is a truncated list that looks complete.
    expect(nextPageUrl(next)).toBeUndefined()
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain(reason)
  })

  test('an http link is upgraded, and a subdomain is still Archidekt', () => {
    expect(nextPageUrl('http://archidekt.com/api/decks/v3/?page=2')).toBe(
      'https://archidekt.com/api/decks/v3/?page=2',
    )
    expect(nextPageUrl('https://api.archidekt.com/api/decks/v3/?page=2')).toBe(
      'https://api.archidekt.com/api/decks/v3/?page=2',
    )
    expect(warnings()).toEqual([])
  })

  test('a relative `next` is resolved against the page it arrived on', () => {
    expect(nextPageUrl('/api/decks/v3/?page=2', 'https://archidekt.com/api/decks/v3/')).toBe(
      'https://archidekt.com/api/decks/v3/?page=2',
    )
    expect(warnings()).toEqual([])
  })

  test('a failure mid-walk aborts rather than returning a short list', async () => {
    const mockFetch = mock(async (url: string | URL) =>
      url.toString().includes('page=2')
        ? new Response('boom', { status: 500 })
        : new Response(deckPage(1, 'https://archidekt.com/api/decks/v3/?page=2')),
    )
    const client = new ArchidektClient({ fetch: mockFetch }, { minRequestIntervalMs: 0 })
    // Returning page 1 alone would be exactly the truncation the walk guards against.
    expect(client.fetchPublicDecks('user1')).rejects.toThrow('Failed to fetch public decks')
  })

  test('a page with no `results` array is an error, not an empty page', async () => {
    const mockFetch = mock(async () => new Response(JSON.stringify({ count: 0 })))
    const client = new ArchidektClient({ fetch: mockFetch }, { minRequestIntervalMs: 0 })
    expect(client.fetchPublicDecks('user1')).rejects.toThrow('no `results` array')
  })

  test('percent-encodes the username in the first page URL', async () => {
    const requested: string[] = []
    const mockFetch = mock(async (url: string | URL) => {
      requested.push(url.toString())
      return new Response(deckPage(1, null))
    })
    const client = new ArchidektClient({ fetch: mockFetch }, { minRequestIntervalMs: 0 })
    await client.fetchPublicDecks('a b&c')

    expect(requested[0]).toContain('ownerUsername=a%20b%26c')
  })
})
