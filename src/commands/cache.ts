import { Command } from 'commander'
import { searchCards, refreshTags } from '../scryfall'
import { refreshCardCache } from '../cache/refresh-source'
import { cardCache, PRICE_MAX_AGE_MS } from '../cache'
import { getConfiguredCacheServerAddress } from '../cache/config'
import { addFeedUrlOption, feedUrlSourceConflict, parseCacheSourceFlag } from '../cache/cadence'
import { getErrorMessage } from '../errors'
import { type CacheSource as ConfiguredCacheSource } from '../ritual-config'
import { registerCacheFeedSubcommand } from './cache-feed'
import { registerCacheServerSubcommand } from './cache-server'
import {
  addScriptingOptions,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

/** Where card data is being read from: the on-disk cache or a configured cache server. */
type CacheSource = 'local' | 'cache-server'

/** Flags for `cache preload-all`. */
type CachePreloadAllOptions = {
  /** Override the configured `cacheSource` for this run. */
  source?: ConfiguredCacheSource
  /** Feed URL override — implies `--source feed`. */
  url?: string
  /** Re-download and re-ingest even when the feed is unchanged. */
  force: boolean
}

/** The `cache status` report. Diagnostic only — collecting it never mutates the cache. */
type CacheStatusResult = {
  /** Whether the card cache holds no cards at all. */
  empty: boolean
  /** Distinct card **names** cached — each name's value is its array of printings. */
  cardCount: number
  /**
   * ISO-8601 time of the last bulk refresh, or null until one has run — only a
   * bulk load stamps the timestamp, so per-set/per-card lookups leave it null.
   */
  lastCardRefresh: string | null
  /** Whole hours since the last bulk refresh (prices ride in the bulk data), or null. */
  priceAgeHours: number | null
  /** True when prices are older than the 24h freshness convention, or their age is unknown. */
  priceStale: boolean
  /** Whether any sampled cached card carries oracle/art tags (bounded sample, not a scan). */
  tagsPresent: boolean
  source: CacheSource
}

const ONE_HOUR_MS = 60 * 60 * 1000
const TAG_SAMPLE_SIZE = 25

/**
 * Whether any cached card carries `oracleTags`/`artTags`, checked via `get()`
 * over a bounded sample of at most {@link TAG_SAMPLE_SIZE} keys. Deliberately
 * never `values()`: with `--cache-server` active that would pull the entire
 * cache over HTTP for a yes/no answer.
 */
async function sampleTagsPresent(keys: string[]): Promise<boolean> {
  for (const key of keys.slice(0, TAG_SAMPLE_SIZE)) {
    const printings = await cardCache.get(key)
    if (!printings) continue
    const tagged = printings.some(
      (card) => (card.oracleTags?.length ?? 0) > 0 || (card.artTags?.length ?? 0) > 0,
    )
    if (tagged) return true
  }
  return false
}

async function collectCacheStatus(): Promise<CacheStatusResult> {
  const empty = await cardCache.isEmpty()
  const keys = await cardCache.keys()
  const lastRefreshedAt = await cardCache.getLastRefreshedAt()
  const priceAgeMs = lastRefreshedAt === null ? null : Date.now() - lastRefreshedAt

  return {
    empty,
    cardCount: keys.length,
    lastCardRefresh: lastRefreshedAt === null ? null : new Date(lastRefreshedAt).toISOString(),
    priceAgeHours: priceAgeMs === null ? null : Math.floor(priceAgeMs / ONE_HOUR_MS),
    priceStale: priceAgeMs === null || priceAgeMs > PRICE_MAX_AGE_MS,
    tagsPresent: await sampleTagsPresent(keys),
    source: getConfiguredCacheServerAddress() ? 'cache-server' : 'local',
  }
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
  ]
  const width = Math.max(...rows.map((row) => row.label.length)) + 1
  return rows.map((row) => `${`${row.label}:`.padEnd(width)} ${row.value}`).join('\n')
}

export function registerCacheCommand(program: Command): void {
  const cache = program.command('cache').description('Manage card cache')

  addScriptingOptions(
    cache
      .command('status')
      .description(
        'Report card-cache state (size, freshness, tags, source) without prompting or refreshing',
      ),
    'text',
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
      console.log(`Preloading set '${normalizedSetCode.toUpperCase()}'...`)
      try {
        const query = `set:${normalizedSetCode}`
        const cards = await searchCards(query)
        console.log(
          `Successfully cached ${cards.length} cards for set '${normalizedSetCode.toUpperCase()}'`,
        )
      } catch (e) {
        console.error('Failed to preload set:', e instanceof Error ? e.message : e)
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
