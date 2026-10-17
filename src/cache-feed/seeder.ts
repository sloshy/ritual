import type WebTorrent from 'webtorrent'
import type { Torrent } from 'webtorrent'
import { CACHE_FEED_LOG_PREFIX } from '../cache/feed'
import { t } from '../i18n/t'
import {
  errorParam,
  renderSyncMessage,
  syncMessage,
  SyncMessageError,
  syncRef,
} from '../sync/message'
import type { FeedTorrentFile } from './host'

// A torrent that cannot verify its on-disk artifact would otherwise wait on
// 'ready' forever, wedging every future scheduled refresh behind sync().
const SYNC_READY_TIMEOUT_MS = 60_000

export type FeedSeederOptions = {
  /** Directory containing the complete artifacts to seed. */
  filesDir: string
  /** Fixed TCP port for incoming peers (random when omitted). */
  torrentPort?: number
  /**
   * How long (ms) {@link FeedSeeder.sync} waits for an added torrent to verify
   * its on-disk artifact before giving up on it (60 s when omitted).
   */
  readyTimeoutMs?: number
  log?: (message: string) => void
}

export type FeedSeederStats = {
  torrents: number
  peers: number
  uploadedBytes: number
}

/**
 * Seeds the feed's artifacts over BitTorrent (TCP + DHT; trackers and WebRTC
 * are not used). webtorrent is imported lazily so the CLI pays its startup
 * cost only when actually hosting a feed.
 */
export class FeedSeeder {
  private client: WebTorrent | null = null

  constructor(private readonly options: FeedSeederOptions) {}

  private log(message: string): void {
    ;(this.options.log ?? console.log)(`${CACHE_FEED_LOG_PREFIX} ${message}`)
  }

  async start(): Promise<void> {
    if (this.client) return
    const { default: WebTorrentClient } = await import('webtorrent')
    this.client = new WebTorrentClient({
      tracker: false,
      utp: false,
      ...(this.options.torrentPort !== undefined ? { torrentPort: this.options.torrentPort } : {}),
    })
    this.client.on('error', (err) => {
      this.log(
        renderSyncMessage(syncRef('cli.cacheFeed.torrentClientError', { error: errorParam(err) })),
      )
    })
  }

  /**
   * Make the client seed exactly `torrents`: verify + add ones it doesn't have
   * yet, drop ones no longer in the feed. Resolves once every added torrent
   * has verified its on-disk artifact and is ready to serve peers.
   */
  async sync(torrents: FeedTorrentFile[]): Promise<void> {
    const client = this.client
    if (!client) {
      throw new Error(
        t('errors.invariant.calledBeforeSetup', { method: 'FeedSeeder.sync', setup: 'start()' }),
      )
    }

    const wanted = new Set(torrents.map((torrent) => torrent.infoHash))
    for (const existing of [...client.torrents]) {
      if (!wanted.has(existing.infoHash)) {
        this.log(
          t('cli.cacheFeed.stoppedSeeding', { name: existing.name, infoHash: existing.infoHash }),
        )
        client.remove(existing.infoHash)
      }
    }

    const have = new Set(client.torrents.map((torrent) => torrent.infoHash))
    const additions = torrents.filter((torrent) => !have.has(torrent.infoHash))
    await Promise.all(
      additions.map(
        (addition) =>
          new Promise<void>((resolve, reject) => {
            const torrent: Torrent = client.add(addition.buffer, { path: this.options.filesDir })
            const timer = setTimeout(() => {
              client.remove(addition.infoHash)
              reject(
                new SyncMessageError(
                  syncMessage('cli.cacheFeed.torrentNotReady', { infoHash: addition.infoHash }),
                ),
              )
            }, this.options.readyTimeoutMs ?? SYNC_READY_TIMEOUT_MS)
            torrent.on('ready', () => {
              clearTimeout(timer)
              this.log(
                t('cli.cacheFeed.seedingArtifact', {
                  name: torrent.name,
                  infoHash: torrent.infoHash,
                }),
              )
              resolve()
            })
            torrent.on('error', (err) => {
              clearTimeout(timer)
              reject(err instanceof Error ? err : new Error(String(err)))
            })
          }),
      ),
    )
  }

  /** The TCP port peers connect to, once the client is listening. */
  port(): number | null {
    return this.client?.address()?.port ?? null
  }

  stats(): FeedSeederStats {
    const torrents = this.client?.torrents ?? []
    return {
      torrents: torrents.length,
      peers: torrents.reduce((sum, torrent) => sum + torrent.numPeers, 0),
      uploadedBytes: torrents.reduce((sum, torrent) => sum + torrent.uploaded, 0),
    }
  }

  async stop(): Promise<void> {
    const client = this.client
    if (!client) return
    this.client = null
    await new Promise<void>((resolve) => {
      client.destroy(() => resolve())
    })
  }
}
