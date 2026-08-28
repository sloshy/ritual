import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CacheFeedHost } from '../../src/cache-feed/host'
import { parseCacheFeed, type CacheFeedDocument } from '../../src/cache/feed'
import { createFileTorrent } from '../../src/cache-feed/torrents'
import { MockHttpClient, MemoryLogger, gzipJsonLines, setLogger } from '../test-utils'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'

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

async function sha256Of(bytes: Uint8Array): Promise<string> {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

describe('CacheFeedHost', () => {
  let feedDir: string
  let http: MockHttpClient
  let host: CacheFeedHost

  beforeEach(async () => {
    setLogger(new MemoryLogger())
    feedDir = await createWorkspace({ dirs: [], config: false })
    http = new MockHttpClient()
    host = new CacheFeedHost({
      feedDir,
      publicUrl: `${PUBLIC_URL}/`, // trailing slash must be tolerated
      bulkApiUrl: BULK_API,
      http,
      log: () => {},
    })
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
    const bothHost = new CacheFeedHost({
      feedDir,
      publicUrl: PUBLIC_URL,
      bulkApiUrl: BULK_API,
      kinds: ['default-cards', 'all-cards', 'oracle-tags', 'art-tags'],
      http,
      log: () => {},
    })

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

  test('a restart loads the persisted feed and refresh reuses unchanged entries', async () => {
    mockUpstream(http, '2026-07-05T09:00:00Z', bodies())
    await host.refresh()
    const firstFeed = host.currentFeed()!

    const restarted = new CacheFeedHost({
      feedDir,
      publicUrl: PUBLIC_URL,
      bulkApiUrl: BULK_API,
      http,
      log: () => {},
    })
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
      const health = (await (await get('/health')).json()) as { status: string; entries: number }
      expect(health).toMatchObject({ status: 'ok', entries: 3 })
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

    test('rejects an unsatisfiable range', async () => {
      const entry = host.currentFeed()!.entries[0]!
      const response = await get(`/files/${entry.fileName}`, { range: 'bytes=99999-' })
      expect(response.status).toBe(416)
    })

    test('rejects a syntactically malformed range', async () => {
      const entry = host.currentFeed()!.entries[0]!
      const response = await get(`/files/${entry.fileName}`, { range: 'bytes=abc-def' })
      expect(response.status).toBe(416)
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
      expect((await get('/files/unknown.jsonl.gz')).status).toBe(404)
      expect((await get('/files/..%2Ffeed.json')).status).toBe(404)
      expect((await get('/torrents/other.torrent')).status).toBe(404)
    })

    test('rejects non-GET methods', async () => {
      const response = await host.handleRequest(
        new Request('http://localhost/feed.json', { method: 'POST' }),
      )
      expect(response.status).toBe(405)
    })
  })
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
