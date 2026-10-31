/**
 * The feed *server*: publishes the bulk artifacts and seeds their torrents.
 * The client half — the code a `ritual cache` refresh runs to fetch a feed —
 * lives in `src/cache/feed-client.ts`, below this layer, with the feed document
 * it parses (`src/cache/feed.ts`) and its download helper.
 */

import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readdir, unlink } from 'node:fs/promises'
import { createDefaultFileSystemClient, type HttpClient } from '../util/interfaces'
import { writeFileAtomic } from '../util/atomic-write'
import { disclosedMessage, keyedRefusal, nestedRefusal } from '../api/http'
import { t, type ParameterlessKey } from '../i18n/t'
import {
  errorParam,
  renderSyncMessage,
  syncMessage,
  SyncMessageError,
  syncRef,
} from '../sync/message'
import { decodePathSegment } from '../cache-server/helpers'
import { httpStatus } from '../scryfall/http-status'
import {
  SCRYFALL_BULK_API_URL,
  fetchScryfallBulkManifest,
  type ScryfallBulkManifestEntry,
} from '../scryfall/bulk-manifest'
import {
  BULK_TYPE_BY_KIND,
  CACHE_FEED_LOG_PREFIX,
  FEED_FILENAME,
  FEED_VERSION,
  TAG_FEED_KINDS,
  parseCacheFeed,
  type CacheFeedDocument,
  type CacheFeedEntry,
  type CacheFeedKind,
} from '../cache/feed'
import { createFileTorrent } from './torrents'
import { streamToFile } from '../cache/feed-download'

export const DEFAULT_BULK_API_URL = SCRYFALL_BULK_API_URL

/** A `.torrent` loaded from the feed dir, ready to hand to the seeder. */
export type FeedTorrentFile = {
  infoHash: string
  buffer: Uint8Array
}

/** The kinds a host publishes when not told otherwise: the English-only card bulk plus tags. */
export const DEFAULT_HOST_KINDS: readonly CacheFeedKind[] = ['default-cards', ...TAG_FEED_KINDS]

export type CacheFeedHostOptions = {
  /** Directory holding `feed.json`, `files/`, and `torrents/`. */
  feedDir: string
  /** Public base URL of this host — embedded in file/torrent/web-seed URLs. */
  publicUrl: string
  /** Scryfall bulk-data manifest URL (overridable for mirrors and tests). */
  bulkApiUrl?: string
  /**
   * Which artifacts this host publishes ({@link DEFAULT_HOST_KINDS} when
   * omitted). A host serving non-English clients includes `all-cards`; one
   * serving both audiences publishes both card kinds — each client downloads
   * only the card kind its own config demands.
   */
  kinds?: readonly CacheFeedKind[]
  http: HttpClient
  log?: (message: string) => void
}

const fileSystem = createDefaultFileSystemClient()

/** Why the feed host refuses a request: a `domain.cache.feedReply.*` message. */
type FeedRefusalKey = Extract<ParameterlessKey, `domain.cache.feedReply.${string}`>

/**
 * A refused request's reply: the shared keyed refusal body, as the cache server
 * answers. Status codes and headers are the machine contract — a web-seed or
 * feed client acts on the status alone. A refusal is never cached: the same
 * request succeeds once the feed is generated or republished.
 */
function feedRefusal(
  key: FeedRefusalKey,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return keyedRefusal(key, status, { 'Cache-Control': 'no-store', ...headers })
}

/** The methods every feed route answers: the guard and a `405`'s `Allow` both read this. */
const ALLOWED_METHODS = ['GET', 'HEAD'] as const

type AllowedMethod = (typeof ALLOWED_METHODS)[number]

function isAllowedMethod(method: string): method is AllowedMethod {
  return ALLOWED_METHODS.some((allowed) => allowed === method)
}

/**
 * How long a client is told to wait (`Retry-After`, seconds) before asking
 * again for a feed that is still being generated — about one bulk download.
 */
const NOT_GENERATED_RETRY_SECONDS = 60

