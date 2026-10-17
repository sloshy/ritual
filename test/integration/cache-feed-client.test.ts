import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CacheFeedClient, parseCacheFeedClientState } from '../../src/cache/feed-client'
import type { CacheFeedDocument, CacheFeedEntry } from '../../src/cache/feed'
import { buildCacheFeed, type FeedArtifact } from '../helpers/cache-feed'
import type { BulkCacheFiles } from '../../src/scryfall/client'
import { MockHttpClient, MemoryLogger, gzipJsonLines, setLogger } from '../test-utils'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'
import {
  foreignLocales,
  pseudoCatalog,
  rejectedSyncMessage,
  withGuardedLocaleAsync,
  withSyntheticLocaleAsync,
} from '../helpers/sync-text'
import { keyedRefusal } from '../../src/api/http'
import { syncMessage, type SyncMessage } from '../../src/sync/message'
import { en } from '../../src/i18n/messages/en'

const FEED_ORIGIN = 'https://feed.example'
const FEED_URL = `${FEED_ORIGIN}/feed.json`

async function sha256Of(bytes: Uint8Array): Promise<string> {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

type FeedFixture = {
  feed: CacheFeedDocument
  bodies: Record<string, Uint8Array>
}

/** Build a consistent feed document + artifact bodies and mock them over HTTP. */
async function mockFeed(
  http: MockHttpClient,
  stamp: string,
  cardLines: unknown[] = [{ name: 'Sol Ring', set: 'cmr' }],
  options: { includeAllCards?: boolean } = {},
): Promise<FeedFixture> {
  const artifacts: FeedArtifact[] = [
    {
      kind: 'default-cards',
      fileName: `default-cards-${stamp}.jsonl.gz`,
      body: gzipJsonLines(cardLines),
    },
    ...(options.includeAllCards
      ? [
          {
            kind: 'all-cards' as const,
            fileName: `all-cards-${stamp}.jsonl.gz`,
            // The every-language bulk: the same card plus a foreign object.
            body: gzipJsonLines([...cardLines, { name: 'Sol Ring', set: 'cmr', lang: 'ja' }]),
          },
        ]
      : []),
    {
      kind: 'oracle-tags',
      // Tag content never changes across these fixtures, so — like the real
      // host, whose entries are reused verbatim when unchanged — the name is stable.
      fileName: 'oracle-tags-stable.jsonl.gz',
      body: gzipJsonLines([
        { object: 'tag', id: 't1', label: 'ramp', slug: 'ramp', type: 'oracle' },
      ]),
    },
    {
      kind: 'art-tags',
      fileName: 'art-tags-stable.jsonl.gz',
      body: gzipJsonLines([
        { object: 'tag', id: 'a1', label: 'sun', slug: 'sun', type: 'illustration' },
      ]),
    },
  ]

  const { feed, files } = buildCacheFeed(FEED_ORIGIN, artifacts, stamp)
  const bodies: Record<string, Uint8Array> = {}
  for (const artifact of artifacts) bodies[artifact.fileName] = artifact.body
  for (const [fileUrl, body] of files) http.mock(fileUrl, () => new Response(body.slice()))
  http.mock(FEED_URL, () => new Response(JSON.stringify(feed)))
  return { feed, bodies }
}

describe('CacheFeedClient (HTTP download path)', () => {
  let dataDir: string
  let http: MockHttpClient
  let ingested: BulkCacheFiles[]
  let client: CacheFeedClient

  beforeEach(async () => {
    setLogger(new MemoryLogger())
    dataDir = await createWorkspace({ dirs: [], config: false })
    http = new MockHttpClient()
    ingested = []
    client = new CacheFeedClient({
      feedUrl: FEED_URL,
      dataDir,
      http,
      p2p: false,
      ingest: async (files) => {
        ingested.push(files)
      },
      log: () => {},
    })
  })

  afterEach(async () => {
    await client.stop()
    await removeWorkspace(dataDir)
  })

  test('first sync downloads, verifies, ingests, and records state', async () => {
    const { feed, bodies } = await mockFeed(http, '20260705')

    const result = await client.sync()
    expect(result.outcome).toBe('ingested')
    expect(ingested).toHaveLength(1)

    // Every artifact landed on disk byte-identical to the served body.
    for (const entry of feed.entries) {
      const onDisk = new Uint8Array(
        await Bun.file(path.join(dataDir, 'files', entry.fileName)).arrayBuffer(),
      )
      expect(await sha256Of(onDisk)).toBe(await sha256Of(bodies[entry.fileName]!))
    }
    // The ingest callback received the default-cards path and its bulk type.
    expect(ingested[0]!.cards).toContain('default-cards-20260705.jsonl.gz')
    expect(ingested[0]!.cardBulkType).toBe('default_cards')

    const state = parseCacheFeedClientState(
      JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf-8')),
    )
    expect(typeof state).not.toBe('string')
  })

  test.each(foreignLocales())(
    'a sync under $tag logs in it and writes the same state bytes',
    async ({ tag, catalog }) => {
      const { feed } = await mockFeed(http, '20260705')
      const lines: string[] = []
      const localized = new CacheFeedClient({
        feedUrl: FEED_URL,
        dataDir,
        http,
        p2p: false,
        ingest: async () => {},
        log: (line) => lines.push(line),
      })

      await withSyntheticLocaleAsync(tag, catalog, () => localized.sync())

      // The operator's log follows the UI language, behind the untranslated prefix…
      const form = catalog['cli.cacheFeed.downloadingHttp'] ?? en['cli.cacheFeed.downloadingHttp']
      if (typeof form !== 'string') throw new Error('downloadingHttp is a plain-string message')
      const downloading = form.replace('{file}', 'default-cards-20260705.jsonl.gz')
      expect(lines).toContain(`[cache-feed] ${downloading}`)
      // …while state.json, which the next run reads back, is the same bytes in any language.
      const written = await fs.readFile(path.join(dataDir, 'state.json'), 'utf-8')
      const ingestedAt = /"ingestedAt": "([^"]+)"/.exec(written)?.[1] ?? ''
      const hashOf = (kind: CacheFeedEntry['kind']): string =>
        feed.entries.find((entry) => entry.kind === kind)?.infoHash ?? ''
      expect(written).toBe(
        [
          '{',
          '  "ingested": {',
          '    "default-cards": {',
          `      "infoHash": "${hashOf('default-cards')}",`,
          `      "ingestedAt": "${ingestedAt}"`,
          '    },',
          '    "oracle-tags": {',
          `      "infoHash": "${hashOf('oracle-tags')}",`,
          `      "ingestedAt": "${ingestedAt}"`,
          '    },',
          '    "art-tags": {',
          `      "infoHash": "${hashOf('art-tags')}",`,
          `      "ingestedAt": "${ingestedAt}"`,
          '    }',
          '  }',
          '}',
        ].join('\n'),
      )
      expect(ingestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    },
  )

  test('a second sync with an unchanged feed ingests nothing', async () => {
    await mockFeed(http, '20260705')
    await client.sync()
    const result = await client.sync()
    expect(result.outcome).toBe('unchanged')
    expect(ingested).toHaveLength(1)
  })

  test('--force re-ingests an unchanged feed', async () => {
    await mockFeed(http, '20260705')
    await client.sync()
    const result = await client.sync({ force: true })
    expect(result.outcome).toBe('ingested')
    expect(ingested).toHaveLength(2)
  })

  test('a changed feed re-downloads and prunes the previous artifacts', async () => {
    await mockFeed(http, '20260705')
    await client.sync()

    await mockFeed(http, '20260706', [
      { name: 'Sol Ring', set: 'cmr' },
      { name: 'Brainstorm', set: 'ice' },
    ])
    const result = await client.sync()
    expect(result.outcome).toBe('ingested')
    expect(ingested).toHaveLength(2)

    const names = await fs.readdir(path.join(dataDir, 'files'))
    expect(names.sort()).toEqual([
      'art-tags-stable.jsonl.gz',
      'default-cards-20260706.jsonl.gz',
      'oracle-tags-stable.jsonl.gz',
    ])
  })

  test('a corrupted download fails verification and is deleted', async () => {
    const { feed } = await mockFeed(http, '20260705')
    // Serve a body that does not match the advertised sha256.
    const entry = feed.entries[0]!
    http.mock(entry.fileUrl, () => new Response(gzipJsonLines([{ name: 'Wrong Card' }]).slice()))

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.sync()).rejects.toThrow('does not match')
    expect(ingested).toHaveLength(0)
    expect(await Bun.file(path.join(dataDir, 'files', entry.fileName)).exists()).toBeFalse()
  })

  test('reuses a verified on-disk artifact without re-downloading', async () => {
    const { feed, bodies } = await mockFeed(http, '20260705')
    // Pre-place the correct artifact, then make its URL unreachable.
    const entry = feed.entries.find((candidate) => candidate.kind === 'default-cards')!
    await fs.mkdir(path.join(dataDir, 'files'), { recursive: true })
    await fs.writeFile(path.join(dataDir, 'files', entry.fileName), bodies[entry.fileName]!)
    http.mock(entry.fileUrl, () => new Response('gone', { status: 404 }))

    const result = await client.sync()
    expect(result.outcome).toBe('ingested')
    expect(ingested[0]!.cards).toBe(path.join(dataDir, 'files', entry.fileName))
  })

  test('restores an artifact renamed upstream without content changes', async () => {
    await mockFeed(http, '20260705')
    await client.sync()

    // Same content (same infoHash in these fixtures), new default-cards
    // filename: the kind is already ingested, but the on-disk copy no longer
    // matches the feed's fileName. The client must restore it rather than
    // leave the pruned files dir with no artifact.
    await mockFeed(http, '20260707')
    const result = await client.sync()
    expect(result.outcome).toBe('unchanged')

    const names = await fs.readdir(path.join(dataDir, 'files'))
    expect(names).toContain('default-cards-20260707.jsonl.gz')
    expect(names).not.toContain('default-cards-20260705.jsonl.gz')
  })

  test('a malformed feed document fails with the parser error', async () => {
    http.mock(FEED_URL, () => new Response(JSON.stringify({ version: 99 })))
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.sync()).rejects.toThrow('unsupported version')
  })

  /** A failed request a sync makes, and the keyed message it fails with. */
  type RequestFailure = {
    name: string
    arrange: (feed: CacheFeedDocument) => void
    expected: (feed: CacheFeedDocument) => SyncMessage
  }

  const requestFailures: RequestFailure[] = [
    {
      name: 'a feed host refusing the feed nests its keyed reason',
      arrange: () =>
        http.mock(FEED_URL, () => keyedRefusal('domain.cache.feedReply.notGenerated', 503)),
      expected: () =>
        syncMessage('cli.cacheFeed.fetchFailedWithBody', {
          url: FEED_URL,
          status: 503,
          body: { messageKey: 'domain.cache.feedReply.notGenerated' },
        }),
    },
    {
      name: 'a feed that answers nothing names only the status',
      arrange: () => http.mock(FEED_URL, () => new Response(null, { status: 404 })),
      expected: () => syncMessage('cli.cacheFeed.fetchFailed', { url: FEED_URL, status: 404 }),
    },
    {
      name: 'an artifact another server refuses is quoted',
      arrange: (feed) =>
        http.mock(feed.entries[0]!.fileUrl, () => new Response('gone', { status: 410 })),
      expected: (feed) =>
        syncMessage('cli.cacheFeed.downloadFailedWithBody', {
          url: feed.entries[0]!.fileUrl,
          status: 410,
          body: 'gone',
        }),
    },
  ]

  test.each(requestFailures)(
    'a failed request fails keyed, its message English: $name',
    async ({ arrange, expected }) => {
      const { feed } = await mockFeed(http, '20260705')
      arrange(feed)
      const message = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
        rejectedSyncMessage(client.sync()),
      )
      expect(message).toEqual(expected(feed))
    },
  )

  test('a feed host’s refusal reads in the client’s language', async () => {
    http.mock(FEED_URL, () => keyedRefusal('domain.cache.feedReply.notGenerated', 503))
    const shown = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
      client.sync().then(
        () => '',
        (error: unknown) => (error instanceof Error ? error.message : ''),
      ),
    )
    const reason = pseudoCatalog()['domain.cache.feedReply.notGenerated']
    if (typeof reason !== 'string') throw new Error('expected a plain-string message')
    expect(shown).toContain(reason)
  })

  /** A client configured for the every-language card bulk (non-en defaultLanguage). */
  function allCardsClient(): CacheFeedClient {
    return new CacheFeedClient({
      feedUrl: FEED_URL,
      dataDir,
      http,
      p2p: false,
      cardKind: 'all-cards',
      ingest: async (files) => {
        ingested.push(files)
      },
      log: () => {},
    })
  }

  test('an all-cards client ingests the all-cards artifact, not default-cards', async () => {
    await mockFeed(http, '20260705', undefined, { includeAllCards: true })
    const allClient = allCardsClient()
    try {
      const result = await allClient.sync()
      expect(result.outcome).toBe('ingested')
      expect(ingested[0]!.cards).toContain('all-cards-20260705.jsonl.gz')
      expect(ingested[0]!.cardBulkType).toBe('all_cards')
      // The default-cards artifact was never downloaded.
      const names = await fs.readdir(path.join(dataDir, 'files'))
      expect(names).not.toContain('default-cards-20260705.jsonl.gz')
    } finally {
      await allClient.stop()
    }
  })

  test('per-card-kind state: a default-cards ingest does not satisfy an all-cards client', async () => {
    await mockFeed(http, '20260705', undefined, { includeAllCards: true })
    await client.sync()
    expect(ingested[0]!.cardBulkType).toBe('default_cards')

    // Same feed, but the client now wants the other card bulk — the state
    // recorded for 'default-cards' must not read as "unchanged" here.
    const allClient = allCardsClient()
    try {
      const result = await allClient.sync()
      expect(result.outcome).toBe('ingested')
      expect(ingested[1]!.cardBulkType).toBe('all_cards')
    } finally {
      await allClient.stop()
    }
  })

  test('an all-cards client fails clearly when the feed does not publish all-cards', async () => {
    await mockFeed(http, '20260705')
    const allClient = allCardsClient()
    try {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
      await expect(allClient.sync()).rejects.toThrow("no 'all-cards' entry")
    } finally {
      await allClient.stop()
    }
  })

  test('a default-cards client ignores an all-cards entry in the feed', async () => {
    await mockFeed(http, '20260705', undefined, { includeAllCards: true })
    const result = await client.sync()
    expect(result.outcome).toBe('ingested')
    expect(ingested[0]!.cards).toContain('default-cards-20260705.jsonl.gz')
    const names = await fs.readdir(path.join(dataDir, 'files'))
    expect(names).not.toContain('all-cards-20260705.jsonl.gz')
  })
})

describe('parseCacheFeedClientState', () => {
  test('round-trips a valid state', () => {
    const state = {
      ingested: { 'default-cards': { infoHash: 'a'.repeat(40), ingestedAt: '2026-07-05' } },
    }
    expect(parseCacheFeedClientState(state)).toEqual(state)
  })

  test.each([
    [null, 'expected an object'],
    [{}, 'missing ingested map'],
    [{ ingested: { rulings: { infoHash: 'x' } } }, "unknown kind 'rulings'"],
    [{ ingested: { 'default-cards': {} } }, 'missing a string infoHash'],
  ])('rejects %p', (payload, expected) => {
    const result = parseCacheFeedClientState(payload)
    expect(typeof result).toBe('string')
    expect(result as string).toContain(expected)
  })
})
