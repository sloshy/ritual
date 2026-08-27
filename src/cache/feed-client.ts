import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readdir, unlink } from 'node:fs/promises'
import type WebTorrent from 'webtorrent'
import type { Torrent } from 'webtorrent'
import { createDefaultFileSystemClient, type HttpClient } from '../util/interfaces'
import { writeFileAtomic } from './atomic-write'
import { throwHttpError } from '../util/errors'
import { isRecord } from '../util/json'
import type { BulkCacheFiles } from '../scryfall/client'
import { configuredCardBulkType } from '../scryfall/bulk-manifest'
import {
  CACHE_FEED_LOG_PREFIX,
  CARD_BULK_TYPE_BY_KIND,
  CARD_KIND_BY_BULK_TYPE,
  FEED_KINDS,
  TAG_FEED_KINDS,
  parseCacheFeed,
  type CacheFeedDocument,
  type CacheFeedEntry,
  type CacheFeedKind,
  type CardFeedKind,
} from './feed'
import { streamToFile } from './feed-download'

/**
 * Default feed URL consulted when neither `--url` nor the `cacheFeedUrl`
 * config key is set. Placeholder until an official community feed is hosted —
 * point your own host's URL at it via `config set cacheFeedUrl <url>`.
 */
export const DEFAULT_FEED_URL = 'https://feed.ritual-mtg.example/feed.json'

const STATE_FILENAME = 'state.json'

// A stuck swarm (webseed down, no peers) must fail rather than hang sync().
const TORRENT_DOWNLOAD_TIMEOUT_MS = 30 * 60_000
// Verifying existing on-disk artifacts is local work and should be quick.
const TORRENT_READY_TIMEOUT_MS = 60_000

/** What this client last ingested, per artifact kind. */
export type CacheFeedClientState = {
  ingested: Partial<Record<CacheFeedKind, { infoHash: string; ingestedAt: string }>>
}

/**
 * Validate and parse a persisted feed-client state file. Returns an error
 * string (never throws) when the shape is wrong, per the parser conventions
 * in AGENTS.md — a malformed state is treated as "nothing ingested yet".
 */
export function parseCacheFeedClientState(json: unknown): CacheFeedClientState | string {
  if (!isRecord(json)) {
    return 'Invalid feed-client state: expected an object'
  }
  const ingested = json['ingested']
  if (!isRecord(ingested)) {
    return 'Invalid feed-client state: missing ingested map'
  }
  for (const [kind, entry] of Object.entries(ingested)) {
    if (!(FEED_KINDS as readonly string[]).includes(kind)) {
      return `Invalid feed-client state: unknown kind '${kind}'`
    }
    if (
      !isRecord(entry) ||
      typeof entry['infoHash'] !== 'string' ||
      typeof entry['ingestedAt'] !== 'string'
    ) {
      return `Invalid feed-client state: entry for '${kind}' is missing a string infoHash/ingestedAt`
    }
  }
  return json as CacheFeedClientState
}

/** Options for {@link CacheFeedClient.sync}. */
export type FeedSyncOptions = {
  /** Re-download and re-ingest even when the feed matches the last ingested state. */
  force?: boolean
}

/** How a {@link CacheFeedClient.sync} run concluded. */
export type FeedSyncResult = {
  feed: CacheFeedDocument
  outcome: 'ingested' | 'unchanged'
}

/** The artifacts a fetch produced, plus what changed. */
export type FetchResult = {
  feed: CacheFeedDocument
  /** Required kinds whose infoHash differed from the last ingested state. */
  changedKinds: CacheFeedKind[]
  /** Local path of every required artifact (downloaded or reused), ready to ingest. */
  files: BulkCacheFiles
}

export type CacheFeedClientOptions = {
  /** The feed document URL, e.g. `https://feed.example/feed.json`. */
  feedUrl: string
  /** Directory holding downloaded artifacts and the client state. */
  dataDir: string
  http: HttpClient
  /** Ingests the downloaded artifacts (normally `preloadCacheFromFiles`). */
  ingest: (files: BulkCacheFiles) => Promise<void>
  /**
   * Which card bulk to fetch from the feed. Defaults to what the configured
   * `defaultLanguage` demands (`default-cards` for `en`, `all-cards`
   * otherwise), resolved at sync time so every construction site — the CLI,
   * `refreshCardCacheFromFeed`, the cache server — honors the config without
   * each having to read it.
   */
  cardKind?: CardFeedKind
  /** Download over BitTorrent (with web-seed fallback); false = plain HTTP. */
  p2p?: boolean
  /** Fixed TCP port for torrent peers (random when omitted). */
  torrentPort?: number
  log?: (message: string) => void
}

