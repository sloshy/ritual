import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { Subprocess } from 'bun'
import WebTorrent from 'webtorrent'
import { ensureBinary, binaryPath, runCli } from './helpers/cli'
import {
  parseCacheFeed,
  type CacheFeedDocument,
  type CacheFeedEntry,
} from '../../src/cache-feed/feed'
import { gzipJsonLines } from '../test-utils'

// Fixed ports for the spawned host; chosen away from the other suites' ports.
const FEED_PORT = 4915
const TORRENT_PORT = 4916
const CACHE_SERVER_PORT = 4918
const CACHE_SERVER_TORRENT_PORT = 4919

const artifacts: Record<string, Uint8Array> = {
  'default-cards-e2e.jsonl.gz': gzipJsonLines([
    { name: 'Sol Ring', set: 'cmr', prices: {}, games: ['paper'] },
    { name: 'Lightning Bolt', set: 'lea', prices: {}, games: ['paper'] },
  ]),
  'oracle-tags-e2e.jsonl.gz': gzipJsonLines([
    { object: 'tag', id: 't1', label: 'ramp', slug: 'ramp', type: 'oracle' },
  ]),
  'art-tags-e2e.jsonl.gz': gzipJsonLines([
    { object: 'tag', id: 'a1', label: 'sun', slug: 'sun', type: 'illustration' },
  ]),
}

