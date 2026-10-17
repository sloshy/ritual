import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CacheFeedHost,
  type CacheFeedHostOptions,
  type FeedHealthResponse,
} from '../../src/cache-feed/host'
import { parseCacheFeed, type CacheFeedDocument } from '../../src/cache/feed'
import { createFileTorrent } from '../../src/cache-feed/torrents'
import { MockHttpClient, MemoryLogger, gzipJsonLines, setLogger } from '../test-utils'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'
import { spawnFeedHost } from './helpers/cache-server'
import { serveBulkUpstream } from './helpers/scryfall-bulk'
import { pseudoCatalog, rejectedSyncMessage, withGuardedLocaleAsync } from '../helpers/sync-text'
import { en } from '../../src/i18n/messages/en'
import { t, type ParameterlessKey } from '../../src/i18n/t'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import { CACHE_FEED_LOG_PREFIX } from '../../src/cache/feed'
import { renderSyncMessage, syncMessage, syncRef, type SyncMessage } from '../../src/sync/message'

const BULK_API = 'https://upstream.example/bulk-data'
const PUBLIC_URL = 'https://feed.example'

type UpstreamFile = { uri: string; body: Uint8Array }

/** Register a manifest + downloadable bulk files on the mock http client. */
function mockUpstream(
  http: MockHttpClient,
  updatedAt: string,
  bodies: {
    defaultCards: Uint8Array
    oracleTags: Uint8Array
    artTags: Uint8Array
    allCards?: Uint8Array
  },
): Record<string, UpstreamFile> {
  const stamp = updatedAt.replace(/\D/g, '').slice(0, 8)
  const files: Record<string, UpstreamFile> = {
    default_cards: {
      uri: `https://upstream.example/default-cards-${stamp}.jsonl.gz`,
      body: bodies.defaultCards,
    },
    ...(bodies.allCards
      ? {
          all_cards: {
            uri: `https://upstream.example/all-cards-${stamp}.jsonl.gz`,
            body: bodies.allCards,
          },
        }
      : {}),
    oracle_tags: {
      uri: `https://upstream.example/oracle-tags-${stamp}.jsonl.gz`,
      body: bodies.oracleTags,
    },
    art_tags: { uri: `https://upstream.example/art-tags-${stamp}.jsonl.gz`, body: bodies.artTags },
  }
  http.mock(
    BULK_API,
    () =>
      new Response(
        JSON.stringify({
          data: Object.entries(files).map(([type, file]) => ({
            type,
            updated_at: updatedAt,
            jsonl_download_uri: file.uri,
          })),
        }),
      ),
  )
  for (const file of Object.values(files)) {
    http.mock(file.uri, () => new Response(file.body.slice()))
  }
  return files
}

/** A refusal as a test reads it: its status and its JSON body. */
type Refusal = { status: number; body: unknown }

/**
 * The status and body of a refusal the host answers while its UI language is
 * the full pseudo-locale: the body must still be English beside its key.
 */
function pseudoRefusal(answer: () => Promise<Response>): Promise<Refusal> {
  return withGuardedLocaleAsync('en-XA', pseudoCatalog(), async () => {
    const response = await answer()
    return { status: response.status, body: (await response.json()) as unknown }
  })
}

