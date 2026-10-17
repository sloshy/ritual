import { describe, expect, test } from 'bun:test'
import {
  ArchidektRequestError,
  archidektReasons,
  replyReasons,
} from '../../../src/auth/archidekt-reply'
import { ArchidektClient } from '../../../src/clients/ArchidektClient'
import { en, type MessageKey } from '../../../src/i18n/messages/en'
import {
  ARCHIDEKT_GAME_PAPER,
  ARCHIDEKT_LANGUAGE_ENGLISH,
  type CollectionUpsertBody,
} from '../../../src/importers/archidekt-collection'
import {
  isSyncMessage,
  syncMessage,
  type SyncMessage,
  type SyncMessageParams,
  type SyncParam,
} from '../../../src/sync/message'
import { requestFailureOf } from '../../helpers/rejection'

/**
 * How every Archidekt request fails: the wording of each request's key pair,
 * the shape of the reasons quoted from Archidekt's reply, and the refusals of
 * a reply that answered but cannot be used. The behaviour around a failure (a
 * walk that stops, a batch that is not sent) is pinned beside each request in
 * ArchidektClient.test.ts.
 */

/** A client whose every request is answered by `reply`, unpaced. */
function answering(reply: () => Response): ArchidektClient {
  return new ArchidektClient({ fetch: async () => reply() }, { minRequestIntervalMs: 0 })
}

function upsertBody(): CollectionUpsertBody {
  return {
    game: ARCHIDEKT_GAME_PAPER,
    quantity: 1,
    card: 90210,
    modifier: 'Normal',
    language: ARCHIDEKT_LANGUAGE_ENGLISH,
    condition: 1,
    tags: [],
    purchasePrice: null,
  }
}

/** What a request came to: its failure, and Archidekt's status when it was thrown. */
type Failure = [SyncMessage, number | undefined]

/** A thrown failure. */
const thrown = async (run: Promise<unknown>): Promise<Failure> => requestFailureOf(run)

/** A failure returned as the result (the card search never throws). */
async function returned(run: Promise<unknown>): Promise<Failure> {
  const result = await run
  if (!isSyncMessage<unknown>(result)) throw new Error('expected a refusal')
  return [result, undefined]
}

/** One request whose failure is worded by a key pair. */
type FailureRow = {
  key: MessageKey
  run: (client: ArchidektClient) => Promise<Failure>
  params: SyncMessageParams
  /** The plain key's English; the reason form adds `: <reason>`. */
  english: string
}

const RECORDS: SyncParam = {
  messageKey: 'domain.count.collectionRecords',
  messageParams: { count: 2 },
}

const ROWS: FailureRow[] = [
  {
    key: 'domain.sync.archidekt.deckFailed',
    run: (client) => thrown(client.fetchImportedDeck('31337')),
    params: { deckId: '31337' },
    english: 'Failed to fetch Archidekt deck 31337 (HTTP {status})',
  },
  {
    key: 'domain.sync.archidekt.publicDecksFailed',
    run: (client) => thrown(client.fetchPublicDecks('alice')),
    params: { username: 'alice' },
    english: 'Failed to fetch the public decks of Archidekt user alice (HTTP {status})',
  },
  {
    key: 'domain.sync.archidekt.ownDecksFailed',
    run: (client) => thrown(client.fetchOwnDecks('token')),
    params: {},
    english: 'Failed to fetch your Archidekt decks (HTTP {status})',
  },
  {
    key: 'domain.sync.archidekt.collectionPageFailed',
    run: (client) => thrown(client.fetchCollectionPage(999, 2)),
    params: { page: 2, userId: 999 },
    english: 'Failed to fetch page 2 of the collection of Archidekt user 999 (HTTP {status})',
  },
  {
    key: 'domain.sync.archidekt.searchFailed',
    run: (client) =>
      returned(
        client.searchCards({ name: 'Sol Ring', set: 'ltc', label: 'Sol Ring (LTC) [foil]' }, 't'),
      ),
    params: { card: 'Sol Ring (LTC) [foil]' },
    english: 'The Archidekt card search for Sol Ring (LTC) [foil] failed (HTTP {status})',
  },
  {
    key: 'domain.sync.archidekt.deckChangeFailed',
    run: (client) => thrown(client.modifyCards('42', [], 'token')),
    params: { deckId: '42' },
    english: 'Failed to send the changes to Archidekt deck 42 (HTTP {status})',
  },
  {
    key: 'domain.sync.archidekt.recordCreateFailed',
    run: (client) => thrown(client.createCollectionRecord(upsertBody(), 'token')),
    params: {},
    english: 'Failed to create a record in the Archidekt collection (HTTP {status})',
  },
  {
    key: 'domain.sync.archidekt.recordUpdateFailed',
    run: (client) => thrown(client.updateCollectionRecord(501, upsertBody(), 'token')),
    params: { recordId: 501 },
    english: 'Failed to update record 501 of the Archidekt collection (HTTP {status})',
  },
  {
    key: 'domain.sync.archidekt.recordsDeleteFailed',
    run: (client) => thrown(client.deleteCollectionRecords([1, 2], 'token')),
    params: { records: RECORDS },
    english: 'Failed to delete 2 collection records from the Archidekt collection (HTTP {status})',
  },
  {
    key: 'domain.sync.archidekt.csvChunkFailed',
    run: (client) =>
      thrown(
        client.uploadCollectionCsv('uid\nuid-1\n', { columns: ['uid'], header: true }, 'token'),
      ),
    params: { chunk: 1 },
    english: 'Failed to upload part 1 of the CSV to Archidekt (HTTP {status})',
  },
]

