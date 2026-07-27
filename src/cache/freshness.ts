import { cardCache } from './index'
import { refreshCardCache } from './refresh-source'
import { BULK_CACHE_MAX_AGE_MS, PRICE_MAX_AGE_MS } from './constants'
import { shouldBulkRefresh, type BulkRefreshPrompt, type RefreshMode } from '../refresh'
import { formatDuration } from '../utils'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * The standard remedy line for an unusable (empty) card cache, appended to a
 * caller-specific lead-in so every command surfaces the same advice.
 */
export function emptyCacheAdvice(lead: string): string {
  return `${lead} Run \`ritual cache preload-all\` first, or re-run with --refresh auto to download it.`
}

type CacheFreshnessResult = {
  ready: boolean
  cardCount: number
}

/**
 * Prompt to redownload a bulk cache that is older than a week, preloading when
 * the prompt is accepted. Does nothing when the cache is younger than a week.
 */
async function promptStaleCacheRefresh(
  age: number,
  confirm: (prompt: BulkRefreshPrompt) => Promise<boolean>,
  preload: () => Promise<void>,
): Promise<void> {
  if (age <= BULK_CACHE_MAX_AGE_MS) return
  const days = Math.floor(age / ONE_DAY_MS)
  const accepted = await confirm({
    message: `Card cache is ${days} day${days !== 1 ? 's' : ''} old. Would you like to update it?`,
    initial: false,
  })
  if (accepted) await preload()
}

/**
 * Ensure the card cache exists and has been refreshed within the past 7 days.
 *
 * - If the cache is empty, offers to run a preload (empty-cache confirm
 *   defaults to yes on a TTY; with prompts unavailable it never downloads and
 *   returns `ready: false` instead).
 * - If the cache exists but is older than 7 days, offers to update (default no).
 * - If the cache is fresh, proceeds silently.
 *
 * @param mode The `--refresh` policy; the cache here is populated only by bulk
 *   download, so `no-bulk` behaves like `never` (no preload).
 * @returns Whether the cache is ready for use (has cards) and how many cards are available.
 */
export async function ensureFreshCardCache(
  mode: RefreshMode = 'ask',
): Promise<CacheFreshnessResult> {
  const empty = await cardCache.isEmpty()

  if (empty) {
    console.log('Card cache is empty. A preloaded cache is required for card autocomplete.')
    const shouldPreload = await shouldBulkRefresh(mode, {
      message: 'Would you like to download the card database now?',
      initial: true,
    })

    if (shouldPreload) {
      await refreshCardCache()
    } else {
      return { ready: false, cardCount: 0 }
    }
  } else {
    const lastRefreshed = await cardCache.getLastRefreshedAt()

    if (lastRefreshed !== null) {
      await promptStaleCacheRefresh(
        Date.now() - lastRefreshed,
        (prompt) => shouldBulkRefresh(mode, prompt),
        refreshCardCache,
      )
    }
  }

  const keys = await cardCache.keys()
  return { ready: keys.length > 0, cardCount: keys.length }
}

/** The slice of the card cache that {@link refreshCardCacheForSession} reads. */
export type SessionCardCache = {
  isEmpty(): Promise<boolean>
  getLastRefreshedAt(): Promise<number | null>
}

/** Injectable dependencies for {@link refreshCardCacheForSession}. */
export type SessionCacheDeps = {
  cache?: SessionCardCache
  preload?: () => Promise<void>
  confirmStaleRefresh?: (prompt: BulkRefreshPrompt) => Promise<boolean>
}

/**
 * Apply the `--refresh` freshness policy before an interactive card-entry
 * session starts.
 *
 * - Under `auto`, redownloads the bulk cache when its prices are more than a
 *   day old (prices ride along inside the cached cards, so a redownload is how
 *   they are refreshed).
 * - Under `ask`, prompts to update a bulk cache older than a week.
 * - `no-bulk` and `never` leave the cache alone — the only refresh path here is
 *   a bulk download.
 *
 * An empty cache is left untouched here — the commands surface that separately
 * via their own preload warning.
 */
export async function refreshCardCacheForSession(
  mode: RefreshMode,
  deps: SessionCacheDeps = {},
): Promise<void> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? refreshCardCache
  const confirmStaleRefresh =
    deps.confirmStaleRefresh ?? ((prompt) => shouldBulkRefresh(mode, prompt))

  if (await cache.isEmpty()) return

  const lastRefreshed = await cache.getLastRefreshedAt()
  if (lastRefreshed === null) return
  const age = Date.now() - lastRefreshed

  if (mode === 'auto' && age > PRICE_MAX_AGE_MS) {
    console.log('Cached prices are more than a day old. Refreshing the card cache from Scryfall...')
    await preload()
    return
  }

  if (mode !== 'ask') return
  await promptStaleCacheRefresh(age, confirmStaleRefresh, preload)
}

/**
 * Report a refresh this gate is performing. Defaults to the console; callers with
 * a run log of their own (a sync's event stream) pass their own sink.
 */
export type CacheRefreshLog = (message: string) => void

/** Injectable dependencies for {@link ensureCardCacheForUpload}. */
export type UploadCacheDeps = SessionCacheDeps & { log?: CacheRefreshLog }

