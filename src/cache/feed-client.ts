import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readdir, unlink } from 'node:fs/promises'
import type WebTorrent from 'webtorrent'
import type { Torrent } from 'webtorrent'
import { createDefaultFileSystemClient, type HttpClient } from '../util/interfaces'
import { writeFileAtomic } from '../util/atomic-write'
import { isRecord } from '../util/json'
import { t } from '../i18n/t'
import {
  errorParam,
  renderSyncMessage,
  syncMessage,
  SyncMessageError,
  syncRef,
} from '../sync/message'
import { replyParam } from './server-reply'
import { readReplyText } from '../util/reply-text'
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
import { COMMAND, CONFIG_KEY, FLAG, bareCommandLine, flagValue } from '../util/cli-tokens'

const STATE_FILENAME = 'state.json'

/** The three requests a feed client makes, each failure worded by a pair of keys. */
type FeedRequest = 'feed' | 'artifact' | 'torrent'

/** A failure without a reply body, and the same failure quoting the reply. */
type FailureKeys = {
  plain:
    | 'cli.cacheFeed.fetchFailed'
    | 'cli.cacheFeed.downloadFailed'
    | 'cli.cacheFeed.torrentFetchFailed'
  withBody:
    | 'cli.cacheFeed.fetchFailedWithBody'
    | 'cli.cacheFeed.downloadFailedWithBody'
    | 'cli.cacheFeed.torrentFetchFailedWithBody'
}

const FAILURE_KEYS: Record<FeedRequest, FailureKeys> = {
  feed: { plain: 'cli.cacheFeed.fetchFailed', withBody: 'cli.cacheFeed.fetchFailedWithBody' },
  artifact: {
    plain: 'cli.cacheFeed.downloadFailed',
    withBody: 'cli.cacheFeed.downloadFailedWithBody',
  },
  torrent: {
    plain: 'cli.cacheFeed.torrentFetchFailed',
    withBody: 'cli.cacheFeed.torrentFetchFailedWithBody',
  },
}

/**
 * A failed feed request as the error to throw — the twin of the cache
 * client's `requestFailure` (`src/cache/http-cache.ts`). A Ritual feed host
 * answers a refusal with a keyed body (`domain.cache.feedReply.*`), nested
 * here so it reads in the client's language ("the feed has not been generated
 * yet"); any other reply's text is quoted (`replyParam`), and an empty reply
 * leaves the status alone.
 */
