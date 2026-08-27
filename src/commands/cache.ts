import { headlessPolicy } from '../cache/refresh'
import { Command } from 'commander'
import { searchAllPages, refreshTags } from '../scryfall'
import { refreshCardCache } from '../cache/refresh-source'
import { collectCacheStatus, type CacheStatusResult } from '../cache/status'
import {
  addFeedUrlOption,
  feedUrlSourceConflict,
  parseCacheSourceFlag,
} from '../cache-server/cadence'
import { ensureCardKingdomFeed } from '../cardkingdom'
import { getErrorMessage, ExitCode } from '../util/errors'
import { getSiteSellMode, type CacheSource as ConfiguredCacheSource } from '../config/ritual-config'
import { registerCacheFeedSubcommand } from './cache-feed'
import { registerCacheServerSubcommand } from './cache-server'
import { addOutputOption } from '../cli/options'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'
import { t } from '../i18n/t'
import { displayWidth, padEndDisplay } from '../i18n/width'

/** Flags for `cache preload-all`. */
type CachePreloadAllOptions = {
  /** Override the configured `cacheSource` for this run. */
  source?: ConfiguredCacheSource
  /** Feed URL override — implies `--source feed`. */
  url?: string
  /** Re-download and re-ingest even when the feed is unchanged. */
  force: boolean
}

/** One `label: value` row of the text report. */
type StatusRow = { label: string; value: string }

function formatCacheStatusText(status: CacheStatusResult): string {
  const rows: StatusRow[] = [
    { label: t('cli.cache.rowEmpty'), value: String(status.empty) },
    { label: t('cli.cache.rowCardNames'), value: String(status.cardCount) },
    {
      label: t('cli.cache.rowLastCardRefresh'),
      value: status.lastCardRefresh ?? t('cli.cache.valueNever'),
    },
    {
      label: t('cli.cache.rowPriceAgeHours'),
      value:
        status.priceAgeHours === null
          ? t('cli.cache.valueNotApplicable')
          : String(status.priceAgeHours),
    },
    { label: t('cli.cache.rowPricesStale'), value: String(status.priceStale) },
    { label: t('cli.cache.rowTagsPresent'), value: String(status.tagsPresent) },
    { label: t('cli.cache.rowSource'), value: status.source },
    { label: t('cli.cache.rowDefaultLanguage'), value: status.defaultLanguage },
    {
      label: t('cli.cache.rowCardBulk'),
      value: status.cardBulkType ?? t('cli.cache.valueUnrecorded'),
    },
    { label: t('cli.cache.rowBulkStale'), value: String(status.bulkTypeStale) },
  ]
  // Display columns, not code units: a label is ASCII today, but padding is a
  // terminal-width problem and `padEnd` gets it wrong the moment one is not.
  const width = Math.max(...rows.map((row) => displayWidth(row.label))) + 1
  return rows.map((row) => `${padEndDisplay(`${row.label}:`, width)} ${row.value}`).join('\n')
}

