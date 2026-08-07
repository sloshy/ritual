import { Command } from 'commander'
import { searchAllPages, refreshTags } from '../scryfall'
import { refreshCardCache } from '../cache/refresh-source'
import { collectCacheStatus, type CacheStatusResult } from '../cache/status'
import { addFeedUrlOption, feedUrlSourceConflict, parseCacheSourceFlag } from '../cache/cadence'
import { getErrorMessage } from '../errors'
import { type CacheSource as ConfiguredCacheSource } from '../ritual-config'
import { registerCacheFeedSubcommand } from './cache-feed'
import { registerCacheServerSubcommand } from './cache-server'
import {
  addOutputOption,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

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
    { label: 'Empty', value: String(status.empty) },
    { label: 'Card names', value: String(status.cardCount) },
    { label: 'Last card refresh', value: status.lastCardRefresh ?? 'never' },
    {
      label: 'Price age (hours)',
      value: status.priceAgeHours === null ? 'n/a' : String(status.priceAgeHours),
    },
    { label: 'Prices stale', value: String(status.priceStale) },
    { label: 'Tags present', value: String(status.tagsPresent) },
    { label: 'Source', value: status.source },
    { label: 'Default language', value: status.defaultLanguage },
    { label: 'Card bulk', value: status.cardBulkType ?? 'unrecorded' },
    { label: 'Bulk stale', value: String(status.bulkTypeStale) },
  ]
  const width = Math.max(...rows.map((row) => row.label.length)) + 1
  return rows.map((row) => `${`${row.label}:`.padEnd(width)} ${row.value}`).join('\n')
}

export function registerCacheCommand(program: Command): void {
  const cache = program.command('cache').description('Manage card cache')

  // `--output` only: the status report *is* the command's output, so there is
  // no non-essential chatter for `--quiet` to suppress.
  addOutputOption(
    cache
      .command('status')
      .description(
        'Report card-cache state (size, freshness, tags, source, card bulk / language mode) without prompting or refreshing',
      ),
  ).action(async (options: Partial<ScriptingOptions>) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    const status = await collectCacheStatus()
    // Always exit 0 — an empty cache is a reportable state, not a failure;
    // scripts branch on the `empty` field.
    if (scripting.output === 'text') {
      emitOutput(formatCacheStatusText(status), scripting)
      return
    }
    emitOutput(status, scripting)
  })

  cache
    .command('preload-set')
    .description('Download and cache all cards for a given set')
    .argument('<setCode>', 'Set code to preload (e.g. khm, lea)')
    .action(async (setCode: string) => {
      const normalizedSetCode = setCode.toLowerCase()
      const displayCode = normalizedSetCode.toUpperCase()
      console.log(`Preloading set '${displayCode}'...`)
      try {
        // A set is preloaded whole (every result page), and an HTTP failure
        // comes back as data instead of an empty list, so a typo'd set code and
        // a dead network are no longer both reported as success.
        const result = await searchAllPages(`set:${normalizedSetCode}`)
        if (result.kind === 'failed') {
          console.error(`Failed to preload set '${displayCode}': ${result.message}`)
          process.exitCode = ExitCode.RuntimeError
          return
        }
        if (result.matched === 0) {
          // Scryfall answers an unknown set code with "nothing matched"; there is
          // no such thing as a real, empty set.
          console.error(
            `No cards found for set '${displayCode}' — check the set code (see https://scryfall.com/sets).`,
          )
          process.exitCode = ExitCode.NotFound
          return
        }
        if (result.cards.length === 0) {
          // The set exists but holds nothing cacheable — a token or Art Series
          // set, which `cacheRealPrintings` filters out. Not a typo, so not a
          // NotFound: the user asked for a real set and got an honest answer.
          console.log(
            `Set '${displayCode}' matched ${result.matched} item${result.matched === 1 ? '' : 's'}, none of which are real printings ` +
              '(token and Art Series sets are not cached).',
          )
          return
        }
        console.log(`Successfully cached ${result.cards.length} cards for set '${displayCode}'`)
      } catch (e) {
        console.error(`Failed to preload set '${displayCode}':`, getErrorMessage(e))
        process.exitCode = ExitCode.RuntimeError
      }
    })

  addFeedUrlOption(
    cache
      .command('preload-all')
      .description(
        'Download and cache all Scryfall card data (bulk), including oracle and art tags',
      )
      .option(
        '--source <source>',
        "Where to download from: 'scryfall' or 'feed' (overrides the cacheSource config key for this run)",
        parseCacheSourceFlag,
      ),
    'Feed URL for a feed-sourced refresh (implies --source feed; defaults to the cacheFeedUrl config key)',
  )
    .option('--force', 'Re-download and re-ingest even when the feed is unchanged', false)
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
        console.error('Failed to preload card cache:', getErrorMessage(e))
        process.exitCode = ExitCode.RuntimeError
      }
    })

  cache
    .command('refresh-tags')
    .description(
      'Re-download oracle and art tag bulks and re-attach them to cached cards (no full card re-download)',
    )
    .action(async () => {
      try {
        await refreshTags()
      } catch (e) {
        console.error('Failed to refresh tags:', getErrorMessage(e))
        process.exitCode = ExitCode.RuntimeError
      }
    })

  registerCacheServerSubcommand(cache)
  registerCacheFeedSubcommand(cache)
}