const fileSystem = createDefaultFileSystemClient()

/**
 * The cache-feed client: fetches a feed document, downloads changed artifacts
 * over BitTorrent (web seeds make an empty swarm harmless) or plain HTTP,
 * verifies each file's SHA-256 against the feed, and tracks what has been
 * ingested so unchanged feeds are a cheap no-op.
 *
 * While the torrent client is alive it uploads to peers — callers that "sit
 * open" after fetching keep sharing simply by not calling {@link stop}.
 */
export class CacheFeedClient {
  private torrentClient: WebTorrent | null = null

  constructor(private readonly options: CacheFeedClientOptions) {}

  get filesDir(): string {
    return path.join(this.options.dataDir, 'files')
  }

  private get statePath(): string {
    return path.join(this.options.dataDir, STATE_FILENAME)
  }

  private log(message: string): void {
    ;(this.options.log ?? console.log)(`${CACHE_FEED_LOG_PREFIX} ${message}`)
  }

  /** The card kind this client fetches — explicit option, else what the config demands. */
  private get cardKind(): CardFeedKind {
    return this.options.cardKind ?? CARD_KIND_BY_BULK_TYPE[configuredCardBulkType()]
  }

  /** The kinds this client downloads and ingests: its card bulk plus both tag bulks. */
  private requiredKinds(): CacheFeedKind[] {
    return [this.cardKind, ...TAG_FEED_KINDS]
  }

  /** Read the persisted state; malformed or missing state means "never ingested". */
  async loadState(): Promise<CacheFeedClientState> {
    let raw: string
    try {
      raw = await fileSystem.readFile(this.statePath, 'utf-8')
    } catch {
      return { ingested: {} }
    }
    try {
      const parsed = parseCacheFeedClientState(JSON.parse(raw))
      if (typeof parsed === 'string') {
        this.log(`Ignoring ${STATE_FILENAME}: ${parsed}`)
        return { ingested: {} }
      }
      return parsed
    } catch {
      this.log(`Ignoring unreadable ${STATE_FILENAME} (not valid JSON).`)
      return { ingested: {} }
    }
  }

  /**
   * Record the feed's artifacts for the given kinds as ingested. Only the
   * kinds this client actually ingested are recorded — any other card kind's
   * old record is deliberately dropped, because the ingest just overwrote the
   * cache's contents: after a `defaultLanguage` switch and back, an "unchanged"
   * answer based on a stale record would leave the wrong bulk's data in place.
   */
  async saveState(
    feed: CacheFeedDocument,
    ingestedAt: Date,
    kinds: readonly CacheFeedKind[],
  ): Promise<void> {
    const state: CacheFeedClientState = { ingested: {} }
    for (const entry of feed.entries) {
      if (!kinds.includes(entry.kind)) continue
      state.ingested[entry.kind] = {
        infoHash: entry.infoHash,
        ingestedAt: ingestedAt.toISOString(),
      }
    }
    await mkdir(this.options.dataDir, { recursive: true })
    await writeFileAtomic(fileSystem, this.statePath, JSON.stringify(state, null, 2))
  }

  /** Fetch and validate the feed document. */
  async fetchFeed(): Promise<CacheFeedDocument> {
    const response = await this.options.http.fetch(this.options.feedUrl)
    if (!response.ok) throwHttpError(response, `Failed to fetch cache feed ${this.options.feedUrl}`)
    const parsed = parseCacheFeed(await response.json())
    if (typeof parsed === 'string') throw new Error(parsed)
    return parsed
  }

