import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readdir, unlink } from 'node:fs/promises'
import { createDefaultFileSystemClient, type HttpClient } from '../interfaces'
import { writeFileAtomic } from '../cache/atomic-write'
import { throwHttpError } from '../errors'
import {
  SCRYFALL_BULK_API_URL,
  fetchScryfallBulkManifest,
  type ScryfallBulkManifestEntry,
} from '../scryfall/bulk-manifest'
import {
  BULK_TYPE_BY_KIND,
  FEED_FILENAME,
  FEED_KINDS,
  FEED_VERSION,
  parseCacheFeed,
  type CacheFeedDocument,
  type CacheFeedEntry,
  type CacheFeedKind,
} from './feed'
import { createFileTorrent } from './torrents'
import { streamToFile } from './download'

export const DEFAULT_BULK_API_URL = SCRYFALL_BULK_API_URL
export const CACHE_FEED_LOG_PREFIX = '[cache-feed]'

/** A `.torrent` loaded from the feed dir, ready to hand to the seeder. */
export type FeedTorrentFile = {
  infoHash: string
  buffer: Uint8Array
}

export type CacheFeedHostOptions = {
  /** Directory holding `feed.json`, `files/`, and `torrents/`. */
  feedDir: string
  /** Public base URL of this host — embedded in file/torrent/web-seed URLs. */
  publicUrl: string
  /** Scryfall bulk-data manifest URL (overridable for mirrors and tests). */
  bulkApiUrl?: string
  http: HttpClient
  log?: (message: string) => void
}

const fileSystem = createDefaultFileSystemClient()

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
      this.log(`Ignoring unreadable ${FEED_FILENAME} (not valid JSON).`)
      return
    }
    const parsed = parseCacheFeed(json)
    if (typeof parsed === 'string') {
      this.log(`Ignoring existing ${FEED_FILENAME}: ${parsed}`)
      return
    }
    this.feed = parsed
    this.log(`Loaded existing feed (generated ${parsed.generatedAt}).`)
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

    for (const kind of FEED_KINDS) {
      const bulkType = BULK_TYPE_BY_KIND[kind]
      const manifestEntry = manifest.find((entry) => entry.type === bulkType)
      if (!manifestEntry?.jsonl_download_uri || !manifestEntry.updated_at) {
        throw new Error(`Bulk manifest has no usable '${bulkType}' entry`)
      }

      const existing = this.feed?.entries.find((entry) => entry.kind === kind)
      if (existing && existing.scryfallUpdatedAt === manifestEntry.updated_at) {
        try {
          await fileSystem.access(path.join(this.filesDir, existing.fileName))
          entries.push(existing)
          continue
        } catch {
          this.log(`Artifact ${existing.fileName} is missing on disk; redownloading.`)
        }
      }

      this.log(`Downloading ${kind} (updated ${manifestEntry.updated_at})...`)
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

    if (!changed && this.feed) {
      this.log('Feed is up to date.')
      return false
    }

    const feed: CacheFeedDocument = {
      version: FEED_VERSION,
      generatedAt: now.toISOString(),
      entries,
    }
    await writeFileAtomic(fileSystem, this.feedPath, JSON.stringify(feed, null, 2))
    this.feed = feed
    await this.pruneUnreferenced()
    this.log(`Published feed with ${entries.length} entries.`)
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
      throw new Error(`Refusing suspicious bulk file name '${fileName}'`)
    }

    const response = await this.options.http.fetch(downloadUri)
    if (!response.ok) throwHttpError(response, `Failed to download ${kind} bulk`)
    if (!response.body) throw new Error(`Bulk download for ${kind} has no body`)

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
      fileSystem,
      path.join(this.torrentsDir, `${torrent.infoHash}.torrent`),
      torrent.buffer,
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
        this.log(`Pruning stale artifact ${name}`)
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

  /** HTTP handler for `/feed.json`, `/files/<name>`, `/torrents/<name>`, `/health`. */
  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 })
    }

    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        entries: this.feed?.entries.length ?? 0,
        generatedAt: this.feed?.generatedAt ?? null,
      })
    }

    if (url.pathname === `/${FEED_FILENAME}`) {
      if (!this.feed) return new Response('Feed not generated yet', { status: 503 })
      return Response.json(this.feed, {
        headers: { 'Cache-Control': 'no-cache' },
      })
    }

    if (url.pathname.startsWith('/files/')) {
      const name = decodeURIComponent(url.pathname.slice('/files/'.length))
      if (!this.feed?.entries.some((entry) => entry.fileName === name)) {
        return new Response('Not found', { status: 404 })
      }
      return this.serveFile(req, path.join(this.filesDir, name), 'application/gzip')
    }

    if (url.pathname.startsWith('/torrents/')) {
      const name = decodeURIComponent(url.pathname.slice('/torrents/'.length))
      if (!this.feed?.entries.some((entry) => `${entry.infoHash}.torrent` === name)) {
        return new Response('Not found', { status: 404 })
      }
      const file = Bun.file(path.join(this.torrentsDir, name))
      return new Response(file, {
        headers: { 'Content-Type': 'application/x-bittorrent' },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  /** Serve a file with single-range support — web seeds (BEP 19) require it. */
  private async serveFile(req: Request, filePath: string, contentType: string): Promise<Response> {
    const file = Bun.file(filePath)
    const size = file.size
    const range = req.headers.get('range')

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      const unsatisfiable = () =>
        new Response('Invalid range', {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
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