export function registerCacheCommand(program: Command): void {
  const cache = program.command('cache').description(t('help.cache.description'))

  // `--output` only: the status report *is* the command's output, so there is
  // no non-essential chatter for `--quiet` to suppress.
  addOutputOption(cache.command('status').description(t('help.cache.status'))).action(
    async (options: Partial<ScriptingOptions>) => {
      const scripting = normalizeScriptingOptions(options, 'text')
      const status = await collectCacheStatus()
      // Always exit 0 — an empty cache is a reportable state, not a failure;
      // scripts branch on the `empty` field.
      if (scripting.output === 'text') {
        emitOutput(formatCacheStatusText(status), scripting)
        return
      }
      emitOutput(status, scripting)
    },
  )

  cache
    .command('preload-set')
    .description(t('help.cache.preloadSet'))
    .argument('<setCode>', t('help.cache.preloadSetArg'))
    .action(async (setCode: string) => {
      const normalizedSetCode = setCode.toLowerCase()
      const displayCode = normalizedSetCode.toUpperCase()
      console.log(t('cli.cache.preloadingSet', { set: displayCode }))
      try {
        // A set is preloaded whole (every result page), and an HTTP failure
        // comes back as data instead of an empty list, so a typo'd set code and
        // a dead network are no longer both reported as success.
        const result = await searchAllPages(`set:${normalizedSetCode}`)
        if (result.kind === 'failed') {
          console.error(
            t('cli.cache.preloadSetFailed', { set: displayCode, reason: result.message }),
          )
          process.exitCode = ExitCode.RuntimeError
          return
        }
        if (result.matched === 0) {
          // Scryfall answers an unknown set code with "nothing matched"; there is
          // no such thing as a real, empty set.
          console.error(t('cli.cache.preloadSetNotFound', { set: displayCode }))
          process.exitCode = ExitCode.NotFound
          return
        }
        if (result.cards.length === 0) {
          // The set exists but holds nothing cacheable — a token or Art Series
          // set, which `cacheRealPrintings` filters out. Not a typo, so not a
          // NotFound: the user asked for a real set and got an honest answer.
          console.log(
            t('cli.cache.preloadSetNoPrintings', {
              set: displayCode,
              counted: t('domain.count.items', { count: result.matched }),
            }),
          )
          return
        }
        console.log(t('cli.cache.preloadSetDone', { count: result.cards.length, set: displayCode }))
      } catch (e) {
        console.error(
          t('cli.cache.preloadSetFailed', { set: displayCode, reason: getErrorMessage(e) }),
        )
        process.exitCode = ExitCode.RuntimeError
      }
    })

  addFeedUrlOption(
    cache
      .command('preload-all')
      .description(t('help.cache.preloadAll'))
      .option('--source <source>', t('help.cache.preloadAllSource'), parseCacheSourceFlag),
    t('help.cache.preloadAllFeedUrl'),
  )
    .option('--force', t('help.cache.preloadAllForce'), false)
    .action(async (options: CachePreloadAllOptions) => {
      const conflict = feedUrlSourceConflict(options.source, options.url)
      if (conflict !== undefined) {
        console.error(conflict)
        process.exitCode = ExitCode.UsageError
        return
      }
      try {
        await refreshCardCache({
          ...(options.source !== undefined ? { source: options.source } : {}),
          ...(options.url !== undefined ? { url: options.url } : {}),
          force: options.force,
        })
      } catch (e) {
        console.error(t('cli.cache.preloadAllFailed', { reason: getErrorMessage(e) }))
        process.exitCode = ExitCode.RuntimeError
        return
      }

      // Updating the caches updates *every* cache the workspace uses, and under
      // sell mode the Card Kingdom buylist is one of them — a site built from a
      // day-old feed bakes yesterday's offers. `auto` because reaching this line
      // is already consent to bulk downloads, and `--force` carries through so
      // it redownloads a feed that is merely fresh.
      //
      // Config-only, with no `--sell-mode` flag of its own: this is cache
      // maintenance, not a surface that offers sell mode. A failure is a
      // warning, never the command's exit code — the card cache did refresh.
      if (getSiteSellMode()) {
        try {
          const feed = await ensureCardKingdomFeed(headlessPolicy('auto'), { force: options.force })
          if (typeof feed === 'string') {
            console.warn(t('cli.cache.preloadAllBuylistFailed', { reason: feed }))
          }
        } catch (e) {
          console.warn(t('cli.cache.preloadAllBuylistFailed', { reason: getErrorMessage(e) }))
        }
      }
    })

  cache
    .command('refresh-tags')
    .description(t('help.cache.refreshTags'))
    .action(async () => {
      try {
        await refreshTags()
      } catch (e) {
        console.error(t('cli.cache.refreshTagsFailed', { reason: getErrorMessage(e) }))
        process.exitCode = ExitCode.RuntimeError
      }
    })

  registerCacheServerSubcommand(cache)
  registerCacheFeedSubcommand(cache)
}
