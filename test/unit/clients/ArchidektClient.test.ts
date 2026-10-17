import { describe, test, expect, mock } from 'bun:test'
import { keyedMessage } from '../../helpers/api-message'
import {
  ArchidektClient,
  DEFAULT_CSV_UPLOAD_FILE_NAME,
  MAX_LIST_PAGES,
  nextPageUrl,
  type ArchidektCardQuery,
  type CollectionCsvUploadOptions,
} from '../../../src/clients/ArchidektClient'
import { MemoryLogger, resetLogger, setLogger } from '../../test-utils'
import { ArchidektRequestError } from '../../../src/auth/archidekt-reply'
import {
  isMessageParseError,
  isSyncMessage,
  renderSyncMessage,
  type SyncMessage,
} from '../../../src/sync/message'
import type { MessageKey } from '../../../src/i18n/messages/en'
import {
  pseudoCatalog,
  pseudoPlural,
  pseudoString,
  rejectedSyncMessage,
  withGuardedLocaleAsync,
} from '../../helpers/sync-text'
import { requestFailureOf } from '../../helpers/rejection'
import {
  type ArchidektCardSearchResult,
  type ArchidektDeckResponse,
  parseArchidektDeckResponse,
  withoutEmptyCards,
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
    const { decks, cutShort } = await client.fetchPublicDecks('user1')

    expect(mockFetch).toHaveBeenCalled()
    expect(cutShort).toBeUndefined()
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
    const { decks } = await client.fetchOwnDecks('mytoken')

    expect(mockFetch).toHaveBeenCalled()
    expect(decks).toEqual([
      {
        id: 3,
        name: 'My Private Deck',
        updatedAt: '2023-01-03',
        deckFormat: 3,
        owner: { username: 'me' },
      },
    ])
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
    const { deck } = await client.fetchImportedDeck('1')
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
    const { deck, categories } = await client.fetchImportedDeck('12345', 'mytoken')

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
    // `Commander` is a board, so only the role category reaches the import.
    expect(categories).toEqual([{ name: 'Forest', categories: ['Land'] }])
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

  test('skips and reports entries whose quantity no card line can hold', () => {
    const logger = new MemoryLogger()
    setLogger(logger)
    try {
      const response: ArchidektDeckResponse = {
        name: 'Odd Counts',
        cards: [
          { quantity: -1, card: { name: 'Plains' } },
          { quantity: 1.5, card: { name: 'Swamp' } },
          { quantity: 2, card: { name: 'Forest' } },
        ],
      }
      const cards = parseArchidektDeckResponse(response, '9').sections.flatMap((s) => s.cards)
      expect(cards.map((card) => [card.name, card.quantity])).toEqual([['Forest', 2]])
      const warnings = logger.entries.filter((e) => e.level === 'warn')
      expect(warnings).toHaveLength(1)
      expect(String(warnings[0]?.args[0])).toBe(
        'Archidekt deck 9: skipped 2 card entries whose quantity no deck can hold (negative, a fraction, or too large).',
      )
    } finally {
      resetLogger()
    }
  })

  test('keeps a zero-copy relation for deck sync, silently; an import drops it', () => {
    // Archidekt keeps a relation whose copies were all taken out. Deck sync's
    // diff must see it — a push that re-adds the card patches that relation
    // rather than adding a second one — so only the import drops it.
    const logger = new MemoryLogger()
    setLogger(logger)
    try {
      const response: ArchidektDeckResponse = {
        name: 'Emptied',
        cards: [
          { quantity: 0, card: { name: 'Island' } },
          { quantity: 2, card: { name: 'Forest' } },
        ],
      }
      const parsed = parseArchidektDeckResponse(response, '9')
      expect(parsed.sections.flatMap((s) => s.cards.map((c) => [c.name, c.quantity]))).toEqual([
        ['Island', 0],
        ['Forest', 2],
      ])
      expect(logger.entries.filter((e) => e.level === 'warn')).toEqual([])
      const imported = withoutEmptyCards(parsed)
      expect(imported.sections.flatMap((s) => s.cards.map((c) => [c.name, c.quantity]))).toEqual([
        ['Forest', 2],
      ])
    } finally {
      resetLogger()
    }
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
    expect(page.owner?.id).toBe(424242)
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

  test('creates a record with no id in the body', async () => {
    const { client, requests } = recordingClient(() =>
      jsonResponse({ id: 777, createdAt: 'now', modifiedAt: 'now' }),
    )

    await client.createCollectionRecord(upsertBody(), 'mytoken')

    expect(requests[0]?.url).toBe('https://archidekt.com/api/collection/v2/')
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.headers).toEqual({
      Authorization: 'JWT mytoken',
      'Content-Type': 'application/json',
    })
    expect(requests[0]?.body).toEqual(upsertBody())
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

    // The wording is pinned per request in archidekt-failures.test.ts.
    const [message] = await requestFailureOf(client.deleteCollectionRecords(ids, 'mytoken'))
    expect(message.messageKey).toBe('domain.sync.archidekt.recordsDeleteFailedWithReason')
    expect(requests).toHaveLength(2)
  })

  test('a failed delete reads whole in the CLI’s language, its count nested', async () => {
    const { client } = recordingClient(() => new Response('', { status: 500 }))

    const error = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
      client.deleteCollectionRecords([1, 2], 'mytoken').then(
        () => new Error('expected the delete to fail'),
        (reason: unknown) => reason,
      ),
    )

    // The thrown error's text is the CLI's (rendered where it was raised); the
    // count inside it is worded in the same language, not glued in English.
    const records = pseudoPlural('domain.count.collectionRecords').replace('{count}', '2')
    expect(error instanceof ArchidektRequestError && error.message).toBe(
      pseudoString('domain.sync.archidekt.recordsDeleteFailed')
        .replace('{records}', records)
        .replace('{status}', '500'),
    )
    expect(error instanceof ArchidektRequestError && error.syncMessage.message).toBe(
      'Failed to delete 2 collection records from the Archidekt collection (HTTP 500)',
    )
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
    expect(result.unreadable).toEqual([{ chunk: 1, message: expect.anything(), body }])
    expect(result.unreadable.map((entry) => keyedMessage(entry.message))).toEqual([message])
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
    expect(
      result.unreadable.map((entry) => ({ ...entry, message: keyedMessage(entry.message) })),
    ).toEqual([
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

    const [message] = await requestFailureOf(
      client.uploadCollectionCsv(csvWithRows(ARCHIDEKT_CSV_CHUNK_SIZE + 1), UID_COLUMNS, 'mytoken'),
    )
    expect(message.messageParams).toEqual({ chunk: 2, status: 400, reason: 'bad csv' })
    expect(uploads).toHaveLength(2)
  })

  test('a CSV with no data rows makes no request at all', async () => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(0))

    const result = await client.uploadCollectionCsv(`${CSV_HEADER}\n`, UID_COLUMNS, 'mytoken')

    expect(uploads).toEqual([])
    expect(result).toEqual({ rowCount: 0, chunkCount: 0, rows: [], unreadable: [] })
  })

  test.each<[string, CollectionCsvUploadOptions, MessageKey]>([
    [
      'a mapping that pins no printing',
      { columns: ['quantity', 'condition'], header: true },
      'domain.import.archidekt.csvNoPrintingColumns',
    ],
    ['no columns at all', { columns: [], header: true }, 'domain.import.archidekt.csvNoColumns'],
  ])('refuses %s before sending anything', async (_label, options, key) => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(1))

    const message = await rejectedSyncMessage(
      client.uploadCollectionCsv(csvWithRows(1), options, 'mytoken'),
    )

    // The column check's own refusal, unwrapped: it already says what is wrong.
    expect(message.messageKey).toBe(key)
    expect(uploads).toEqual([])
  })

  test('refuses an unreadable CSV before sending anything, nesting why', async () => {
    const { client, uploads } = uploadRecorder(() => uploadResponse(1))

    expect(
      await rejectedSyncMessage(
        client.uploadCollectionCsv(`${CSV_HEADER}\n"uid-1,1,Normal,NM\n`, UID_COLUMNS, 'mytoken'),
      ),
    ).toEqual({
      message:
        'The CSV for Archidekt could not be read: Unterminated quoted field starting on line 2',
      messageKey: 'domain.sync.archidekt.csvUnreadable',
      messageParams: {
        reason: { messageKey: 'domain.import.csv.unterminatedQuote', messageParams: { line: 2 } },
      },
    })
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

  /** A search for `name`, labelled in its failures as the caller's own line would be. */
  function query(name: string, set?: string, collectorNumber?: string): ArchidektCardQuery {
    return { name, set, collectorNumber, label: `${name} [label]` }
  }

  test('pins the printing by collector number', async () => {
    const { client, requests } = recordingClient(() =>
      jsonResponse({ results: [searchResult(1, '105'), searchResult(2, '106')] }),
    )

    const result = await client.searchCards(
      query('Loot, Exuberant Explorer', 'FDN', '106'),
      'mytoken',
    )

    const url = new URL(requests[0]!.url)
    expect(url.searchParams.get('nameSearch')).toBe('Loot, Exuberant Explorer')
    expect(url.searchParams.get('editionSearch')).toBe('fdn')
    expect(url.searchParams.get('collectorNumber')).toBe('106')
    expect(isSyncMessage(result) ? result : result.id).toBe(2)
  })

  test('omits the collector number from the query when none is given', async () => {
    const { client, requests } = recordingClient(() =>
      jsonResponse({ results: [searchResult(1, '105')] }),
    )

    await client.searchCards(query('Loot, Exuberant Explorer', 'fdn'), 'mytoken')

    expect(new URL(requests[0]!.url).searchParams.has('collectorNumber')).toBe(false)
  })

  test('the not-found refusal names the card as the caller labels it', async () => {
    const { client } = recordingClient(() => jsonResponse({ results: [searchResult(1, '105')] }))

    const result = await client.searchCards(
      { ...query('Loot, Exuberant Explorer', 'fdn', '106'), label: 'Loot (FDN:106) [foil] [ja]' },
      'mytoken',
    )

    expect(result).toEqual({
      message: 'Card not found on Archidekt: Loot (FDN:106) [foil] [ja]',
      messageKey: 'domain.sync.archidekt.cardNotFound',
      messageParams: { card: 'Loot (FDN:106) [foil] [ja]' },
    })
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
      query('Delver of Secrets // Insectile Aberration', 'isd', '51'),
      'mytoken',
    )

    expect(new URL(requests[0]!.url).searchParams.get('nameSearch')).toBe('Delver of Secrets')
    expect(isSyncMessage(result) ? result : result.id).toBe(77)
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

    const result = await client.searchCards(query('Wear // Tear', 'dgm', '225'), 'mytoken')

    expect(isSyncMessage(result) ? result : result.id).toBe(88)
  })

  test('still refuses a different card when nothing pins the printing', async () => {
    const { client } = recordingClient(() => jsonResponse({ results: [searchResult(1, '105')] }))

    const result = await client.searchCards(query('Some Other Card'), 'mytoken')

    expect(isSyncMessage(result) && result.messageKey).toBe('domain.sync.archidekt.cardNotFound')
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

/** A client over `fetch`, unpaced. */
function unpacedClient(fetch: (url: string | URL, init?: RequestInit) => Promise<Response>) {
  return new ArchidektClient({ fetch }, { minRequestIntervalMs: 0 })
}

describe('ArchidektClient deck list pagination', () => {
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

    const listing = await unpacedClient(mockFetch).fetchPublicDecks('user1')

    expect(listing.decks.map((d) => d.id)).toEqual([1, 2, 3])
    expect(listing.cutShort).toBeUndefined()
    expect(urls).toHaveLength(3)
    // The http:// link Archidekt serves is upgraded, so no page costs a redirect.
    expect(urls[1]).toBe('https://archidekt.com/api/decks/v3/?page=2')
  })

  test('fetchOwnDecks paginates too, keeping the auth header on every page', async () => {
    const seenAuth: (string | undefined)[] = []
    const mockFetch = mock(async (url: string | URL, init?: RequestInit) => {
      seenAuth.push((init?.headers as Record<string, string> | undefined)?.Authorization)
      return url.toString().includes('page=2')
        ? new Response(deckPage(2, null))
        : new Response(deckPage(1, 'https://archidekt.com/api/decks/curated/self/?page=2'))
    })

    const { decks } = await unpacedClient(mockFetch).fetchOwnDecks('mytoken')

    expect(decks.map((d) => d.id)).toEqual([1, 2])
    expect(seenAuth).toEqual(['JWT mytoken', 'JWT mytoken'])
  })

  test('a relative `next` is followed against the page it arrived on', async () => {
    const urls: string[] = []
    const mockFetch = mock(async (url: string | URL) => {
      urls.push(url.toString())
      return url.toString().includes('page=2')
        ? new Response(deckPage(2, null))
        : new Response(deckPage(1, '/api/decks/v3/?ownerUsername=u&page=2'))
    })

    const { decks } = await unpacedClient(mockFetch).fetchPublicDecks('u')

    expect(decks.map((d) => d.id)).toEqual([1, 2])
    expect(urls[1]).toBe('https://archidekt.com/api/decks/v3/?ownerUsername=u&page=2')
  })

  test('a repeated page link ends the walk, cut short and saying so', async () => {
    const mockFetch = mock(
      async () => new Response(deckPage(1, 'https://archidekt.com/api/decks/v3/?page=2')),
    )

    const listing = await unpacedClient(mockFetch).fetchPublicDecks('user1')

    // Page 1 -> page 2 -> page 2 again: the walk ends rather than looping.
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(listing).toEqual({
      decks: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 1 })],
      cutShort: {
        message:
          'Archidekt served a next-page link it had already served (https://archidekt.com/api/decks/v3/?page=2); stopped after 2 decks.',
        messageKey: 'domain.sync.archidekt.pageRepeated',
        messageParams: {
          url: 'https://archidekt.com/api/decks/v3/?page=2',
          decks: { messageKey: 'domain.count.decks', messageParams: { count: 2 } },
        },
      },
    })
  })

  test('the page cap ends the walk, cut short and saying so', async () => {
    let page = 0
    const mockFetch = mock(async () => {
      page++
      return new Response(deckPage(page, `https://archidekt.com/api/decks/v3/?page=${page + 1}`))
    })

    const listing = await unpacedClient(mockFetch).fetchPublicDecks('user1')

    expect(listing.decks).toHaveLength(MAX_LIST_PAGES)
    expect(listing.cutShort).toEqual({
      message: `Stopped after ${MAX_LIST_PAGES} pages of Archidekt results; the list may be incomplete (${MAX_LIST_PAGES} decks so far).`,
      messageKey: 'domain.sync.archidekt.pageCapReached',
      messageParams: {
        pages: { messageKey: 'domain.count.pages', messageParams: { count: MAX_LIST_PAGES } },
        decks: { messageKey: 'domain.count.decks', messageParams: { count: MAX_LIST_PAGES } },
      },
    })
  })

  test('a declined next-page link ends the walk with what was read', async () => {
    const mockFetch = mock(
      async () => new Response(deckPage(1, 'https://evil.example.com/api/decks/v3/?page=2')),
    )

    const listing = await unpacedClient(mockFetch).fetchOwnDecks('mytoken')

    expect(listing.decks.map((d) => d.id)).toEqual([1])
    expect(listing.cutShort?.messageKey).toBe('domain.sync.archidekt.nextLinkForeign')
  })

  test('a cut-short warning reads whole in the CLI’s language, its count nested', async () => {
    const mockFetch = mock(
      async () => new Response(deckPage(1, 'https://archidekt.com/api/decks/v3/?page=2')),
    )

    const rendered = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), async (locale) => {
      const { cutShort } = await unpacedClient(mockFetch).fetchPublicDecks('u')
      return cutShort === undefined ? undefined : renderSyncMessage(cutShort, locale)
    })

    // The deck count nested in the warning is worded in the same language, not glued in English.
    const decks = pseudoPlural('domain.count.decks').replace('{count}', '2')
    expect(rendered).toBe(
      pseudoString('domain.sync.archidekt.pageRepeated')
        .replace('{url}', 'https://archidekt.com/api/decks/v3/?page=2')
        .replace('{decks}', decks),
    )
  })

  test('a missing `next` ends the walk without a refusal', () => {
    // Nothing to follow is the normal end of a walk, not a truncation.
    expect(nextPageUrl(null)).toBeUndefined()
    expect(nextPageUrl('')).toBeUndefined()
  })

  test.each<[string, SyncMessage]>([
    [
      'not a url',
      {
        message:
          'Archidekt served a next-page link that cannot be read, so it was not followed: not a url. The list may be incomplete.',
        messageKey: 'domain.sync.archidekt.nextLinkUnreadable',
        messageParams: { url: 'not a url' },
      },
    ],
    [
      'javascript:alert(1)',
      {
        message:
          'Archidekt served a next-page link that cannot be read, so it was not followed: javascript:alert(1). The list may be incomplete.',
        messageKey: 'domain.sync.archidekt.nextLinkUnreadable',
        messageParams: { url: 'javascript:alert(1)' },
      },
    ],
    [
      'https://evil.example.com/api/decks/v3/?page=2',
      {
        message:
          'Archidekt served a next-page link to another site (evil.example.com), so it was not followed: https://evil.example.com/api/decks/v3/?page=2. The list may be incomplete.',
        messageKey: 'domain.sync.archidekt.nextLinkForeign',
        messageParams: {
          host: 'evil.example.com',
          url: 'https://evil.example.com/api/decks/v3/?page=2',
        },
      },
    ],
  ])('a `next` of %p is declined, saying why', (next, refusal) => {
    // A silently-declined link is a truncated list that looks complete.
    const result = nextPageUrl(next)
    expect(isMessageParseError(result) ? result.error : result).toEqual(refusal)
  })

  test('a declined link is quoted on one line and capped', () => {
    const result = nextPageUrl(`\u001b[2Jnot\na url ${'x'.repeat(400)}`)

    expect(isMessageParseError(result) && result.error.messageParams).toEqual({
      url: `not a url ${'x'.repeat(290)}…`,
    })
  })

  test('an http link is upgraded, and a subdomain is still Archidekt', () => {
    expect(nextPageUrl('http://archidekt.com/api/decks/v3/?page=2')).toBe(
      'https://archidekt.com/api/decks/v3/?page=2',
    )
    expect(nextPageUrl('https://api.archidekt.com/api/decks/v3/?page=2')).toBe(
      'https://api.archidekt.com/api/decks/v3/?page=2',
    )
  })

  test('percent-encodes the username in the first page URL', async () => {
    const requested: string[] = []
    const mockFetch = mock(async (url: string | URL) => {
      requested.push(url.toString())
      return new Response(deckPage(1, null))
    })
    await unpacedClient(mockFetch).fetchPublicDecks('a b&c')

    expect(requested[0]).toContain('ownerUsername=a%20b%26c')
  })
})