async function feedRequestFailure(
  response: Response,
  request: FeedRequest,
  url: string,
): Promise<SyncMessageError> {
  const body = replyParam(await readReplyText(response))
  const status = response.status
  const keys = FAILURE_KEYS[request]
  return new SyncMessageError(
    body === ''
      ? syncMessage(keys.plain, { url, status })
      : syncMessage(keys.withBody, { url, status, body }),
  )
}

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
    return t('cli.cacheFeed.stateNotObject')
  }
  const ingested = json['ingested']
  if (!isRecord(ingested)) {
    return t('cli.cacheFeed.stateMissingIngested')
  }
  for (const [kind, entry] of Object.entries(ingested)) {
    if (!(FEED_KINDS as readonly string[]).includes(kind)) {
      return t('cli.cacheFeed.stateUnknownKind', { kind })
    }
    if (
      !isRecord(entry) ||
      typeof entry['infoHash'] !== 'string' ||
      typeof entry['ingestedAt'] !== 'string'
    ) {
      return t('cli.cacheFeed.stateEntryInvalid', { kind })
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
        this.log(t('cli.cacheFeed.ignoringState', { file: STATE_FILENAME, reason: parsed }))
        return { ingested: {} }
      }
      return parsed
    } catch {
      this.log(t('cli.cacheFeed.ignoringUnreadable', { file: STATE_FILENAME }))
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
    await writeFileAtomic(this.statePath, JSON.stringify(state, null, 2), { fs: fileSystem })
  }

  /** Fetch and validate the feed document. */
  async fetchFeed(): Promise<CacheFeedDocument> {
    const response = await this.options.http.fetch(this.options.feedUrl)
    if (!response.ok) {
      throw await feedRequestFailure(response, 'feed', this.options.feedUrl)
    }
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
        throw new SyncMessageError(
          kind === 'all-cards'
            ? syncMessage('cli.cacheFeed.missingAllCardsEntry', { kind, configKey: CONFIG_KEY.defaultLanguage, hostCommand: bareCommandLine(COMMAND.cacheFeedHost, FLAG.cards, 'all'), sourceFlag: flagValue(FLAG.source, 'scryfall') })
            : syncMessage('cli.cacheFeed.missingEntry', { kind }),
        )
      }

      const filePath = path.join(this.filesDir, entry.fileName)
      paths[kind] = filePath

      const alreadyIngested = !force && state.ingested[kind]?.infoHash === entry.infoHash
      if (!alreadyIngested) changedKinds.push(kind)

      if (await this.haveVerifiedFile(filePath, entry)) {
        if (!alreadyIngested) this.log(t('cli.cacheFeed.reusing', { file: entry.fileName }))
        continue
      }
      if (alreadyIngested) {
        // The cache already holds this artifact's data, but the on-disk copy
        // is gone (deleted, or renamed upstream) — restore it so seeding and
        // any future forced ingest have a file to work with, and so the prune
        // below can never leave a live entry with no artifact.
        this.log(t('cli.cacheFeed.restoring', { file: entry.fileName }))
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
        this.log(
          t('cli.cacheFeed.stoppedSeeding', { name: torrent.name, infoHash: torrent.infoHash }),
        )
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
      throw new SyncMessageError(
        syncMessage('cli.cacheFeed.hashMismatch', { file: entry.fileName, hash }),
      )
    }
  }

  /** Plain-HTTP download from the feed's file URL (the `--no-p2p` path). */
  private async downloadOverHttp(entry: CacheFeedEntry, filePath: string): Promise<void> {
    this.log(t('cli.cacheFeed.downloadingHttp', { file: entry.fileName }))
    const response = await this.options.http.fetch(entry.fileUrl)
    if (!response.ok) {
      throw await feedRequestFailure(response, 'artifact', entry.fileUrl)
    }
    if (!response.body) {
      throw new SyncMessageError(syncMessage('cli.cacheFeed.downloadNoBody', { file: entry.fileName }))
    }
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

    this.log(t('cli.cacheFeed.downloadingTorrent', { file: entry.fileName }))
    await new Promise<void>((resolve, reject) => {
      const torrent: Torrent = client.add(torrentBuf, { path: this.filesDir })
      // A torrent whose web seed and peers are all unreachable would otherwise
      // hang forever; fail instead so the caller (and its fallback) can react.
      const timer = setTimeout(() => {
        client.remove(entry.infoHash)
        reject(
          new SyncMessageError(syncMessage('cli.cacheFeed.torrentTimedOut', { file: entry.fileName })),
        )
      }, TORRENT_DOWNLOAD_TIMEOUT_MS)
      torrent.on('error', (err) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
      torrent.on('done', () => {
        clearTimeout(timer)
        this.log(t('cli.cacheFeed.completed', { file: entry.fileName, count: torrent.numPeers }))
        resolve()
      })
    })
  }

  private async fetchTorrentFile(entry: CacheFeedEntry): Promise<Uint8Array> {
    const response = await this.options.http.fetch(entry.torrentUrl)
    if (!response.ok) {
      throw await feedRequestFailure(response, 'torrent', entry.torrentUrl)
    }
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
      this.log(
        renderSyncMessage(syncRef('cli.cacheFeed.torrentClientError', { error: errorParam(err) })),
      )
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
          reject(
            new SyncMessageError(
              syncMessage('cli.cacheFeed.torrentNotReady', { infoHash: entry.infoHash }),
            ),
          )
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