/** The refusal a feed host answers `key` with: the English message beside its key. */
function refused(status: number, key: ParameterlessKey): Refusal {
  return { status, body: { success: false, message: en[key], messageKey: key } }
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

describe('CacheFeedHost', () => {
  let feedDir: string
  let http: MockHttpClient
  let host: CacheFeedHost

  /** A host over this test's feed dir and mock upstream, silent unless `log` is given. */
  const makeHost = (overrides: Partial<CacheFeedHostOptions> = {}): CacheFeedHost =>
    new CacheFeedHost({
      feedDir,
      publicUrl: PUBLIC_URL,
      bulkApiUrl: BULK_API,
      http,
      log: () => {},
      ...overrides,
    })

  beforeEach(async () => {
    setLogger(new MemoryLogger())
    feedDir = await createWorkspace({ dirs: [], config: false })
    http = new MockHttpClient()
    host = makeHost({ publicUrl: `${PUBLIC_URL}/` }) // trailing slash must be tolerated
  })

  afterEach(async () => {
    await removeWorkspace(feedDir)
  })

  const bodies = () => ({
    defaultCards: gzipJsonLines([{ name: 'Sol Ring', set: 'cmr' }]),
    oracleTags: gzipJsonLines([
      { object: 'tag', id: 't1', label: 'ramp', slug: 'ramp', type: 'oracle' },
    ]),
    artTags: gzipJsonLines([
      { object: 'tag', id: 'a1', label: 'sun', slug: 'sun', type: 'illustration' },
    ]),
  })

  test('refresh downloads all artifacts and publishes a valid feed', async () => {
    const files = mockUpstream(http, '2026-07-05T09:00:00Z', bodies())

    const changed = await host.refresh(new Date('2026-07-05T10:00:00Z'))
    expect(changed).toBeTrue()

    const raw = JSON.parse(await fs.readFile(path.join(feedDir, 'feed.json'), 'utf-8')) as unknown
    const feed = parseCacheFeed(raw) as CacheFeedDocument
    expect(typeof feed).not.toBe('string')
    expect(feed.entries).toHaveLength(3)

    const entry = feed.entries.find((candidate) => candidate.kind === 'default-cards')!
    const expectedBody = files['default_cards']!.body
    expect(entry.length).toBe(expectedBody.byteLength)
    expect(entry.sha256).toBe(await sha256Of(expectedBody))
    expect(entry.scryfallUpdatedAt).toBe('2026-07-05T09:00:00Z')
    // Public URLs are built from publicUrl without a double slash.
    expect(entry.fileUrl).toBe(`${PUBLIC_URL}/files/${entry.fileName}`)
    expect(entry.torrentUrl).toBe(`${PUBLIC_URL}/torrents/${entry.infoHash}.torrent`)
    // The artifact and its torrent are on disk.
    expect(await Bun.file(path.join(feedDir, 'files', entry.fileName)).exists()).toBeTrue()
    expect(
      await Bun.file(path.join(feedDir, 'torrents', `${entry.infoHash}.torrent`)).exists(),
    ).toBeTrue()
  })

  test('a second refresh with unchanged upstream publishes nothing', async () => {
    mockUpstream(http, '2026-07-05T09:00:00Z', bodies())
    expect(await host.refresh()).toBeTrue()
    expect(await host.refresh()).toBeFalse()
  })

  test('a host configured for both card kinds publishes an all-cards entry too', async () => {
    const allCards = gzipJsonLines([
      { name: 'Sol Ring', set: 'cmr' },
      { name: 'Sol Ring', set: 'cmr', lang: 'ja' },
    ])
    const files = mockUpstream(http, '2026-07-05T09:00:00Z', { ...bodies(), allCards })
    const bothHost = makeHost({ kinds: ['default-cards', 'all-cards', 'oracle-tags', 'art-tags'] })

    expect(await bothHost.refresh(new Date('2026-07-05T10:00:00Z'))).toBeTrue()
    const feed = bothHost.currentFeed()!
    expect(feed.entries.map((entry) => entry.kind)).toEqual([
      'default-cards',
      'all-cards',
      'oracle-tags',
      'art-tags',
    ])
    const entry = feed.entries.find((candidate) => candidate.kind === 'all-cards')!
    expect(entry.sha256).toBe(await sha256Of(files['all_cards']!.body))
    expect(await Bun.file(path.join(feedDir, 'files', entry.fileName)).exists()).toBeTrue()
  })

  test('a default-only host ignores an upstream all_cards manifest entry', async () => {
    mockUpstream(http, '2026-07-05T09:00:00Z', { ...bodies(), allCards: gzipJsonLines([{}]) })
    await host.refresh()
    expect(host.currentFeed()!.entries.map((entry) => entry.kind)).toEqual([
      'default-cards',
      'oracle-tags',
      'art-tags',
    ])
  })

  test('an upstream update replaces entries and prunes the old artifacts', async () => {
    mockUpstream(http, '2026-07-05T09:00:00Z', bodies())
    await host.refresh()
    const oldEntry = host.currentFeed()!.entries[0]!

    mockUpstream(http, '2026-07-06T09:00:00Z', {
      ...bodies(),
      defaultCards: gzipJsonLines([
        { name: 'Sol Ring', set: 'cmr' },
        { name: 'Brainstorm', set: 'ice' },
      ]),
    })
    expect(await host.refresh()).toBeTrue()

    const feed = host.currentFeed()!
    expect(
      feed.entries.every((entry) => entry.scryfallUpdatedAt === '2026-07-06T09:00:00Z'),
    ).toBeTrue()
    // The content actually changed hands, not just the timestamps.
    const newEntry = feed.entries.find((entry) => entry.kind === oldEntry.kind)!
    expect(newEntry.sha256).not.toBe(oldEntry.sha256)
    // The previous generation's file is pruned.
    expect(await Bun.file(path.join(feedDir, 'files', oldEntry.fileName)).exists()).toBeFalse()
  })

  test('logs a refresh in the host’s language, behind the untranslated prefix', async () => {
    mockUpstream(http, '2026-07-05T09:00:00Z', bodies())
    const lines: string[] = []
    const logged = makeHost({ log: (line) => lines.push(line) })

    const published = syncRef('cli.cacheFeed.published', { count: 3 })
    const expected = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), async () => {
      await logged.refresh() // publishes
      await logged.refresh() // finds nothing new
      return [renderSyncMessage(published), t('cli.cacheFeed.upToDate')]
    })

    // Vacuity: the pseudo rendering is not the English one.
    expect(expected[0]).not.toBe(renderSyncMessage(published, DEFAULT_LOCALE))
    for (const line of expected) expect(lines).toContain(`${CACHE_FEED_LOG_PREFIX} ${line}`)
    expect(lines.every((line) => line.startsWith(`${CACHE_FEED_LOG_PREFIX} `))).toBeTrue()
  })

  /** A manifest naming one `default_cards` bulk at `uri`. */
  const manifestWith = (uri: string): Response =>
    new Response(
      JSON.stringify({
        data: [
          { type: 'default_cards', updated_at: '2026-07-05T09:00:00Z', jsonl_download_uri: uri },
        ],
      }),
    )

  /** How a refresh fails, and the keyed message it fails with. */
  type RefreshFailure = { name: string; arrange: () => void; expected: SyncMessage }

  const refreshFailures: RefreshFailure[] = [
    {
      name: 'the manifest does not list a published kind',
      arrange: () => http.mock(BULK_API, () => new Response(JSON.stringify({ data: [] }))),
      expected: syncMessage('cli.cacheFeed.manifestEntryMissing', { bulkType: 'default_cards' }),
    },
    {
      name: 'the manifest itself fails',
      arrange: () =>
        http.mock(
          BULK_API,
          () => new Response('down', { status: 503, statusText: 'Service Unavailable' }),
        ),
      expected: syncMessage('domain.cache.refresh.manifestFailed', {
        status: 503,
        statusText: 'Service Unavailable',
      }),
    },
    {
      name: 'a bulk download fails',
      arrange: () => {
        const files = mockUpstream(http, '2026-07-05T09:00:00Z', bodies())
        http.mock(
          files['default_cards']!.uri,
          () => new Response('down', { status: 503, statusText: 'Service Unavailable' }),
        )
      },
      expected: syncMessage('cli.cacheFeed.bulkDownloadFailed', {
        kind: 'default-cards',
        status: 503,
        statusText: 'Service Unavailable',
      }),
    },
    {
      name: 'a bulk download has no body',
      arrange: () => {
        const files = mockUpstream(http, '2026-07-05T09:00:00Z', bodies())
        http.mock(files['default_cards']!.uri, () => new Response(null))
      },
      expected: syncMessage('cli.cacheFeed.bulkNoBody', { kind: 'default-cards' }),
    },
    {
      name: 'a bulk file name could leave the feed directory',
      arrange: () =>
        http.mock(BULK_API, () =>
          manifestWith('https://upstream.example/x/..%2F..%2Fescape.jsonl.gz'),
        ),
      expected: syncMessage('cli.cacheFeed.suspiciousFileName', { file: '../../escape.jsonl.gz' }),
    },
    {
      name: 'a bulk URL names no file at all',
      arrange: () => http.mock(BULK_API, () => manifestWith('https://upstream.example/')),
      expected: syncMessage('cli.cacheFeed.suspiciousFileName', { file: '' }),
    },
  ]

  test.each(refreshFailures)(
    'a refresh fails keyed, its message English in any UI language: $name',
    async ({ arrange, expected }) => {
      arrange()
      const message = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
        rejectedSyncMessage(host.refresh()),
      )
      expect(message).toEqual(expected)
    },
  )

  test('ignores an unusable saved feed, saying so in the host’s language', async () => {
    const lines: string[] = []
    const restarted = makeHost({ log: (line) => lines.push(line) })
    const feedPath = path.join(feedDir, 'feed.json')

    const expected = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), async () => {
      await fs.writeFile(feedPath, '{ not json')
      await restarted.loadExistingFeed()
      expect(restarted.currentFeed()).toBeNull()

      await fs.writeFile(feedPath, JSON.stringify({ version: 999 }))
      await restarted.loadExistingFeed()
      expect(restarted.currentFeed()).toBeNull()

      const reason = parseCacheFeed({ version: 999 })
      if (typeof reason !== 'string') throw new Error('expected the feed parser to refuse')
      return [
        t('cli.cacheFeed.ignoringUnreadable', { file: 'feed.json' }),
        t('cli.cacheFeed.ignoringState', { file: 'feed.json', reason }),
      ]
    })

    expect(expected[0]).not.toBe(t('cli.cacheFeed.ignoringUnreadable', { file: 'feed.json' }))
    expect(lines).toEqual(expected.map((line) => `${CACHE_FEED_LOG_PREFIX} ${line}`))
  })

  test('a restart loads the persisted feed and refresh reuses unchanged entries', async () => {
    mockUpstream(http, '2026-07-05T09:00:00Z', bodies())
    await host.refresh()
    const firstFeed = host.currentFeed()!

    const restarted = makeHost()
    await restarted.loadExistingFeed()
    expect(restarted.currentFeed()).toEqual(firstFeed)
    expect(await restarted.refresh()).toBeFalse()
  })

  describe('handleRequest', () => {
    beforeEach(async () => {
      mockUpstream(http, '2026-07-05T09:00:00Z', bodies())
      await host.refresh()
    })

    const get = (pathname: string, headers: Record<string, string> = {}) =>
      host.handleRequest(new Request(`http://localhost${pathname}`, { headers }))

    test('serves the feed document at /feed.json', async () => {
      const response = await get('/feed.json')
      expect(response.status).toBe(200)
      const parsed = parseCacheFeed(await response.json())
      expect(typeof parsed).not.toBe('string')
    })

    test('reports entry count at /health', async () => {
      const health = (await (await get('/health')).json()) as FeedHealthResponse
      expect(health).toEqual({
        status: 'ok',
        entries: 3,
        generatedAt: host.currentFeed()!.generatedAt,
      })
    })

    test('serves a full artifact with Accept-Ranges', async () => {
      const entry = host.currentFeed()!.entries[0]!
      const response = await get(`/files/${entry.fileName}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('accept-ranges')).toBe('bytes')
      const body = new Uint8Array(await response.arrayBuffer())
      expect(await sha256Of(body)).toBe(entry.sha256)
    })

    test('serves partial content for range requests (web-seed requirement)', async () => {
      const entry = host.currentFeed()!.entries[0]!
      const full = new Uint8Array(await (await get(`/files/${entry.fileName}`)).arrayBuffer())

      const middle = await get(`/files/${entry.fileName}`, { range: 'bytes=5-14' })
      expect(middle.status).toBe(206)
      expect(middle.headers.get('content-range')).toBe(`bytes 5-14/${entry.length}`)
      expect(new Uint8Array(await middle.arrayBuffer())).toEqual(full.slice(5, 15))

      const suffix = await get(`/files/${entry.fileName}`, { range: 'bytes=-4' })
      expect(suffix.status).toBe(206)
      expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(full.slice(-4))

      const openEnded = await get(`/files/${entry.fileName}`, { range: 'bytes=10-' })
      expect(openEnded.status).toBe(206)
      expect(new Uint8Array(await openEnded.arrayBuffer())).toEqual(full.slice(10))
    })

    test('rejects an unsatisfiable or malformed range, naming the length (RFC 9110)', async () => {
      const entry = host.currentFeed()!.entries[0]!
      for (const range of ['bytes=99999-', 'bytes=abc-def']) {
        const response = await get(`/files/${entry.fileName}`, { range })
        expect(response.headers.get('content-range')).toBe(`bytes */${entry.length}`)
        expect(await pseudoRefusal(() => get(`/files/${entry.fileName}`, { range }))).toEqual(
          refused(416, 'domain.cache.feedReply.rangeNotSatisfiable'),
        )
      }
    })

    test('answers HEAD requests (web-seed clients probe with HEAD)', async () => {
      const entry = host.currentFeed()!.entries[0]!
      const response = await host.handleRequest(
        new Request(`http://localhost/files/${entry.fileName}`, { method: 'HEAD' }),
      )
      expect(response.status).toBe(200)
    })

    test('serves torrents with the bittorrent content type', async () => {
      const entry = host.currentFeed()!.entries[0]!
      const response = await get(`/torrents/${entry.infoHash}.torrent`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/x-bittorrent')
    })

    test('404s files not referenced by the feed (no path traversal)', async () => {
      const fileNotListed = refused(404, 'domain.cache.feedReply.fileNotListed')
      expect(await pseudoRefusal(() => get('/files/unknown.jsonl.gz'))).toEqual(fileNotListed)
      expect(await pseudoRefusal(() => get('/files/..%2Ffeed.json'))).toEqual(fileNotListed)
      expect(await pseudoRefusal(() => get('/torrents/other.torrent'))).toEqual(
        refused(404, 'domain.cache.feedReply.torrentNotListed'),
      )
      expect(await pseudoRefusal(() => get('/elsewhere'))).toEqual(
        refused(404, 'domain.cache.feedReply.notFound'),
      )
    })

    test('400s a file or torrent name with a broken % escape', async () => {
      const malformed = refused(400, 'domain.cache.feedReply.pathMalformed')
      expect(await pseudoRefusal(() => get('/files/%E0%A4%A'))).toEqual(malformed)
      expect(await pseudoRefusal(() => get('/torrents/%ZZ.torrent'))).toEqual(malformed)
    })

    test('a refusal is never cached', async () => {
      expect((await get('/elsewhere')).headers.get('cache-control')).toBe('no-store')
    })

    test('rejects non-GET methods, naming the allowed ones', async () => {
      const post = () =>
        host.handleRequest(new Request('http://localhost/feed.json', { method: 'POST' }))
      expect((await post()).headers.get('allow')).toBe('GET, HEAD')
      expect(await pseudoRefusal(post)).toEqual(
        refused(405, 'domain.cache.feedReply.methodNotAllowed'),
      )
    })
  })

  test('answers 503 for the feed document before the first one is generated', async () => {
    const answer = () => host.handleRequest(new Request('http://localhost/feed.json'))
    expect((await answer()).headers.get('retry-after')).toBe('60')
    expect(await pseudoRefusal(answer)).toEqual(refused(503, 'domain.cache.feedReply.notGenerated'))
  })
})

