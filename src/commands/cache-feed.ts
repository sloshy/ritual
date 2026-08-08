import path from 'node:path'
import { Command, InvalidArgumentError } from 'commander'
import { getCacheDir } from '../cache'
import { configuredCardBulkType } from '../scryfall/bulk-manifest'
import { defaultHttpClient } from '../http'
import { getErrorMessage } from '../errors'
import {
  addFeedUrlOption,
  addTorrentPortOption,
  parseRefreshCadence,
  resolveRefreshMs,
  scheduleRecurringTask,
} from '../cache/cadence'
import { t } from '../i18n/t'
import { ExitCode, parsePort } from './scripting'
import { DAY_REFRESH_MS } from '../cache-server/constants'
import type { RefreshCadence } from '../cache-server/types'
import { CACHE_FEED_LOG_PREFIX, CacheFeedHost, DEFAULT_BULK_API_URL } from '../cache-feed/host'
import { FeedSeeder } from '../cache-feed/seeder'
import {
  CARD_KIND_BY_BULK_TYPE,
  FEED_FILENAME,
  TAG_FEED_KINDS,
  type CacheFeedKind,
  type CardFeedKind,
} from '../cache-feed/feed'
import type { FeedSyncResult } from '../cache-feed/fetch'
import { createCacheFeedClient, resolveFeedUrl } from '../cache/refresh-source'

type CacheFeedFetchCommandOptions = {
  url?: string
  p2p: boolean
  seed: boolean
  torrentPort?: number
  force: boolean
  refresh?: RefreshCadence
}

/** Which card bulk(s) a feed host publishes alongside the tag bulks. */
type HostCardsChoice = 'default' | 'all' | 'both'

const HOST_CARDS_CHOICES: readonly HostCardsChoice[] = ['default', 'all', 'both']

type CacheFeedHostCommandOptions = {
  port: number
  host: string
  publicUrl?: string
  refresh?: RefreshCadence
  upstream: string
  dir?: string
  seed: boolean
  torrentPort?: number
  verbose: boolean
  cards?: HostCardsChoice
}

function parseHostCardsChoice(value: string): HostCardsChoice {
  const lower = value.toLowerCase()
  if ((HOST_CARDS_CHOICES as readonly string[]).includes(lower)) return lower as HostCardsChoice
  throw new InvalidArgumentError(t('cli.cacheFeed.invalidCards'))
}

/**
 * The card kinds a host publishes for a `--cards` choice; with the flag absent,
 * the one card bulk this machine's own `defaultLanguage` demands.
 */
function hostCardKinds(choice: HostCardsChoice | undefined): CardFeedKind[] {
  switch (choice) {
    case 'default':
      return ['default-cards']
    case 'all':
      return ['all-cards']
    case 'both':
      return ['default-cards', 'all-cards']
    case undefined:
      return [CARD_KIND_BY_BULK_TYPE[configuredCardBulkType()]]
  }
}

function log(message: string): void {
  console.log(`${CACHE_FEED_LOG_PREFIX} ${message}`)
}

