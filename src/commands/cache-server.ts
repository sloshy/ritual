import { type Command } from 'commander'
import {
  addFeedUrlOption,
  addTorrentPortOption,
  feedUrlSourceConflict,
  parseCacheSourceFlag,
  parseRefreshCadence,
} from '../cache/cadence'
import { runCacheServer } from '../cache-server/server'
import { type CacheServerCommandOptions } from '../cache-server/types'
import { ExitCode, parsePort } from './scripting'

/** Wire `cache server` under the parent `cache` command. */
export function registerCacheServerSubcommand(cache: Command): void {
  addTorrentPortOption(
    addFeedUrlOption(
      cache
        .command('server')
        .description('Start a local cache server for card and pricing data')
        .option('-p, --port <number>', 'Port for the cache server', parsePort, 4000)
        .option('--host <hostname>', 'Host interface for the cache server', '127.0.0.1')
        .option(
          '--cards-refresh <interval>',
          "Run full cards cache refresh on an interval (supported: 'daily', 'weekly', 'monthly')",
          parseRefreshCadence,
        )
        .option(
          '--prices-refresh <interval>',
          "Run prices cache refresh on an interval (supported: 'daily', 'weekly', 'monthly')",
          parseRefreshCadence,
        )
        .option(
          '--cache-source <source>',
          "Where card refreshes download from: 'scryfall' or 'feed' (defaults to the cacheSource config key)",
          parseCacheSourceFlag,
        ),
      'Cache feed URL for feed-sourced refreshes (defaults to the cacheFeedUrl config key)',
    ),
    'Fixed TCP port for incoming torrent peers while seeding feed artifacts',
  )
    .option('--no-seed', 'With a feed source, sync without seeding the artifacts back to the swarm')
    .option('-v, --verbose', 'Log every cache-server request', false)
    .option(
      '--deny-http',
      'Reject all outgoing HTTP requests (for testing with pre-populated caches)',
      false,
    )
    .action(async (options: CacheServerCommandOptions) => {
      const conflict = feedUrlSourceConflict(options.cacheSource, options.url)
      if (conflict !== undefined) {
        console.error(conflict)
        process.exitCode = ExitCode.UsageError
        return
      }
      await runCacheServer(options)
    })
}
