import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { Subprocess } from 'bun'
import WebTorrent from 'webtorrent'
import { ensureBinary, binaryPath, runCli } from './helpers/cli'
import { parseCacheFeed, type CacheFeedDocument } from '../../src/cache-feed/feed'
import { gzipJsonLines } from '../test-utils'

// Fixed ports for the spawned host; chosen away from the other suites' ports.
const FEED_PORT = 4915
const TORRENT_PORT = 4916

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

  test('a torrent client downloads an artifact from the host over TCP', async () => {
    const entry = feed.entries.find((candidate) => candidate.kind === 'default-cards')!
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
        const timer = setTimeout(() => reject(new Error('Leech timed out')), 30_000)
        const torrent = leecher.add(torrentBuf, { path: downloadDir })
        torrent.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))))
        torrent.on('infoHash', () => torrent.addPeer(`127.0.0.1:${TORRENT_PORT}`))
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
  }, 60_000)
})