/**
 * Ensure the card cache is fresh enough to build a bulk upload's rows from.
 *
 * A collection push's CSV keys every row by the Scryfall id the **local cache**
 * holds for that printing, so a cache that is empty or a day out of date means
 * rows that silently go missing — and the additions they carried falling back to
 * one paced Archidekt search each, which is the rate-limit trap the CSV path
 * exists to avoid. So freshness here is a requirement, not a suggestion:
 *
 * - `auto` refreshes an empty or day-old cache without asking.
 * - `ask` prompts, defaulting to **yes**; declining refuses the run.
 * - `no-bulk`/`never` refuse rather than upload from a cache they may not touch
 *   (the cache is only ever filled by a bulk download).
 *
 * A cache whose last refresh is unknown counts as fresh — the same reading
 * {@link refreshCardCacheForSession} takes, since "no timestamp" is a cache that
 * was filled by something other than a bulk download rather than an old one.
 *
 * @returns `true` when the cache may be used, else the reason it may not — worded
 *   for the caller to report verbatim.
 */
export async function ensureCardCacheForUpload(
  mode: RefreshMode,
  deps: UploadCacheDeps = {},
): Promise<true | string> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? refreshCardCache
  const confirmStaleRefresh =
    deps.confirmStaleRefresh ?? ((prompt) => shouldBulkRefresh(mode, prompt))
  const log = deps.log ?? ((message: string) => console.log(message))

  const empty = await cache.isEmpty()
  const lastRefreshed = empty ? null : await cache.getLastRefreshedAt()
  const age = lastRefreshed === null ? null : Date.now() - lastRefreshed
  if (!empty && (age === null || age <= PRICE_MAX_AGE_MS)) return true

  const state = empty ? 'empty' : `${formatDuration(age ?? 0)} old`
  const because = `Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is ${state}.`
  const remedy = 'Run `ritual cache preload-all`, or re-run with --refresh auto.'

  if (mode === 'auto') {
    log(`${because} Refreshing it from Scryfall first...`)
    await preload()
  } else if (mode === 'ask') {
    const accepted = await confirmStaleRefresh({
      message: `${because} Update it before uploading?`,
      initial: true,
    })
    // Declining is an answer, not a fall-through: uploading from this cache is
    // exactly what the freshness requirement forbids.
    if (!accepted) return `${because} ${remedy}`
    await preload()
  } else {
    // `no-bulk` and `never` forbid the only way this cache is ever filled.
    return `${because} ${remedy}`
  }

  if (await cache.isEmpty()) {
    return 'The card cache is still empty after a refresh, so no CSV row could be keyed by a Scryfall id.'
  }
  return true
}

/** Whether price data exists at all, and when it was last refreshed. */
export type PriceFreshnessResult = {
  ready: boolean
  lastRefreshedAt: number | null
}

/**
 * Ensure price data exists and is reasonably fresh before a pricing command
 * runs. Prices ride along inside the bulk card cache, so "refreshing prices"
 * means a bulk redownload.
 *
 * - An empty cache offers to download the card database (default yes on a TTY);
 *   declining returns `ready: false` since nothing can be priced. Under
 *   `no-bulk`/`never` (or `ask` with prompts unavailable) nothing is ever
 *   downloaded — the caller surfaces the `ready: false` error.
 * - Prices more than a day old are refreshed automatically under `auto`,
 *   prompted for under `ask` (default no), and left alone under
 *   `no-bulk`/`never`.
 */
export async function ensureFreshPriceData(
  mode: RefreshMode,
  deps: SessionCacheDeps = {},
): Promise<PriceFreshnessResult> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? refreshCardCache
  const confirmStaleRefresh =
    deps.confirmStaleRefresh ?? ((prompt) => shouldBulkRefresh(mode, prompt))

  if (await cache.isEmpty()) {
    // The cache can only be filled by a bulk download, so modes that forbid one
    // leave an empty cache simply unusable — never download, stay quiet.
    if (mode === 'no-bulk' || mode === 'never') return { ready: false, lastRefreshedAt: null }
    console.log('Card cache is empty. Pricing requires the Scryfall card database.')
    const accepted =
      mode === 'auto' ||
      (await confirmStaleRefresh({
        message: 'Would you like to download it now?',
        initial: true,
      }))
    if (!accepted) return { ready: false, lastRefreshedAt: null }
    await preload()
    return { ready: true, lastRefreshedAt: await cache.getLastRefreshedAt() }
  }

  const lastRefreshed = await cache.getLastRefreshedAt()
  if (lastRefreshed !== null) {
    const age = Date.now() - lastRefreshed
    if (age > PRICE_MAX_AGE_MS) {
      if (mode === 'auto') {
        console.log(
          'Cached prices are more than a day old. Refreshing the card cache from Scryfall...',
        )
        await preload()
      } else if (mode === 'ask') {
        const accepted = await confirmStaleRefresh({
          message: `Prices were last updated ${formatDuration(age)} ago. Update now?`,
          initial: false,
        })
        if (accepted) await preload()
      }
    }
  }
  return { ready: true, lastRefreshedAt: await cache.getLastRefreshedAt() }
}