  /**
   * Compare `feed` against the persisted state and download every changed
   * **required** artifact — this client's card bulk and the two tag bulks; a
   * feed entry for the other card kind is ignored, never downloaded. Files
   * already on disk with a matching hash are reused. Returns the changed kinds
   * (empty = the cache is already current) and the local path of every
   * required artifact.
   */
  async downloadChanged(feed: CacheFeedDocument, force = false): Promise<FetchResult> {
    const state = await this.loadState()
    await mkdir(this.filesDir, { recursive: true })

    // Safe: the required-kinds loop below assigns every kind (or throws) before use.
    const paths = {} as Record<CacheFeedKind, string>
    const changedKinds: CacheFeedKind[] = []

    for (const kind of this.requiredKinds()) {
      const entry = feed.entries.find((candidate) => candidate.kind === kind)
      if (!entry) {
        const hint =
          kind === 'all-cards'
            ? " (the configured defaultLanguage needs the all_cards bulk, which this feed's host does not publish — host with `cache feed host --cards all` or refresh with --source scryfall)"
            : ''
        throw new Error(`Cache feed has no '${kind}' entry${hint}`)
      }

      const filePath = path.join(this.filesDir, entry.fileName)
      paths[kind] = filePath

      const alreadyIngested = !force && state.ingested[kind]?.infoHash === entry.infoHash
      if (!alreadyIngested) changedKinds.push(kind)

      if (await this.haveVerifiedFile(filePath, entry)) {
        if (!alreadyIngested) this.log(`Reusing already-downloaded ${entry.fileName}.`)
        continue
      }
      if (alreadyIngested) {
        // The cache already holds this artifact's data, but the on-disk copy
        // is gone (deleted, or renamed upstream) — restore it so seeding and
        // any future forced ingest have a file to work with, and so the prune
        // below can never leave a live entry with no artifact.
        this.log(`Restoring missing artifact ${entry.fileName}...`)
      }

      if (this.options.p2p === false) {
        await this.downloadOverHttp(entry, filePath)
      } else {
        await this.downloadOverTorrent(entry)
      }
      await this.verifyEntryHash(filePath, entry)
    }

    await this.pruneUnreferenced(feed)
    this.pruneStaleTorrents(feed)
    const files: BulkCacheFiles = {
      cards: paths[this.cardKind],
      cardBulkType: CARD_BULK_TYPE_BY_KIND[this.cardKind],
      oracleTags: paths['oracle-tags'],
      artTags: paths['art-tags'],
    }
    return { feed, changedKinds, files }
  }

  /**
   * Drop torrents for artifacts the current feed no longer references, so a
   * long-running seeder doesn't accumulate one orphaned torrent per rotation
   * (each pointing at a file {@link pruneUnreferenced} just deleted).
   */
  private pruneStaleTorrents(feed: CacheFeedDocument): void {
    const client = this.torrentClient
    if (!client) return
    const live = new Set(feed.entries.map((entry) => entry.infoHash))
    for (const torrent of [...client.torrents]) {
      if (!live.has(torrent.infoHash)) {
        this.log(`Stopped seeding superseded artifact ${torrent.name} (${torrent.infoHash})`)
        client.remove(torrent.infoHash)
      }
    }
  }

  /**
   * One full sync: fetch the feed, download changed artifacts, ingest them,
   * and persist the new state. Returns 'unchanged' (without ingesting) when
   * every artifact's infoHash matches what was last ingested.
   */
  async sync(options: FeedSyncOptions = {}): Promise<FeedSyncResult> {
    const feed = await this.fetchFeed()
    const result = await this.downloadChanged(feed, options.force ?? false)
    if (result.changedKinds.length === 0) {
      return { feed, outcome: 'unchanged' }
    }
    await this.options.ingest(result.files)
    await this.saveState(feed, new Date(), this.requiredKinds())
    return { feed, outcome: 'ingested' }
  }

  /** Whether `filePath` exists and already matches the entry's SHA-256. */
  private async haveVerifiedFile(filePath: string, entry: CacheFeedEntry): Promise<boolean> {
    const file = Bun.file(filePath)
    if (!(await file.exists()) || file.size !== entry.length) return false
    return (await sha256OfFile(filePath)) === entry.sha256
  }

  private async verifyEntryHash(filePath: string, entry: CacheFeedEntry): Promise<void> {
    const hash = await sha256OfFile(filePath)
    if (hash !== entry.sha256) {
      await unlink(filePath).catch(() => {})
      throw new Error(`Downloaded ${entry.fileName} does not match the feed's sha256 (got ${hash})`)
    }
  }

  /** Plain-HTTP download from the feed's file URL (the `--no-p2p` path). */
  private async downloadOverHttp(entry: CacheFeedEntry, filePath: string): Promise<void> {
    this.log(`Downloading ${entry.fileName} over HTTP...`)
    const response = await this.options.http.fetch(entry.fileUrl)
    if (!response.ok) throwHttpError(response, `Failed to download ${entry.fileName}`)
    if (!response.body) throw new Error(`Download of ${entry.fileName} has no body`)
    await streamToFile(response.body, filePath)
  }