/** The `/health` body: whether the host is up, and what it currently publishes. */
export type FeedHealthResponse = {
  status: 'ok'
  /** How many artifacts the current feed lists (0 before the first feed). */
  entries: number
  /** The current feed's `generatedAt`, or `null` before the first feed. */
  generatedAt: string | null
}

/**
 * The cache-feed host engine: downloads the raw Scryfall bulk files, torrents
 * them (with this host's HTTP URLs as web seeds), publishes `feed.json`, and
 * serves the feed, files, and torrents over HTTP.
 *
 * The raw `.jsonl.gz` artifacts are distributed byte-identical to Scryfall's —
 * peers run their own ingestion, so schema changes in ritual's processed cache
 * never version-skew the swarm.
 */
export class CacheFeedHost {
  private feed: CacheFeedDocument | null = null
  private refreshing: Promise<boolean> | null = null

  constructor(private readonly options: CacheFeedHostOptions) {}

  get filesDir(): string {
    return path.join(this.options.feedDir, 'files')
  }

  get torrentsDir(): string {
    return path.join(this.options.feedDir, 'torrents')
  }

  private get feedPath(): string {
    return path.join(this.options.feedDir, FEED_FILENAME)
  }

  private get publicUrl(): string {
    return this.options.publicUrl.replace(/\/+$/, '')
  }

  private log(message: string): void {
    ;(this.options.log ?? console.log)(`${CACHE_FEED_LOG_PREFIX} ${message}`)
  }

  currentFeed(): CacheFeedDocument | null {
    return this.feed
  }

