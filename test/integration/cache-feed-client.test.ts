import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CacheFeedClient, parseCacheFeedClientState } from '../../src/cache/feed-client'
import { FEED_VERSION, type CacheFeedDocument, type CacheFeedEntry } from '../../src/cache/feed'
import type { BulkCacheFiles } from '../../src/scryfall/client'
import { MockHttpClient, MemoryLogger, gzipJsonLines, setLogger } from '../test-utils'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'

const FEED_URL = 'https://feed.example/feed.json'

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
  const artifacts: Array<{ kind: CacheFeedEntry['kind']; name: string; body: Uint8Array }> = [
    {
      kind: 'default-cards',
      name: `default-cards-${stamp}.jsonl.gz`,
      body: gzipJsonLines(cardLines),
    },
    ...(options.includeAllCards
      ? [
          {
            kind: 'all-cards' as const,
            name: `all-cards-${stamp}.jsonl.gz`,
            // The every-language bulk: the same card plus a foreign object.
            body: gzipJsonLines([...cardLines, { name: 'Sol Ring', set: 'cmr', lang: 'ja' }]),
          },
        ]
      : []),
    {
      kind: 'oracle-tags',
      // Tag content never changes across these fixtures, so — like the real
      // host, whose entries are reused verbatim when unchanged — the name is stable.
      name: 'oracle-tags-stable.jsonl.gz',
      body: gzipJsonLines([
        { object: 'tag', id: 't1', label: 'ramp', slug: 'ramp', type: 'oracle' },
      ]),
    },
    {
      kind: 'art-tags',
      name: 'art-tags-stable.jsonl.gz',
      body: gzipJsonLines([
        { object: 'tag', id: 'a1', label: 'sun', slug: 'sun', type: 'illustration' },
      ]),
    },
  ]

  const entries: CacheFeedEntry[] = []
  const bodies: Record<string, Uint8Array> = {}
  for (const artifact of artifacts) {
    const fileUrl = `https://feed.example/files/${artifact.name}`
    const infoHash = (await sha256Of(artifact.body)).slice(0, 40)
    entries.push({
      kind: artifact.kind,
      fileName: artifact.name,
      infoHash,
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      length: artifact.body.byteLength,
      sha256: await sha256Of(artifact.body),
      scryfallUpdatedAt: stamp,
      publishedAt: stamp,
      fileUrl,
      torrentUrl: `https://feed.example/torrents/${infoHash}.torrent`,
    })
    bodies[artifact.name] = artifact.body
    http.mock(fileUrl, () => new Response(artifact.body.slice()))
  }

  const feed: CacheFeedDocument = { version: FEED_VERSION, generatedAt: stamp, entries }
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