describe('every Archidekt request failure', () => {
  test('the table covers every request key the catalog holds', () => {
    const catalogKeys = Object.keys(en).filter((key) =>
      /^domain\.sync\.archidekt\.\w+Failed$/.test(key),
    )
    expect(ROWS.map((row): string => row.key).sort()).toEqual(catalogKeys.sort())
  })

  test.each(ROWS.map((row) => [row.key, row] as const))(
    '%s names the status alone when Archidekt says nothing',
    async (_key, row) => {
      const answered = answering(() => new Response('<html>Bad Gateway</html>', { status: 503 }))

      expect(await row.run(answered)).toEqual([
        {
          message: row.english.replace('{status}', '503'),
          messageKey: row.key,
          messageParams: { ...row.params, status: 503 },
        },
        row.key === 'domain.sync.archidekt.searchFailed' ? undefined : 503,
      ])
    },
  )

  test.each(ROWS.map((row) => [row.key, row] as const))(
    '%s quotes Archidekt’s reason under its WithReason twin',
    async (_key, row) => {
      const answered = answering(() => new Response('{"detail":"Nope."}', { status: 400 }))

      const [message] = await row.run(answered)

      // The twin's key is computed, so it is compared as plain data.
      expect(message as unknown).toEqual({
        message: `${row.english.replace('{status}', '400')}: Nope.`,
        messageKey: `${row.key}WithReason`,
        messageParams: { ...row.params, status: 400, reason: 'Nope.' },
      })
    },
  )
})