  /** Load a previously-published feed.json so a restart can serve immediately. */
  async loadExistingFeed(): Promise<void> {
    let raw: string
    try {
      raw = await fileSystem.readFile(this.feedPath, 'utf-8')
    } catch {
      return
    }
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      this.log(t('cli.cacheFeed.ignoringUnreadable', { file: FEED_FILENAME }))
      return
    }
    const parsed = parseCacheFeed(json)
    if (typeof parsed === 'string') {
      // `parsed` is the feed parser's reason, already worded in this locale.
      this.log(t('cli.cacheFeed.ignoringState', { file: FEED_FILENAME, reason: parsed }))
      return
    }
    this.feed = parsed
    this.log(t('cli.cacheFeed.loadedExisting', { generatedAt: parsed.generatedAt }))
  }

  /**
   * Check Scryfall's bulk manifest and republish the feed when anything
   * changed. Returns whether a new feed document was published. Concurrent
   * calls coalesce onto the in-flight refresh.
   */
  refresh(now: Date = new Date()): Promise<boolean> {
    this.refreshing ??= this.refreshLocked(now).finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async refreshLocked(now: Date): Promise<boolean> {
    await mkdir(this.filesDir, { recursive: true })
    await mkdir(this.torrentsDir, { recursive: true })

    const manifest = await this.fetchBulkManifest()
    const entries: CacheFeedEntry[] = []
    let changed = false

    for (const kind of this.options.kinds ?? DEFAULT_HOST_KINDS) {
      const bulkType = BULK_TYPE_BY_KIND[kind]
      const manifestEntry = manifest.find((entry) => entry.type === bulkType)
      if (!manifestEntry?.jsonl_download_uri || !manifestEntry.updated_at) {
        throw new SyncMessageError(syncMessage('cli.cacheFeed.manifestEntryMissing', { bulkType }))
      }

      const existing = this.feed?.entries.find((entry) => entry.kind === kind)
      if (existing && existing.scryfallUpdatedAt === manifestEntry.updated_at) {
        try {
          await fileSystem.access(path.join(this.filesDir, existing.fileName))
          entries.push(existing)
          continue
        } catch {
          this.log(t('cli.cacheFeed.artifactMissing', { file: existing.fileName }))
        }
      }

      this.log(t('cli.cacheFeed.downloadingBulk', { kind, updatedAt: manifestEntry.updated_at }))
      entries.push(
        await this.downloadArtifact(
          kind,
          manifestEntry.jsonl_download_uri,
          manifestEntry.updated_at,
          now,
        ),
      )
      changed = true
    }

    // "Unchanged" must also compare the entry list itself: a host restarted
    // with a different `kinds` configuration reuses every artifact it kept
    // (changed = false) yet still needs to publish the added/dropped entries.
    const unchanged =
      !changed &&
      this.feed !== null &&
      this.feed.entries.length === entries.length &&
      entries.every((entry, index) => this.feed?.entries[index] === entry)
    if (unchanged) {
      this.log(t('cli.cacheFeed.upToDate'))
      return false
    }

    const feed: CacheFeedDocument = {
      version: FEED_VERSION,
      generatedAt: now.toISOString(),
      entries,
    }
    await writeFileAtomic(this.feedPath, JSON.stringify(feed, null, 2), { fs: fileSystem })
    this.feed = feed
    await this.pruneUnreferenced()
    this.log(t('cli.cacheFeed.published', { count: entries.length }))
    return true
  }

  private fetchBulkManifest(): Promise<ScryfallBulkManifestEntry[]> {
    return fetchScryfallBulkManifest(this.options.http, this.options.bulkApiUrl)
  }

  /**
   * Stream one bulk file to `files/`, hashing as it lands, then build its
   * torrent (web-seeded by this host) and write the `.torrent` next to it.
   */
  private async downloadArtifact(
    kind: CacheFeedKind,
    downloadUri: string,
    scryfallUpdatedAt: string,
    now: Date,
  ): Promise<CacheFeedEntry> {
    const fileName = decodeURIComponent(path.basename(new URL(downloadUri).pathname))
    if (!fileName || fileName.includes('/') || fileName.includes('..')) {
      throw new SyncMessageError(
        syncMessage('cli.cacheFeed.suspiciousFileName', { file: fileName }),
      )
    }

    const response = await this.options.http.fetch(downloadUri)
    if (!response.ok) {
      throw new SyncMessageError(
        syncMessage('cli.cacheFeed.bulkDownloadFailed', { kind, ...httpStatus(response) }),
      )
    }
    if (!response.body) {
      throw new SyncMessageError(syncMessage('cli.cacheFeed.bulkNoBody', { kind }))
    }

    const filePath = path.join(this.filesDir, fileName)
    const hash = createHash('sha256')
    let length = 0
    await streamToFile(response.body, filePath, (chunk) => {
      hash.update(chunk)
      length += chunk.byteLength
    })

    const fileUrl = `${this.publicUrl}/files/${encodeURIComponent(fileName)}`
    const torrent = await createFileTorrent(filePath, fileUrl, now)
    await writeFileAtomic(
      path.join(this.torrentsDir, `${torrent.infoHash}.torrent`),
      torrent.buffer,
      {
        fs: fileSystem,
      },
    )

    return {
      kind,
      fileName,
      infoHash: torrent.infoHash,
      magnet: torrent.magnet,
      length,
      sha256: hash.digest('hex'),
      scryfallUpdatedAt,
      publishedAt: now.toISOString(),
      fileUrl,
      torrentUrl: `${this.publicUrl}/torrents/${torrent.infoHash}.torrent`,
    }
  }

  /** Delete files and torrents no longer referenced by the current feed. */
  private async pruneUnreferenced(): Promise<void> {
    if (!this.feed) return
    const liveFiles = new Set(this.feed.entries.map((entry) => entry.fileName))
    const liveTorrents = new Set(this.feed.entries.map((entry) => `${entry.infoHash}.torrent`))

    for (const name of await readdir(this.filesDir)) {
      if (!liveFiles.has(name)) {
        this.log(t('cli.cacheFeed.pruning', { file: name }))
        await unlink(path.join(this.filesDir, name)).catch(() => {})
      }
    }
    for (const name of await readdir(this.torrentsDir)) {
      if (!liveTorrents.has(name)) {
        await unlink(path.join(this.torrentsDir, name)).catch(() => {})
      }
    }
  }

  /** Read the current feed's `.torrent` files, for handing to the seeder. */
  async torrentFiles(): Promise<FeedTorrentFile[]> {
    if (!this.feed) return []
    const torrents: FeedTorrentFile[] = []
    for (const entry of this.feed.entries) {
      const filePath = path.join(this.torrentsDir, `${entry.infoHash}.torrent`)
      const buffer = new Uint8Array(await Bun.file(filePath).arrayBuffer())
      torrents.push({ infoHash: entry.infoHash, buffer })
    }
    return torrents
  }

  /**
   * HTTP handler for `/feed.json`, `/files/<name>`, `/torrents/<name>`, `/health`.
   * Always answers: an unexpected failure is logged and answered as a keyed
   * `500`, so the caller's access log records every request. The reply names a
   * keyed failure; anything else (an exception's raw text, which can name the
   * host's files) stays in the log, and the reply is a generic message.
   */
  async handleRequest(req: Request): Promise<Response> {
    try {
      return await this.route(req)
    } catch (error) {
      this.log(
        renderSyncMessage(syncRef('cli.cacheFeed.requestFailed', { error: errorParam(error) })),
      )
      return nestedRefusal(disclosedMessage(error, 'domain.cache.feedReply.internalError'), 500, {
        'Cache-Control': 'no-store',
      })
    }
  }

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (!isAllowedMethod(req.method)) {
      return feedRefusal('domain.cache.feedReply.methodNotAllowed', 405, {
        Allow: ALLOWED_METHODS.join(', '),
      })
    }

    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        entries: this.feed?.entries.length ?? 0,
        generatedAt: this.feed?.generatedAt ?? null,
      } satisfies FeedHealthResponse)
    }

    if (url.pathname === `/${FEED_FILENAME}`) {
      if (!this.feed) {
        return feedRefusal('domain.cache.feedReply.notGenerated', 503, {
          'Retry-After': String(NOT_GENERATED_RETRY_SECONDS),
        })
      }
      return Response.json(this.feed, {
        headers: { 'Cache-Control': 'no-cache' },
      })
    }

    if (url.pathname.startsWith('/files/')) {
      const name = decodePathSegment(url.pathname.slice('/files/'.length))
      if (name === undefined) return feedRefusal('domain.cache.feedReply.pathMalformed', 400)
      if (!this.feed?.entries.some((entry) => entry.fileName === name)) {
        return feedRefusal('domain.cache.feedReply.fileNotListed', 404)
      }
      return this.serveFile(req, path.join(this.filesDir, name), 'application/gzip')
    }

    if (url.pathname.startsWith('/torrents/')) {
      const name = decodePathSegment(url.pathname.slice('/torrents/'.length))
      if (name === undefined) return feedRefusal('domain.cache.feedReply.pathMalformed', 400)
      if (!this.feed?.entries.some((entry) => `${entry.infoHash}.torrent` === name)) {
        return feedRefusal('domain.cache.feedReply.torrentNotListed', 404)
      }
      const file = Bun.file(path.join(this.torrentsDir, name))
      return new Response(file, {
        headers: { 'Content-Type': 'application/x-bittorrent' },
      })
    }

    return feedRefusal('domain.cache.feedReply.notFound', 404)
  }

  /** Serve a file with single-range support — web seeds (BEP 19) require it. */
  private async serveFile(req: Request, filePath: string, contentType: string): Promise<Response> {
    const file = Bun.file(filePath)
    const size = file.size
    // RFC 9110 §14.2: a server ignores `Range` on any method but GET, so a
    // HEAD answers with the whole representation's headers.
    const range = req.method === 'GET' ? req.headers.get('range') : null

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      // RFC 9110 §15.5.17: a 416 names the representation's length in
      // `Content-Range: bytes */<size>`; a range client reads that, not the body.
      const unsatisfiable = () =>
        feedRefusal('domain.cache.feedReply.rangeNotSatisfiable', 416, {
          'Content-Range': `bytes */${size}`,
        })
      if (!match || (match[1] === '' && match[2] === '')) {
        return unsatisfiable()
      }
      let start: number
      let end: number
      if (match[1] === '') {
        // Suffix range: the last N bytes.
        start = Math.max(0, size - Number(match[2]))
        end = size - 1
      } else {
        start = Number(match[1])
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
      }
      if (start > end || start >= size) {
        return unsatisfiable()
      }
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }

    return new Response(file, {
      headers: { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' },
    })
  }
}