async function waitForFeed(url: string, timeoutMs: number): Promise<CacheFeedDocument> {
  const start = Date.now()
  while (true) {
    // Only network errors mean "not up yet" — a malformed feed fails loudly.
    const response = await fetch(url).catch(() => null)
    if (response?.ok) {
      const parsed = parseCacheFeed(await response.json())
      if (typeof parsed === 'string') throw new Error(parsed)
      return parsed
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${url}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

// Leech the entry's artifact from a TCP peer and verify its sha256 hash.
async function leechAndVerify(entry: CacheFeedEntry, peerPort: number): Promise<void> {
  const torrentBuf = new Uint8Array(await (await fetch(entry.torrentUrl)).arrayBuffer())
  const downloadDir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-leech-'))
  const leecher = new WebTorrent({
    dht: false,
    tracker: false,
    lsd: false,
    utp: false,
    webSeeds: false,
    natUpnp: false,
    natPmp: false,
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Leech from 127.0.0.1:${peerPort} timed out`)),
        30_000,
      )
      const torrent = leecher.add(torrentBuf, { path: downloadDir })
      torrent.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))))
      torrent.on('infoHash', () => torrent.addPeer(`127.0.0.1:${peerPort}`))
      torrent.on('done', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    const downloaded = new Uint8Array(
      await Bun.file(path.join(downloadDir, entry.fileName)).arrayBuffer(),
    )
    const hash = new Bun.CryptoHasher('sha256').update(downloaded).digest('hex')
    expect(hash).toBe(entry.sha256)
  } finally {
    await new Promise<void>((resolve) => leecher.destroy(() => resolve()))
    await fs.rm(downloadDir, { recursive: true, force: true })
  }
}

describe('cache-feed host (e2e over the built binary)', () => {
  let upstream: ReturnType<typeof Bun.serve>
  let hostProc: Subprocess | undefined
  let feedDir: string
  let workDir: string
  let feed: CacheFeedDocument

  beforeAll(async () => {
    await ensureBinary()
    feedDir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-feed-e2e-'))
    workDir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-feed-e2e-cwd-'))

    upstream = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/bulk-data') {
          return Response.json({
            data: Object.keys(artifacts).map((name) => ({
              type: name.startsWith('default-cards')
                ? 'default_cards'
                : name.startsWith('oracle-tags')
                  ? 'oracle_tags'
                  : 'art_tags',
              updated_at: '2026-07-05T09:00:00Z',
              jsonl_download_uri: `http://127.0.0.1:${upstream.port}/${name}`,
            })),
          })
        }
        const body = artifacts[url.pathname.slice(1)]
        return body ? new Response(body.slice()) : new Response('not found', { status: 404 })
      },
    })

    hostProc = Bun.spawn(
      [
        binaryPath,
        'cache-feed',
        'host',
        '--port',
        String(FEED_PORT),
        '--torrent-port',
        String(TORRENT_PORT),
        '--upstream',
        `http://127.0.0.1:${upstream.port}/bulk-data`,
        '--dir',
        feedDir,
      ],
      { cwd: workDir, stdout: 'pipe', stderr: 'pipe' },
    )

    feed = await waitForFeed(`http://127.0.0.1:${FEED_PORT}/feed.json`, 60_000)
  }, 120_000)

  afterAll(async () => {
    hostProc?.kill()
    await hostProc?.exited
    await upstream.stop(true)
    await fs.rm(feedDir, { recursive: true, force: true })
    await fs.rm(workDir, { recursive: true, force: true })
  })

  test('publishes one feed entry per bulk artifact with matching hashes', async () => {
    expect(feed.entries).toHaveLength(3)
    for (const entry of feed.entries) {
      const bytes = new Uint8Array(await (await fetch(entry.fileUrl)).arrayBuffer())
      expect(bytes.byteLength).toBe(entry.length)
      const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
      expect(hash).toBe(entry.sha256)
    }
  })

  test('the fetch command syncs a fresh base dir from the feed and is then idempotent', async () => {
    const fetchDir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-fetch-cwd-'))
    try {
      const feedUrl = `http://127.0.0.1:${FEED_PORT}/feed.json`
      const first = await runCli(['cache-feed', 'fetch', '--url', feedUrl, '--no-seed'], fetchDir)
      expect(first.exitCode).toBe(0)
      expect(first.stdout).toContain('Card cache updated from the feed.')

      // The cards from the synthetic bulk were ingested into this base dir's cache.
      const cacheJson = await Bun.file(path.join(fetchDir, 'cache', 'cache.json')).text()
      expect(cacheJson).toContain('Sol Ring')
      expect(cacheJson).toContain('Lightning Bolt')
      // And the sync state was recorded.
      expect(
        await Bun.file(path.join(fetchDir, 'cache', 'feed-client', 'state.json')).exists(),
      ).toBeTrue()

      const second = await runCli(['cache-feed', 'fetch', '--url', feedUrl, '--no-seed'], fetchDir)
      expect(second.exitCode).toBe(0)
      expect(second.stdout).toContain('Feed is unchanged')
    } finally {
      await fs.rm(fetchDir, { recursive: true, force: true })
    }
  }, 60_000)

  test('a feed-mode cache server syncs on startup and seeds persistently', async () => {
    const serverDir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-cache-server-feed-'))
    let serverProc: Subprocess | undefined
    try {
      serverProc = Bun.spawn(
        [
          binaryPath,
          'cache-server',
          '--port',
          String(CACHE_SERVER_PORT),
          '--cache-source',
          'feed',
          '--feed-url',
          `http://127.0.0.1:${FEED_PORT}/feed.json`,
          '--feed-torrent-port',
          String(CACHE_SERVER_TORRENT_PORT),
        ],
        { cwd: serverDir, stdout: 'pipe', stderr: 'pipe' },
      )

      // Wait for the server to come up (startup feed sync happens first).
      const start = Date.now()
      while (true) {
        const health = await fetch(`http://127.0.0.1:${CACHE_SERVER_PORT}/health`).catch(() => null)
        if (health?.ok) break
        if (Date.now() - start > 60_000) throw new Error('cache-server did not come up')
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      // Startup sync ingested the feed's cards into this base dir's cache.
      const cacheJson = await Bun.file(path.join(serverDir, 'cache', 'cache.json')).text()
      expect(cacheJson).toContain('Sol Ring')
      // And recorded the sync state (proves the ingest branch ran, not a fallback).
      expect(
        await Bun.file(path.join(serverDir, 'cache', 'feed-client', 'state.json')).exists(),
      ).toBeTrue()

      // And the server seeds: leech the default-cards artifact from it over TCP.
      const entry = feed.entries.find((candidate) => candidate.kind === 'default-cards')!
      await leechAndVerify(entry, CACHE_SERVER_TORRENT_PORT)
      // The server's own log must attribute the ingest to the feed — a silent
      // fallback to a live Scryfall download would otherwise mask a broken
      // feed path (the synthetic cards share names with real ones).
      serverProc.kill()
      const [serverStdout] = await Promise.all([
        new Response(serverProc.stdout as ReadableStream).text(),
        serverProc.exited,
      ])
      serverProc = undefined
      expect(serverStdout).toContain('source=feed outcome=ingested')
      expect(serverStdout).not.toContain('source=scryfall')
    } finally {
      serverProc?.kill()
      await serverProc?.exited
      await fs.rm(serverDir, { recursive: true, force: true })
    }
  }, 120_000)

  test('--no-feed-seed syncs the cache without seeding', async () => {
    const serverDir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-cache-server-noseed-'))
    let serverProc: Subprocess | undefined
    try {
      serverProc = Bun.spawn(
        [
          binaryPath,
          'cache-server',
          '--port',
          String(CACHE_SERVER_PORT + 2),
          '--cache-source',
          'feed',
          '--feed-url',
          `http://127.0.0.1:${FEED_PORT}/feed.json`,
          '--no-feed-seed',
        ],
        { cwd: serverDir, stdout: 'pipe', stderr: 'pipe' },
      )
      const start = Date.now()
      while (true) {
        const health = await fetch(`http://127.0.0.1:${CACHE_SERVER_PORT + 2}/health`).catch(
          () => null,
        )
        if (health?.ok) break
        if (Date.now() - start > 60_000) throw new Error('cache-server did not come up')
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      serverProc.kill()
      const [stdout] = await Promise.all([
        new Response(serverProc.stdout as ReadableStream).text(),
        serverProc.exited,
      ])
      serverProc = undefined
      // The cache was still synced from the feed on startup...
      const cacheJson = await Bun.file(path.join(serverDir, 'cache', 'cache.json')).text()
      expect(cacheJson).toContain('Sol Ring')
      // ...from the feed, not a Scryfall fallback...
      expect(stdout).toContain('source=feed outcome=ingested')
      // ...but no torrent client was started.
      expect(stdout).not.toContain('Seeding feed artifacts')
    } finally {
      serverProc?.kill()
      await serverProc?.exited
      await fs.rm(serverDir, { recursive: true, force: true })
    }
  }, 120_000)

  test('a torrent client downloads an artifact from the host over TCP', async () => {
    const entry = feed.entries.find((candidate) => candidate.kind === 'default-cards')!
    await leechAndVerify(entry, TORRENT_PORT)
  }, 60_000)
})