/** Wire `cache feed host` and `cache feed fetch` under the parent `cache` command. */
export function registerCacheFeedSubcommand(cache: Command): void {
  const feed = cache.command('feed').description(t('help.cacheFeed.description'))

  addTorrentPortOption(
    feed
      .command('host')
      .description(t('help.cacheFeed.host'))
      .option('-p, --port <number>', t('help.cacheFeed.hostPort'), parsePort, 4010)
      .option('--host <hostname>', t('help.cacheFeed.hostHost'), '127.0.0.1')
      .option('--public-url <url>', t('help.cacheFeed.publicUrl'))
      .option('--refresh <interval>', t('help.cacheFeed.hostRefresh'), parseRefreshCadence)
      .option('--upstream <url>', t('help.cacheFeed.upstream'), DEFAULT_BULK_API_URL)
      .option('--dir <path>', t('help.cacheFeed.dir'))
      .option('--cards <which>', t('help.cacheFeed.cards'), parseHostCardsChoice)
      .option('--no-seed', t('help.cacheFeed.hostNoSeed')),
    t('help.cacheFeed.torrentPort'),
  )
    .option('-v, --verbose', t('help.cacheFeed.hostVerbose'), false)
    .action(async (options: CacheFeedHostCommandOptions) => {
      const feedDir = options.dir ?? path.join(getCacheDir(), 'feed')
      const publicUrl = options.publicUrl ?? `http://${options.host}:${options.port}`
      const kinds: CacheFeedKind[] = [...hostCardKinds(options.cards), ...TAG_FEED_KINDS]

      const host = new CacheFeedHost({
        feedDir,
        publicUrl,
        bulkApiUrl: options.upstream,
        kinds,
        http: defaultHttpClient,
      })

      await host.loadExistingFeed()
      try {
        await host.refresh()
      } catch (e) {
        if (!host.currentFeed()) {
          console.error(`${CACHE_FEED_LOG_PREFIX} ${t('cli.cacheFeed.initialFeedFailed')}`, e)
          process.exitCode = ExitCode.RuntimeError
          return
        }
        log(t('cli.cacheFeed.refreshFailed', { reason: getErrorMessage(e) }))
      }

      let seeder: FeedSeeder | null = null
      if (options.seed) {
        seeder = new FeedSeeder({
          filesDir: host.filesDir,
          ...(options.torrentPort !== undefined ? { torrentPort: options.torrentPort } : {}),
        })
        try {
          await seeder.start()
          await seeder.sync(await host.torrentFiles())
        } catch (e) {
          console.error(
            `${CACHE_FEED_LOG_PREFIX} ${t('cli.cacheFeed.seedStartFailed')}`,
            getErrorMessage(e),
          )
          // Destroy the torrent client so no live handle keeps the process open.
          await seeder.stop()
          process.exitCode = ExitCode.RuntimeError
          return
        }
        const port = seeder.port()
        const torrents = seeder.stats().torrents
        log(
          port
            ? t('cli.cacheFeed.seedingTorrentsOnPort', { count: torrents, port })
            : t('cli.cacheFeed.seedingTorrents', { count: torrents }),
        )
      }

      try {
        Bun.serve({
          hostname: options.host,
          port: options.port,
          idleTimeout: 120,
          fetch: async (req) => {
            const started = Date.now()
            const response = await host.handleRequest(req)
            if (options.verbose) {
              const { pathname } = new URL(req.url)
              log(`${req.method} ${pathname} ${response.status} ${Date.now() - started}ms`)
            }
            return response
          },
        })
      } catch (e) {
        // Most likely the port is already in use. Stop the seeder so its
        // torrent client doesn't keep the failed process alive.
        console.error(
          `${CACHE_FEED_LOG_PREFIX} ${t('cli.cacheFeed.serverStartFailed')}`,
          getErrorMessage(e),
        )
        if (seeder) await seeder.stop()
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const refreshMs =
        resolveRefreshMs(options.refresh, 'RITUAL_CACHE_FEED_REFRESH') ?? DAY_REFRESH_MS
      scheduleRecurringTask(
        refreshMs,
        async () => {
          const changed = await host.refresh()
          if (changed && seeder) {
            await seeder.sync(await host.torrentFiles())
          }
        },
        (error) =>
          console.error(
            `${CACHE_FEED_LOG_PREFIX} ${t('cli.cacheFeed.scheduledRefreshFailed')}`,
            error,
          ),
      )

      log(
        t('cli.cacheFeed.listening', {
          url: `http://${options.host}:${options.port}/${FEED_FILENAME}`,
        }),
      )
      log(t('cli.cacheFeed.publicUrl', { url: publicUrl }))
      if (!options.seed) {
        log(t('cli.cacheFeed.seedingDisabled'))
      }
    })

  addTorrentPortOption(
    addFeedUrlOption(
      feed.command('fetch').description(t('help.cacheFeed.fetch')),
      t('help.cacheFeed.fetchFeedUrl'),
    )
      .option('--no-p2p', t('help.cacheFeed.fetchNoP2p'))
      .option('--no-seed', t('help.cacheFeed.fetchNoSeed')),
    t('help.cacheFeed.torrentPort'),
  )
    .option('--force', t('help.cacheFeed.fetchForce'), false)
    .option('--refresh <interval>', t('help.cacheFeed.fetchRefresh'), parseRefreshCadence)
    .action(async (options: CacheFeedFetchCommandOptions) => {
      const feedUrl = resolveFeedUrl(options.url)
      const client = createCacheFeedClient({
        url: feedUrl,
        p2p: options.p2p,
        ...(options.torrentPort !== undefined ? { torrentPort: options.torrentPort } : {}),
      })

      log(t('cli.cacheFeed.syncing', { url: feedUrl }))
      let result: FeedSyncResult
      try {
        result = await client.sync({ force: options.force })
      } catch (e) {
        console.error(
          `${CACHE_FEED_LOG_PREFIX} ${t('cli.cacheFeed.syncFailed')}`,
          getErrorMessage(e),
        )
        await client.stop()
        process.exitCode = ExitCode.RuntimeError
        return
      }
      log(
        result.outcome === 'ingested' ? t('cli.cacheFeed.ingested') : t('cli.cacheFeed.unchanged'),
      )

      if (!options.seed) {
        await client.stop()
        return
      }

      // Sharing is caring: stay open and serve the artifacts back to the swarm.
      try {
        await client.seedAll(result.feed)
      } catch (e) {
        console.error(
          `${CACHE_FEED_LOG_PREFIX} ${t('cli.cacheFeed.seedStartFailed')}`,
          getErrorMessage(e),
        )
        await client.stop()
        process.exitCode = ExitCode.RuntimeError
        return
      }
      const port = client.torrentPortInUse()
      const seeded = client.seededCount()
      log(
        port
          ? t('cli.cacheFeed.seedingArtifactsOnPort', { count: seeded, port })
          : t('cli.cacheFeed.seedingArtifacts', { count: seeded }),
      )

      const refreshMs =
        resolveRefreshMs(options.refresh, 'RITUAL_CACHE_FEED_REFRESH') ?? DAY_REFRESH_MS
      const refreshTimer = scheduleRecurringTask(
        refreshMs,
        async () => {
          const next = await client.sync()
          if (next.outcome === 'ingested') {
            log(t('cli.cacheFeed.feedChanged'))
            await client.seedAll(next.feed)
          }
        },
        (error) =>
          console.error(
            `${CACHE_FEED_LOG_PREFIX} ${t('cli.cacheFeed.scheduledRecheckFailed')}`,
            error,
          ),
      )

      // Clearing the refresh timer and destroying the torrent client releases
      // every live handle, so the process exits naturally with code 0 — no
      // process.exit needed. `once` restores the default handler afterward, so
      // a second Ctrl+C force-quits if shutdown ever wedges.
      process.once('SIGINT', () => {
        void (async () => {
          log(t('cli.cacheFeed.stopping'))
          clearInterval(refreshTimer)
          await client.stop()
        })()
      })
    })
}
