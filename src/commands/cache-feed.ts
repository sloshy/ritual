import path from 'node:path'
import { Command } from 'commander'
import { getCacheDir } from '../cache'
import { defaultHttpClient } from '../http'
import { getErrorMessage } from '../errors'
import {
  parseFeedUrlFlag,
  parseRefreshCadence,
  resolveRefreshMs,
  scheduleRecurringTask,
} from '../cache-server/cadence'
import { ExitCode, parsePort } from './scripting'
import type { RefreshCadence } from '../cache-server/types'
import { CACHE_FEED_LOG_PREFIX, CacheFeedHost, DEFAULT_BULK_API_URL } from '../cache-feed/host'
import { FeedSeeder } from '../cache-feed/seeder'
import { FEED_FILENAME } from '../cache-feed/feed'
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
}

const DAILY_MS = 24 * 60 * 60 * 1000

function log(message: string): void {
  console.log(`${CACHE_FEED_LOG_PREFIX} ${message}`)
}

export function registerCacheFeedCommand(program: Command): void {
  const cacheFeed = program
    .command('cache-feed')
    .description('Share Scryfall bulk cache data peer-to-peer')

  cacheFeed
    .command('host')
    .description(
      'Host a cache feed: download the raw Scryfall bulk files, torrent them, ' +
        'and serve + seed them for other ritual clients',
    )
    .option('-p, --port <number>', 'Port for the feed HTTP server', parsePort, 4010)
    .option('--host <hostname>', 'Host interface for the feed HTTP server', '127.0.0.1')
    .option(
      '--public-url <url>',
      'Public base URL peers reach this host at (embedded in the feed and web-seed URLs; ' +
        'defaults to http://<host>:<port>)',
    )
    .option(
      '--refresh <interval>',
      "Re-check Scryfall for new bulk data on an interval (supported: 'daily', 'weekly', " +
        "'monthly'; falls back to RITUAL_CACHE_FEED_REFRESH, then 'daily')",
      parseRefreshCadence,
    )
    .option('--upstream <url>', 'Bulk manifest URL to source artifacts from', DEFAULT_BULK_API_URL)
    .option('--dir <path>', 'Feed data directory (defaults to <cache>/feed)')
    .option('--no-seed', 'Serve the feed and files over HTTP only, without BitTorrent seeding')
    .option('--torrent-port <number>', 'Fixed TCP port for incoming torrent peers', parsePort)
    .option('-v, --verbose', 'Log every feed-server request', false)
    .action(async (options: CacheFeedHostCommandOptions) => {
      const feedDir = options.dir ?? path.join(getCacheDir(), 'feed')
      const publicUrl = options.publicUrl ?? `http://${options.host}:${options.port}`

      const host = new CacheFeedHost({
        feedDir,
        publicUrl,
        bulkApiUrl: options.upstream,
        http: defaultHttpClient,
      })

      await host.loadExistingFeed()
      try {
        await host.refresh()
      } catch (e) {
        if (!host.currentFeed()) {
          console.error(`${CACHE_FEED_LOG_PREFIX} Initial feed generation failed:`, e)
          process.exitCode = ExitCode.RuntimeError
          return
        }
        log(`Refresh failed (${getErrorMessage(e)}); serving the existing feed.`)
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
          console.error(`${CACHE_FEED_LOG_PREFIX} Failed to start seeding:`, getErrorMessage(e))
          // Destroy the torrent client so no live handle keeps the process open.
          await seeder.stop()
          process.exitCode = ExitCode.RuntimeError
          return
        }
        const port = seeder.port()
        log(`Seeding ${seeder.stats().torrents} torrents${port ? ` on TCP port ${port}` : ''}.`)
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
          `${CACHE_FEED_LOG_PREFIX} Failed to start the feed server:`,
          getErrorMessage(e),
        )
        if (seeder) await seeder.stop()
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const refreshMs = resolveRefreshMs(options.refresh, 'RITUAL_CACHE_FEED_REFRESH') ?? DAILY_MS
      scheduleRecurringTask(
        refreshMs,
        async () => {
          const changed = await host.refresh()
          if (changed && seeder) {
            await seeder.sync(await host.torrentFiles())
          }
        },
        (error) => console.error(`${CACHE_FEED_LOG_PREFIX} Scheduled feed refresh failed:`, error),
      )

      log(`Feed server listening on http://${options.host}:${options.port}/${FEED_FILENAME}`)
      log(`Public URL: ${publicUrl}`)
      if (!options.seed) {
        log('BitTorrent seeding disabled (--no-seed); serving over HTTP only.')
      }
    })

  cacheFeed
    .command('fetch')
    .description(
      'Sync the card cache from a cache feed, then stay open seeding the ' +
        'artifacts to other peers (Ctrl+C to stop)',
    )
    .option(
      '--url <feedUrl>',
      'Feed URL (defaults to the cacheFeedUrl config key, then the built-in default)',
      parseFeedUrlFlag,
    )
    .option('--no-p2p', 'Download over plain HTTP instead of BitTorrent')
    .option('--no-seed', 'Exit after ingesting instead of staying open to seed')
    .option('--torrent-port <number>', 'Fixed TCP port for incoming torrent peers', parsePort)
    .option('--force', 'Re-download and re-ingest even when the feed is unchanged', false)
    .option(
      '--refresh <interval>',
      "Re-check the feed while seeding (supported: 'daily', 'weekly', 'monthly'; " +
        "falls back to RITUAL_CACHE_FEED_REFRESH, then 'daily')",
      parseRefreshCadence,
    )
    .action(async (options: CacheFeedFetchCommandOptions) => {
      const feedUrl = resolveFeedUrl(options.url)
      const client = createCacheFeedClient({
        url: feedUrl,
        p2p: options.p2p,
        ...(options.torrentPort !== undefined ? { torrentPort: options.torrentPort } : {}),
      })

      log(`Syncing from ${feedUrl}`)
      let result: FeedSyncResult
      try {
        result = await client.sync({ force: options.force })
      } catch (e) {
        console.error(`${CACHE_FEED_LOG_PREFIX} Feed sync failed:`, getErrorMessage(e))
        await client.stop()
        process.exitCode = ExitCode.RuntimeError
        return
      }
      log(
        result.outcome === 'ingested'
          ? 'Card cache updated from the feed.'
          : 'Feed is unchanged; card cache is already current.',
      )

      if (!options.seed) {
        await client.stop()
        return
      }

      // Sharing is caring: stay open and serve the artifacts back to the swarm.
      try {
        await client.seedAll(result.feed)
      } catch (e) {
        console.error(`${CACHE_FEED_LOG_PREFIX} Failed to start seeding:`, getErrorMessage(e))
        await client.stop()
        process.exitCode = ExitCode.RuntimeError
        return
      }
      const port = client.torrentPortInUse()
      log(
        `Seeding ${result.feed.entries.length} artifacts${port ? ` on TCP port ${port}` : ''}. ` +
          'Press Ctrl+C to stop.',
      )

      const refreshMs = resolveRefreshMs(options.refresh, 'RITUAL_CACHE_FEED_REFRESH') ?? DAILY_MS
      const refreshTimer = scheduleRecurringTask(
        refreshMs,
        async () => {
          const next = await client.sync()
          if (next.outcome === 'ingested') {
            log('Feed changed; card cache updated.')
            await client.seedAll(next.feed)
          }
        },
        (error) => console.error(`${CACHE_FEED_LOG_PREFIX} Scheduled feed re-check failed:`, error),
      )

      // Clearing the refresh timer and destroying the torrent client releases
      // every live handle, so the process exits naturally with code 0 — no
      // process.exit needed. `once` restores the default handler afterward, so
      // a second Ctrl+C force-quits if shutdown ever wedges.
      process.once('SIGINT', () => {
        void (async () => {
          log('Stopping seeding...')
          clearInterval(refreshTimer)
          await client.stop()
        })()
      })
    })
}