describe('a reply Archidekt answered but Ritual cannot use', () => {
  /** A 200 whose body is `body` (JSON-encoded unless already text). */
  const ok = (body: unknown) => () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body))

  test('a deck that is not JSON fails as unreadable, at the status Archidekt sent', async () => {
    expect(await thrown(answering(ok('<html>maintenance</html>')).fetchImportedDeck('7'))).toEqual([
      {
        message: 'Failed to read Archidekt deck 7: the reply was not a JSON object',
        messageKey: 'domain.sync.archidekt.deckUnreadable',
        messageParams: {
          deckId: '7',
          reason: { messageKey: 'domain.sync.archidekt.replyNotObject' },
        },
      },
      200,
    ])
  })

  test.each<[string, unknown, (client: ArchidektClient) => Promise<Failure>, SyncMessage]>([
    [
      'a raw deck relation without its printing id',
      { cards: [{ id: 1, quantity: 1, card: { oracleCard: { name: 'Sol Ring' } } }] },
      (client) => thrown(client.fetchDeckWithRaw('7', 't')),
      syncMessage('domain.sync.archidekt.deckUnreadable', {
        deckId: '7',
        reason: {
          messageKey: 'domain.sync.archidekt.replyFieldInvalid',
          messageParams: { field: 'cards[0].card.id' },
        },
      }),
    ],
    [
      'a collection page without its page count',
      { results: [], owner: { id: 9, username: 'u' } },
      (client) => thrown(client.fetchCollectionPage(9, 1)),
      syncMessage('domain.sync.archidekt.collectionPageUnreadable', {
        page: 1,
        userId: 9,
        reason: {
          messageKey: 'domain.sync.archidekt.replyFieldInvalid',
          messageParams: { field: 'totalPages' },
        },
      }),
    ],
    [
      'a deck listing whose result has no id',
      { results: [{ id: 3, name: 'A' }, { name: 'B' }] },
      (client) => thrown(client.fetchOwnDecks('t')),
      syncMessage('domain.sync.archidekt.ownDecksUnreadable', {
        reason: {
          messageKey: 'domain.sync.archidekt.pageItemUnreadable',
          messageParams: { index: 2, field: 'id' },
        },
      }),
    ],
  ])('%s is refused, naming the part', async (_label, body, run, expected) => {
    expect(await run(answering(ok(body)))).toEqual([expected, 200])
  })

  test('a deck listing keeps a deck with no usable name, under the fallback name', async () => {
    const listing = {
      results: [
        { id: 3, name: null, owner: 'not an owner' },
        { id: 4, name: 'B' },
      ],
    }

    const { decks } = await answering(ok(listing)).fetchOwnDecks('t')

    expect(decks).toEqual([
      { id: 3, name: 'Archidekt Deck 3' },
      { id: 4, name: 'B' },
    ])
  })

  test('a collection page without a readable owner is still read', async () => {
    const page = await answering(
      ok({ results: [], totalPages: 1, owner: null }),
    ).fetchCollectionPage(9, 1)

    expect([page.owner, page.totalPages]).toEqual([undefined, 1])
  })

  test.each<[string, unknown]>([
    ['not JSON', 'Created'],
    ['without an id', { createdAt: 'now' }],
  ])('a write Archidekt accepted with a reply %s still succeeds', async (_label, body) => {
    const client = answering(ok(body))

    // A 2xx is the answer: the write landed, whatever the body says.
    await client.createCollectionRecord(upsertBody(), 't')
    await client.updateCollectionRecord(501, upsertBody(), 't')
  })

  test('a category definition without a name, or a relation’s non-list categories, reads as none', async () => {
    const deck = {
      name: 'D',
      categories: [{ id: 1 }, null, { id: 2, name: 'Sideboard', includedInDeck: false }],
      cards: [
        { quantity: 1, categories: [1], card: { oracleCard: { name: 'Sol Ring' } } },
        { quantity: 1, categories: 'Sideboard', card: { oracleCard: { name: 'Island' } } },
        { quantity: 1, categories: [2, { odd: true }], card: { oracleCard: { name: 'Bolt' } } },
      ],
    }

    const imported = await answering(ok(deck)).fetchImportedDeck('7')

    expect(
      imported.deck.sections.map((section) => [section.name, section.cards.map((c) => c.name)]),
    ).toEqual([
      ['Main', ['Sol Ring', 'Island']],
      ['Sideboard', ['Bolt']],
    ])
  })

  test('a push-side relation whose printing lists no finishes offers none', async () => {
    const deck = {
      cards: [{ id: 1, quantity: 1, card: { id: 10, oracleCard: { name: 'Sol Ring' } } }],
    }

    const { raw } = await answering(ok(deck)).fetchDeckWithRaw('7', 't')

    expect(raw.cards[0]?.card.options).toEqual([])
  })

  test('a pull reads a deck whose relations carry no ids, which only a push needs', async () => {
    const deck = { name: 'D', cards: [{ quantity: 2, card: { oracleCard: { name: 'Sol Ring' } } }] }

    const pulled = await answering(ok(deck)).fetchPulledDeck('7', 't')

    expect(pulled.deck.sections.flatMap((section) => section.cards.map((c) => c.name))).toEqual([
      'Sol Ring',
    ])
    // The push's read of the same reply refuses it: its plan sends those ids back.
    const [refusal] = await thrown(answering(ok(deck)).fetchDeckWithRaw('7', 't'))
    expect(refusal.messageParams).toEqual({
      deckId: '7',
      reason: {
        messageKey: 'domain.sync.archidekt.replyFieldInvalid',
        messageParams: { field: 'cards[0].id' },
      },
    })
  })

  test('a pulled deck whose updatedAt is not text is refused', async () => {
    const [refusal] = await thrown(
      answering(ok({ cards: [], updatedAt: 5 })).fetchPulledDeck('7', 't'),
    )

    expect(refusal.messageParams).toEqual({
      deckId: '7',
      reason: {
        messageKey: 'domain.sync.archidekt.replyFieldInvalid',
        messageParams: { field: 'updatedAt' },
      },
    })
  })

  test('a deck listing that is a bare array is not a page', async () => {
    const [message] = await thrown(answering(ok([{ id: 1, name: 'A' }])).fetchPublicDecks('u'))

    expect(message.messageParams).toEqual({
      username: 'u',
      reason: { messageKey: 'domain.sync.archidekt.replyNotObject' },
    })
  })
})