  /**
   * Torrent download into the files dir. The torrent's embedded web seed makes
   * this work even with zero live peers; live peers make it faster and spread
   * the load. The completed torrent stays in the client, seeding, until
   * {@link stop}.
   */
  private async downloadOverTorrent(entry: CacheFeedEntry): Promise<void> {
    const client = await this.ensureTorrentClient()
    const torrentBuf = await this.fetchTorrentFile(entry)

    this.log(`Downloading ${entry.fileName} over BitTorrent...`)
    await new Promise<void>((resolve, reject) => {
      const torrent: Torrent = client.add(torrentBuf, { path: this.filesDir })
      // A torrent whose web seed and peers are all unreachable would otherwise
      // hang forever; fail instead so the caller (and its fallback) can react.
      const timer = setTimeout(() => {
        client.remove(entry.infoHash)
        reject(new Error(`Torrent download of ${entry.fileName} timed out`))
      }, TORRENT_DOWNLOAD_TIMEOUT_MS)
      torrent.on('error', (err) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
      torrent.on('done', () => {
        clearTimeout(timer)
        this.log(`Completed ${entry.fileName} (${torrent.numPeers} peers).`)
        resolve()
      })
    })
  }

  private async fetchTorrentFile(entry: CacheFeedEntry): Promise<Uint8Array> {
    const response = await this.options.http.fetch(entry.torrentUrl)
    if (!response.ok) throwHttpError(response, `Failed to fetch torrent for ${entry.fileName}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  private async ensureTorrentClient(): Promise<WebTorrent> {
    if (this.torrentClient) return this.torrentClient
    const { default: WebTorrentClient } = await import('webtorrent')
    this.torrentClient = new WebTorrentClient({
      tracker: false,
      utp: false,
      ...(this.options.torrentPort !== undefined ? { torrentPort: this.options.torrentPort } : {}),
    })
    this.torrentClient.on('error', (err) => {
      this.log(`Torrent client error: ${err instanceof Error ? err.message : String(err)}`)
    })
    return this.torrentClient
  }

  /**
   * Re-add every **required** artifact of `feed` to the torrent client so a
   * long-running fetch seeds all current artifacts, including unchanged ones
   * already on disk from a previous run. Entries for the other card kind are
   * skipped: adding a torrent whose file is not on disk would quietly start
   * downloading a multi-GB bulk this client never wanted.
   */
  async seedAll(feed: CacheFeedDocument): Promise<void> {
    const client = await this.ensureTorrentClient()
    const have = new Set(client.torrents.map((torrent) => torrent.infoHash))
    const wanted = new Set<CacheFeedKind>(this.requiredKinds())
    for (const entry of feed.entries) {
      if (!wanted.has(entry.kind)) continue
      if (have.has(entry.infoHash)) continue
      const torrentBuf = await this.fetchTorrentFile(entry)
      await new Promise<void>((resolve, reject) => {
        const torrent: Torrent = client.add(torrentBuf, { path: this.filesDir })
        const timer = setTimeout(() => {
          client.remove(entry.infoHash)
          reject(new Error(`Torrent ${entry.infoHash} did not become ready in time`))
        }, TORRENT_READY_TIMEOUT_MS)
        torrent.on('ready', () => {
          clearTimeout(timer)
          resolve()
        })
        torrent.on('error', (err) => {
          clearTimeout(timer)
          reject(err instanceof Error ? err : new Error(String(err)))
        })
      })
    }
  }

  /** How many torrents this client is currently seeding. */
  seededCount(): number {
    return this.torrentClient?.torrents.length ?? 0
  }

  /** Peers currently connected across all seeded torrents. */
  peerCount(): number {
    return (this.torrentClient?.torrents ?? []).reduce((sum, torrent) => sum + torrent.numPeers, 0)
  }

  /** The TCP port peers connect to, once the torrent client is listening. */
  torrentPortInUse(): number | null {
    return this.torrentClient?.address()?.port ?? null
  }

  /** Delete downloaded artifacts that the current feed no longer references. */
  private async pruneUnreferenced(feed: CacheFeedDocument): Promise<void> {
    const live = new Set(feed.entries.map((entry) => entry.fileName))
    let names: string[]
    try {
      names = await readdir(this.filesDir)
    } catch {
      return
    }
    // Prune runs only after all downloads settled, so any .partial here is a
    // leftover from a crashed run — clean those up too.
    for (const name of names) {
      if (!live.has(name)) {
        await unlink(path.join(this.filesDir, name)).catch(() => {})
      }
    }
  }

  /** Destroy the torrent client (stops seeding). */
  async stop(): Promise<void> {
    const client = this.torrentClient
    if (!client) return
    this.torrentClient = null
    await new Promise<void>((resolve) => {
      client.destroy(() => resolve())
    })
  }
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const reader = Bun.file(filePath).stream().getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return hash.digest('hex')
}
