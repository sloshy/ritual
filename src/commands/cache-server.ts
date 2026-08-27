import type { Command } from 'commander'
import {
  addFeedUrlOption,
  addTorrentPortOption,
  feedUrlSourceConflict,
  parseCacheSourceFlag,
  parseRefreshCadence,
} from '../cache-server/cadence'
import { runCacheServer } from '../cache-server/server'
import type { CacheServerCommandOptions } from '../cache-server/types'
import { t } from '../i18n/t'
import { ExitCode } from '../util/errors'
import { parsePort } from '../cli/options'

/** Wire `cache server` under the parent `cache` command. */
export function registerCacheServerSubcommand(cache: Command): void {
  addTorrentPortOption(
    addFeedUrlOption(
      cache
        .command('server')
        .description(t('help.cacheServer.description'))
        .option('-p, --port <number>', t('help.cacheServer.port'), parsePort, 4000)
        .option('--host <hostname>', t('help.cacheServer.host'), '127.0.0.1')
        .option(
          '--cards-refresh <interval>',
          t('help.cacheServer.cardsRefresh'),
          parseRefreshCadence,
        )
        .option(
          '--prices-refresh <interval>',
          t('help.cacheServer.pricesRefresh'),
          parseRefreshCadence,
        )
        .option('--cache-source <source>', t('help.cacheServer.cacheSource'), parseCacheSourceFlag),
      t('help.cacheServer.feedUrl'),
    ),
    t('help.cacheServer.torrentPort'),
  )
    .option('--no-seed', t('help.cacheServer.noSeed'))
    .option('-v, --verbose', t('help.cacheServer.verbose'), false)
    .option('--deny-http', t('help.cacheServer.denyHttp'), false)
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