describe('the card search never rejects', () => {
  const query = { name: 'Sol Ring', set: 'ltc', label: 'Sol Ring (LTC)' }

  test('a search that never reached Archidekt is the refusal, the network error nested', async () => {
    const client = new ArchidektClient(
      {
        fetch: async () => {
          throw new TypeError('connection reset')
        },
      },
      { minRequestIntervalMs: 0 },
    )

    expect(await client.searchCards(query, 't')).toEqual({
      message:
        'The Archidekt card search for Sol Ring (LTC) could not reach Archidekt: connection reset',
      messageKey: 'domain.sync.archidekt.searchUnreachable',
      messageParams: { card: 'Sol Ring (LTC)', error: 'connection reset' },
    })
  })

  test.each<[string, unknown, SyncParam]>([
    ['not JSON', '<html>oops</html>', { messageKey: 'domain.sync.archidekt.replyNotObject' }],
    [
      'no results',
      { count: 0 },
      {
        messageKey: 'domain.sync.archidekt.replyFieldInvalid',
        messageParams: { field: 'results' },
      },
    ],
  ])('a reply with %s is refused as unreadable', async (_label, body, reason) => {
    const client = answering(
      () => new Response(typeof body === 'string' ? body : JSON.stringify(body)),
    )

    expect(await client.searchCards(query, 't')).toEqual(
      syncMessage('domain.sync.archidekt.searchUnreadable', { card: 'Sol Ring (LTC)', reason }),
    )
  })

  /** A search hit Ritual cannot read: a token without a collector number. */
  const UNREADABLE_HIT = {
    id: 1,
    collectorNumber: null,
    options: ['Normal'],
    oracleCard: { name: 'Sol Ring' },
  }

  test('an unreadable hit is skipped, so a search finding nothing else finds nothing', async () => {
    const client = answering(() => Response.json({ results: [UNREADABLE_HIT] }))

    expect(await client.searchCards(query, 't')).toEqual(
      syncMessage('domain.sync.archidekt.cardNotFound', { card: 'Sol Ring (LTC)' }),
    )
  })

  test('an unreadable hit beside a readable one leaves the readable one found', async () => {
    const good = {
      id: 2,
      collectorNumber: '284',
      options: ['Foil'],
      oracleCard: { name: 'Sol Ring' },
    }
    const client = answering(() => Response.json({ results: [UNREADABLE_HIT, good] }))

    expect(await client.searchCards(query, 't')).toEqual({
      id: 2,
      collectorNumber: '284',
      options: ['Foil'],
      oracleCard: { name: 'Sol Ring' },
    })
  })
})

describe('the reasons quoted from Archidekt’s reply', () => {
  const more = (count: number): SyncParam => ({
    messageKey: 'domain.sync.moreReasons',
    messageParams: { count },
  })

  test.each<[string, string, SyncParam[], SyncParam[]]>([
    ['non-string items', '{"non_field_errors":["A.",7,null]}', ['A.'], ['A.']],
    [
      'a non-string detail',
      '{"detail":5}',
      [],
      // No reason Archidekt worded, so the reply itself is quoted.
      ['{"detail":5}'],
    ],
    ['an empty detail', '{"detail":""}', [], ['{"detail":""}']],
    ['an array body', '["A."]', [], ['["A."]']],
    [
      'an oversized detail',
      JSON.stringify({ detail: 'x'.repeat(400) }),
      [`${'x'.repeat(300)}…`],
      [`${'x'.repeat(300)}…`],
    ],
    ['only control characters', '\u0007\u0008\u001b[2J', [], []],
    ['an HTML page', '  <html><body>Bad Gateway</body></html>', [], []],
    [
      'more than three reasons',
      JSON.stringify({ non_field_errors: ['A.', 'B.', 'C.', 'D.'], detail: 'E.' }),
      ['A.', 'B.', 'C.', more(2)],
      ['A.', 'B.', 'C.', more(2)],
    ],
    [
      'reasons longer than the total budget',
      JSON.stringify({ non_field_errors: ['y'.repeat(300), 'z'.repeat(300)] }),
      // Each fits its own 300-character cap; together they pass the 500 budget.
      ['y'.repeat(300), more(1)],
      ['y'.repeat(300), more(1)],
    ],
  ])('a reply with %s', (_label, body, reasons, quoted) => {
    expect(archidektReasons(body)).toEqual(reasons)
    expect(replyReasons(body)).toEqual(quoted)
  })

  test('a whole reply quoted in place of a reason is put on one line and capped', () => {
    expect(replyReasons(`line one\n\u001b[31m${'x'.repeat(600)}`)).toEqual([
      `line one ${'x'.repeat(491)}…`,
    ])
  })
})

test('an ArchidektRequestError keeps the cause it was raised with', () => {
  const cause = new TypeError('boom')
  const error = new ArchidektRequestError(
    syncMessage('domain.sync.archidekt.replyNotObject'),
    200,
    {
      cause,
    },
  )

  expect([error.cause, error.upstreamStatus]).toEqual([cause, 200])
})
