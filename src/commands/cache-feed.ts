import path from 'node:path'
import { Command } from 'commander'
import { getCacheDir } from '../cache'
import { defaultHttpClient } from '../http'
import { getErrorMessage } from '../errors'
import {
  parsePort,
  parseRefreshCadence,
  resolveRefreshMs,
  scheduleRecurringTask,
} from '../cache-server/cadence'
import type { RefreshCadence } from '../cache-server/types'
import { CACHE_FEED_LOG_PREFIX, CacheFeedHost, DEFAULT_BULK_API_URL } from '../cache-feed/host'
import { FeedSeeder } from '../cache-feed/seeder'
import { FEED_FILENAME } from '../cache-feed/feed'

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
          process.exit(1)
        }
        log(`Refresh failed (${getErrorMessage(e)}); serving the existing feed.`)
      }

      let seeder: FeedSeeder | null = null
      if (options.seed) {
        seeder = new FeedSeeder({
          filesDir: host.filesDir,
          ...(options.torrentPort !== undefined ? { torrentPort: options.torrentPort } : {}),
        })
        await seeder.start()
        await seeder.sync(await host.torrentFiles())
        const port = seeder.port()
        log(`Seeding ${seeder.stats().torrents} torrents${port ? ` on TCP port ${port}` : ''}.`)
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

      log(`Feed server listening on http://${options.host}:${options.port}/${FEED_FILENAME}`)
      log(`Public URL: ${publicUrl}`)
      if (!options.seed) {
        log('BitTorrent seeding disabled (--no-seed); serving over HTTP only.')
      }
    })
}