describe('cache feed host over the wire', () => {
  /** What one request got back: its status, its declared length and its body's length. */
  type Answer = { status: number; contentLength: string | null; bodyBytes: number }

  test('HEAD answers GET’s headers with no body, ignores Range, and every request is logged', async () => {
    const dir = await createWorkspace({ dirs: [], config: false })
    const upstream = serveBulkUpstream()
    let log: string
    try {
      const host = await spawnFeedHost({
        cwd: dir,
        args: [
          '--no-seed',
          '--verbose',
          '--upstream',
          upstream.bulkApiUrl,
          '--dir',
          path.join(dir, 'feed'),
        ],
      })
      try {
        const ask = async (
          method: string,
          pathname: string,
          headers: Record<string, string> = {},
        ): Promise<Answer> => {
          const response = await fetch(`${host.url}${pathname}`, {
            method,
            headers,
            signal: AbortSignal.timeout(5000),
          })
          return {
            status: response.status,
            contentLength: response.headers.get('content-length'),
            bodyBytes: (await response.arrayBuffer()).byteLength,
          }
        }
        const feed = parseCacheFeed(await (await fetch(`${host.url}/feed.json`)).json())
        if (typeof feed === 'string') throw new Error(feed)
        const file = `/files/${feed.entries[0]!.fileName}`

        for (const pathname of [file, '/files/unknown.jsonl.gz']) {
          const get = await ask('GET', pathname)
          expect(get.bodyBytes).toBeGreaterThan(0)
          expect(await ask('HEAD', pathname)).toEqual({ ...get, bodyBytes: 0 })
        }
        // RFC 9110: Range applies to GET only; a HEAD describes the whole file.
        const headRange = await ask('HEAD', file, { range: 'bytes=0-1' })
        expect(headRange).toEqual({
          status: 200,
          contentLength: String(feed.entries[0]!.length),
          bodyBytes: 0,
        })
        expect((await ask('GET', file, { range: 'bytes=0-1' })).status).toBe(206)
        // A name with a broken % escape is refused, not thrown.
        expect((await ask('GET', '/files/%E0%A4%A')).status).toBe(400)
      } finally {
        log = (await host.stop()).stdout
      }
    } finally {
      await upstream.stop()
      await removeWorkspace(dir)
    }
    expect(log).toMatch(/^\[cache-feed\] method=HEAD path=\/files\/unknown\.jsonl\.gz status=404 /m)
    expect(log).toMatch(
      /^\[cache-feed\] method=GET path=\/files\/%E0%A4%A status=400 durationMs=\d+$/m,
    )
  }, 30_000)
})

describe('createFileTorrent', () => {
  test('is deterministic for identical content, name, and creation date', async () => {
    const dir = await createWorkspace({ dirs: [], config: false })
    try {
      const filePath = path.join(dir, 'artifact.jsonl.gz')
      await fs.writeFile(filePath, gzipJsonLines([{ name: 'Sol Ring' }]))
      const date = new Date('2026-07-05T10:00:00Z')

      const first = await createFileTorrent(filePath, 'https://feed.example/files/a', date)
      const second = await createFileTorrent(filePath, 'https://feed.example/files/a', date)
      expect(first.infoHash).toBe(second.infoHash)
      expect(first.magnet).toContain('xt=urn:btih:')
      expect(first.magnet).toContain('ws=')

      // Different content must hash differently.
      const otherPath = path.join(dir, 'other.jsonl.gz')
      await fs.writeFile(otherPath, gzipJsonLines([{ name: 'Brainstorm' }]))
      const other = await createFileTorrent(otherPath, 'https://feed.example/files/a', date)
      expect(other.infoHash).not.toBe(first.infoHash)
    } finally {
      await removeWorkspace(dir)
    }
  })
})
