import { cardCache } from './index'
import { refreshCardCache } from './refresh-source'
import { readRecordedCardBulkType } from './bulk-provenance'
import { BULK_CACHE_MAX_AGE_MS, BULK_FETCH_THRESHOLD, PRICE_MAX_AGE_MS } from './constants'
import { bulkAllowed, decideBulkRefresh, type RefreshPolicy } from './refresh'
import { downloadTagIndex, refreshTags } from '../scryfall'
import { configuredCardBulkType, type CardBulkType } from '../scryfall/bulk-manifest'
import { getDefaultLanguage } from '../config/ritual-config'
import { numberFormat } from '../i18n/format'
import { currentLocale } from '../i18n/runtime'
import type { TagIndex } from '../scryfall/tags'
import type { CacheManager } from '../util/interfaces'
import type { ScryfallCard } from '../scryfall/types'
import { formatDuration } from '../util/duration'
import { getLogger } from '../util/logger'
import { t } from '../i18n/t'
import {
  errorParam,
  nestSync,
  renderSyncMessage,
  syncDuration,
  syncMessage,
  syncRef,
  type SyncMessage,
  type SyncMessageRef,
  type SyncText,
} from '../sync/message'
import { COMMAND, CONFIG_KEY, FLAG, commandLine, flagValue } from '../util/cli-tokens'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Run a bulk preload, reporting a cold network as a message instead of throwing.
 *
 * The message is held unrendered ({@link SyncMessage}): the CSV-upload gate
 * hands it to a sync report the admin API and MCP read in English, while the
 * console gates render it in the CLI's language.
 *
 * `refreshCardCache` propagates its failures now (that is the point of the
 * change — a refresh that did not happen must be learnable), but every gate in
 * this module is a *courtesy* refresh offered on the way to doing something
 * else. A download that fails has to leave the caller with the cache it already
 * had, not an exception out of `ritual admin`'s startup path. Callers that
 * report to the user print the message; {@link ensureCardCacheForUpload}, whose
 * whole contract is "ready, or the reason not", returns it.
 *
 * @returns `null` when the preload succeeded, else the reason it did not.
 */
async function tryPreload(preload: () => Promise<void>): Promise<SyncMessage | null> {
  try {
    await preload()
    return null
  } catch (e) {
    return syncMessage('domain.cache.downloadFailed', { error: errorParam(e) })
  }
}

/**
 * {@link tryPreload} for the callers that report to the user: the failure is
 * printed to stderr in the CLI's language, and the result says whether the
 * download happened.
 */
async function preloadOrReport(preload: () => Promise<void>): Promise<boolean> {
  const failure = await tryPreload(preload)
  if (failure !== null) console.error(renderSyncMessage(failure))
  return failure === null
}

/** The two ways to fill the card cache, as every empty-cache remedy names them. */
type RefreshRemedy = {
  command: string
  flag: string
}

/** The command that downloads the card cache, and the flag that lets a run do it. */
const REFRESH_REMEDY: RefreshRemedy = {
  command: commandLine(COMMAND.cachePreloadAll),
  flag: flagValue(FLAG.refresh, 'auto'),
}

/**
 * The standard remedy line for an unusable (empty) card cache, appended to a
 * caller-specific lead-in so every command surfaces the same advice.
 */
export function emptyCacheAdvice(lead: string): string {
  return t('cli.cacheGate.emptyAdvice', { lead, ...REFRESH_REMEDY })
}

type CacheFreshnessResult = {
  ready: boolean
  cardCount: number
}

/** The card cache was built from one bulk while the config now demands the other. */
export type BulkTypeMismatch = {
  /** What built the cache (an unrecorded, pre-provenance cache reads as `default_cards`). */
  recorded: CardBulkType
  /** What {@link configuredCardBulkType} demands now. */
  required: CardBulkType
}

/**
 * Whether the recorded card-bulk provenance disagrees with what the configured
 * `defaultLanguage` demands — e.g. a `default_cards` cache after the user set
 * `defaultLanguage: ja`. A mismatched cache needs a **full refresh**, not a
 * staleness top-up: the wrong bulk's data stays wrong no matter how fresh it
 * is. A missing provenance record reads as `default_cards` (every cache built
 * before provenance existed came from that bulk). Callers skip the check for
 * an empty cache — the empty-cache path already downloads the right bulk.
 */
export async function detectCardBulkTypeMismatch(): Promise<BulkTypeMismatch | null> {
  const required = configuredCardBulkType()
  const recorded = (await readRecordedCardBulkType()) ?? 'default_cards'
  return recorded === required ? null : { recorded, required }
}

/** One sentence saying what is mismatched and why, shared by every prompt that offers the fix. */
export function bulkTypeMismatchMessage(mismatch: BulkTypeMismatch): string {
  return t('cli.cacheGate.bulkMismatch', {
    required: mismatch.required,
    recorded: mismatch.recorded,
    language: getDefaultLanguage(), configKey: CONFIG_KEY.defaultLanguage,
  })
}

/** Test seam: how freshness gates detect a bulk-type mismatch. */
export type BulkTypeMismatchCheck = () => Promise<BulkTypeMismatch | null>

/**
 * Offer (or under `auto`, just run) the full redownload that fixes a bulk-type
 * mismatch. Returns whether the mismatch was **handled** — refreshed, refused,
 * or failed — in which case the caller must skip its ordinary staleness offer:
 * a second prompt about the same cache would either nag or contradict the
 * answer just given. `null` mismatch returns false (nothing to handle).
 *
 * @returns Whether a mismatch consumed this gate's refresh decision.
 */
async function handleBulkTypeMismatch(
  mismatch: BulkTypeMismatch | null,
  policy: RefreshPolicy,
  preload: () => Promise<void>,
): Promise<boolean> {
  if (mismatch === null) return false
  // The only fix is a bulk download; modes that forbid one leave the cache
  // as-is (the caller keeps working from the mismatched data, as `never`
  // promises), and the mismatch still consumed the decision — a staleness
  // refresh under `no-bulk` could not happen either.
  if (!bulkAllowed(policy.mode)) return true
  const reason = bulkTypeMismatchMessage(mismatch)
  const accepted = await decideBulkRefresh(policy, {
    message: t('cli.cacheGate.bulkMismatchConfirm', { reason }),
    initial: true,
  })
  if (!accepted) return true
  if (policy.mode === 'auto') {
    console.log(t('cli.cacheGate.bulkMismatchRefreshing', { reason }))
  }
  await preloadOrReport(preload)
  return true
}

/**
 * Prompt to redownload a bulk cache that is older than a week, preloading when
 * the prompt is accepted. Does nothing when the cache is younger than a week.
 *
 * @returns `null` when nothing failed (including when nothing was downloaded),
 *   else why the accepted download did not happen — see {@link tryPreload}.
 */
async function promptStaleCacheRefresh(
  age: number,
  policy: RefreshPolicy,
  preload: () => Promise<void>,
): Promise<SyncMessage | null> {
  if (age <= BULK_CACHE_MAX_AGE_MS) return null
  const days = Math.floor(age / ONE_DAY_MS)
  // Whole days, so `Intl`'s unit style says it without a hardcoded plural `s`.
  const dayCount = numberFormat(currentLocale(), {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long',
  }).format(days)
  const accepted = await decideBulkRefresh(policy, {
    message: t('cli.cacheGate.staleConfirm', { age: dayCount }),
    initial: false,
  })
  if (!accepted) return null
  return tryPreload(preload)
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
 * A non-empty cache built from the wrong bulk for the configured
 * `defaultLanguage` (see {@link detectCardBulkTypeMismatch}) is offered a full
 * redownload first — with that handled, the ordinary staleness offer is
 * skipped so one gate never asks twice.
 *
 * @param policy The `--refresh` policy; the cache here is populated only by bulk
 *   download, so `no-bulk` behaves like `never` (no preload).
 * @param deps Injectable seams (tests); the global cache and real refresh
 *   otherwise. `deps.cache` is deliberately unused here — this gate reports
 *   the global cache's card count.
 * @returns Whether the cache is ready for use (has cards) and how many cards are available.
 */
export async function ensureFreshCardCache(
  policy: RefreshPolicy,
  deps: SessionCacheDeps = {},
): Promise<CacheFreshnessResult> {
  const preload = deps.preload ?? refreshCardCache
  const detectMismatch = deps.detectMismatch ?? detectCardBulkTypeMismatch
  const empty = await cardCache.isEmpty()

  if (empty) {
    console.log(t('cli.cacheGate.emptyForAutocomplete'))
    const shouldPreload = await decideBulkRefresh(policy, {
      message: t('cli.cacheGate.downloadDatabaseConfirm'),
      initial: true,
    })

    if (shouldPreload) {
      // Best-effort warm: a cold network must leave the caller with an empty
      // cache rather than an exception — the `ready: false` below already says so.
      await preloadOrReport(preload)
    } else {
      return { ready: false, cardCount: 0 }
    }
  } else if (!(await handleBulkTypeMismatch(await detectMismatch(), policy, preload))) {
    const lastRefreshed = await cardCache.getLastRefreshedAt()

    if (lastRefreshed !== null) {
      const failure = await promptStaleCacheRefresh(Date.now() - lastRefreshed, policy, preload)
      if (failure !== null) console.error(renderSyncMessage(failure))
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

/** Injectable dependencies for the freshness gates in this module. */
export type SessionCacheDeps = {
  cache?: SessionCardCache
  preload?: () => Promise<void>
  /** How to detect a card-bulk/`defaultLanguage` mismatch (tests inject; real check otherwise). */
  detectMismatch?: BulkTypeMismatchCheck
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
 * via their own preload warning. A bulk-type mismatch (the cache was built
 * from the wrong bulk for the configured `defaultLanguage`) takes over the
 * refresh decision entirely: it is offered/run first, and the staleness logic
 * is skipped for that run.
 */
export async function refreshCardCacheForSession(
  policy: RefreshPolicy,
  deps: SessionCacheDeps = {},
): Promise<void> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? refreshCardCache
  const detectMismatch = deps.detectMismatch ?? detectCardBulkTypeMismatch

  if (await cache.isEmpty()) return

  if (await handleBulkTypeMismatch(await detectMismatch(), policy, preload)) {
    return
  }

  const lastRefreshed = await cache.getLastRefreshedAt()
  if (lastRefreshed === null) return
  const age = Date.now() - lastRefreshed

  if (policy.mode === 'auto' && age > PRICE_MAX_AGE_MS) {
    console.log(t('cli.cacheGate.pricesStaleRefreshing'))
    await preloadOrReport(preload)
    return
  }

  if (policy.mode !== 'ask') return
  const failure = await promptStaleCacheRefresh(age, policy, preload)
  if (failure !== null) console.error(renderSyncMessage(failure))
}

/**
 * Report a refresh this gate is performing. Defaults to the console (in the
 * CLI's language); callers with a run log of their own (a sync's event stream)
 * pass their own sink, which gets the message unrendered so a report can carry
 * it in English plus its key.
 */
export type CacheRefreshLog = (message: SyncMessage) => void

/** Injectable dependencies for {@link ensureCardCacheForUpload}. */
export type UploadCacheDeps = SessionCacheDeps & { log?: CacheRefreshLog }

/**
 * A cache {@link ensureCardCacheForUpload} vouched for. `refreshed` says the gate
 * replaced it on the way — so anything the caller already derived from the old
 * cache is stale and has to be derived again.
 */
export type UploadCacheReady = { refreshed: boolean }

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
 * @returns An {@link UploadCacheReady} when the cache may be used, else the
 *   reason it may not — a message for the caller to report as it is.
 */
export async function ensureCardCacheForUpload(
  policy: RefreshPolicy,
  deps: UploadCacheDeps = {},
): Promise<UploadCacheReady | SyncMessage> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? refreshCardCache
  const log = deps.log ?? ((message: SyncMessage) => console.log(renderSyncMessage(message)))

  const empty = await cache.isEmpty()
  const lastRefreshed = empty ? null : await cache.getLastRefreshedAt()
  const age = lastRefreshed === null ? null : Date.now() - lastRefreshed
  if (!empty && (age === null || age <= PRICE_MAX_AGE_MS)) return { refreshed: false }

  const because: SyncMessageRef = empty
    ? syncRef('domain.cache.uploadNeedsEmptyCache')
    : syncRef('domain.cache.uploadNeedsFreshCache', { age: syncDuration(age ?? 0) })
  // The refusal appends the remedy to why: the requirement, or the failed download.
  const refusal = (reason: SyncText): SyncMessage =>
    syncMessage('domain.cache.uploadRemedy', { reason, ...REFRESH_REMEDY })
  const failed = (failure: SyncMessage): SyncMessage => refusal(nestSync(failure))

  if (policy.mode === 'auto') {
    log(syncMessage('domain.cache.uploadRefreshing', { reason: because }))
    // A download that failed leaves the same cache the requirement just refused,
    // so the failure *is* the refusal rather than an exception past the caller.
    const failure = await tryPreload(preload)
    if (failure !== null) return failed(failure)
  } else if (policy.mode === 'ask') {
    const accepted = await policy.confirm({
      // A prompt is only ever the CLI's, so it is worded in the CLI's language.
      message: t('cli.cacheGate.uploadConfirm', { reason: renderSyncMessage(because) }),
      initial: true,
    })
    // Declining is an answer, not a fall-through: uploading from this cache is
    // exactly what the freshness requirement forbids.
    if (!accepted) return refusal(because)
    const failure = await tryPreload(preload)
    if (failure !== null) return failed(failure)
  } else {
    // `no-bulk` and `never` forbid the only way this cache is ever filled.
    return refusal(because)
  }

  if (await cache.isEmpty()) return syncMessage('domain.cache.uploadStillEmpty')
  return { refreshed: true }
}

/**
 * Ensure the card cache holds cards at all, offering the bulk download that is
 * the only way to fill it. The one empty-cache policy shared by every command
 * that cannot run without card data (`price`, `sell`):
 *
 * - `no-bulk`/`never` refuse silently — the caller surfaces the error.
 * - `auto` downloads outright; `ask` prompts (default yes), declining refuses.
 * - Messages go through `getLogger()`, so a structured-output run keeps them
 *   off stdout.
 *
 * @param requirement One sentence naming why the cache is needed, appended to
 *   the empty-cache announcement.
 * @returns Whether the cache now holds cards.
 */
export async function ensureCardCachePresent(
  policy: RefreshPolicy,
  requirement: string,
  deps: SessionCacheDeps = {},
): Promise<boolean> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? refreshCardCache

  if (!(await cache.isEmpty())) return true
  // The cache can only be filled by a bulk download, so modes that forbid one
  // leave an empty cache simply unusable — never download, stay quiet.
  if (!bulkAllowed(policy.mode)) return false
  getLogger().info(t('cli.cacheGate.emptyWithRequirement', { requirement }))
  const accepted = await decideBulkRefresh(policy, {
    message: t('cli.cacheGate.downloadNowConfirm'),
    initial: true,
  })
  if (!accepted) return false
  const failure = await tryPreload(preload)
  if (failure !== null) {
    getLogger().error(renderSyncMessage(failure))
    return false
  }
  return !(await cache.isEmpty())
}

/**
 * The slice of the card cache {@link offerBulkPriceRefresh} reads. `Required`
 * because `CacheManager` declares these optional: a double that omitted
 * `getTimestamp` would silently make every price look fresh.
 */
export type PriceFreshnessCache = Required<
  Pick<CacheManager<ScryfallCard[]>, 'getLastRefreshedAt' | 'getTimestamp' | 'isBlocked'>
>

/** Injectable dependencies for {@link offerBulkPriceRefresh}. */
export type PriceRefreshDeps = {
  cache?: PriceFreshnessCache
  preload?: () => Promise<void>
}

/** Injectable dependencies for {@link offerTagDownload}. */
export type TagDownloadDeps = {
  download?: () => Promise<TagIndex | null>
  /** Re-attach the downloaded tags to every cached card. */
  bake?: (index: TagIndex) => Promise<void>
}

/**
 * Offer the bulk redownload that refreshes prices, when enough of the given
 * cards carry prices older than a day for a redownload to beat per-card fetches.
 *
 * Shared by the two surfaces that render a whole workspace's prices at once:
 * `build-site`'s fetch loop and `serve --api`'s startup warm. Silent unless it
 * has something to offer, and never fatal — a refusal or a cold network leaves
 * the older prices in place.
 *
 * @param cardNames Every card name the caller is about to price.
 * @param cacheJustRefreshed Whether this run already bulk-downloaded, which
 *   makes the prices as fresh as a redownload could make them.
 */
export async function offerBulkPriceRefresh(
  cardNames: readonly string[],
  policy: RefreshPolicy,
  cacheJustRefreshed: boolean,
  deps: PriceRefreshDeps = {},
): Promise<void> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? refreshCardCache

  if (!bulkAllowed(policy.mode)) return

  const lastBulkRefresh = await cache.getLastRefreshedAt()
  const bulkCacheIsRecent =
    cacheJustRefreshed ||
    (lastBulkRefresh != null && Date.now() - lastBulkRefresh < PRICE_MAX_AGE_MS)
  if (bulkCacheIsRecent) return

  let stalePriceCount = 0
  for (const name of cardNames) {
    if (await cache.isBlocked(name)) continue
    const timestamp = await cache.getTimestamp(name)
    if (timestamp == null || Date.now() - timestamp >= PRICE_MAX_AGE_MS) {
      stalePriceCount++
    }
  }

  if (stalePriceCount <= BULK_FETCH_THRESHOLD) return

  console.log(
    `\n${t('cli.cacheGate.stalePriceCount', { stale: stalePriceCount, count: cardNames.length })}`,
  )
  console.log(t('cli.cacheGate.bulkFasterHint'))

  const shouldPreload = await decideBulkRefresh(policy, {
    message: t('cli.cacheGate.redownloadConfirm'),
    initial: false,
  })

  if (shouldPreload) {
    // Best-effort warm: `refreshCardCache` propagates now, and a cold network
    // must not fail a run that can still work against the existing cache.
    const failure = await tryPreload(preload)
    if (failure !== null) {
      console.error(
        t('cli.cacheGate.continuingWithExisting', { reason: renderSyncMessage(failure) }),
      )
    }
  }
}

/**
 * Offer the oracle/art tag download the site's tag filters need, baking the
 * result into the card cache.
 *
 * Callers decide *whether* the tags are missing (each has a cheaper way to
 * check the cards it cares about) — this owns the prompt, the download, the
 * bake, and the messages, so `build-site` and `serve --api` say the same things.
 *
 * @returns The downloaded index, so a caller holding cards in memory can attach
 *   tags to them without a second download; `null` when nothing was downloaded.
 */
export async function offerTagDownload(
  policy: RefreshPolicy,
  deps: TagDownloadDeps = {},
): Promise<TagIndex | null> {
  const download = deps.download ?? downloadTagIndex
  const bake = deps.bake ?? refreshTags

  const accepted = await decideBulkRefresh(policy, {
    message: t('cli.cacheGate.tagsConfirm'),
    initial: true,
  })
  if (!accepted) {
    console.log(t('cli.cacheGate.tagsSkipped', { command: commandLine(COMMAND.cacheRefreshTags) }))
    return null
  }

  console.log(t('cli.cacheGate.tagsFetching'))
  const tagIndex = await download()
  if (!tagIndex) {
    console.warn(t('cli.cacheGate.tagsFailed'))
    return null
  }
  // Bake into the cache so future builds and CLI features have them too — the
  // index is passed through, so this never re-downloads.
  await bake(tagIndex)
  console.log(t('cli.cacheGate.tagsAdded'))
  return tagIndex
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
  policy: RefreshPolicy,
  deps: SessionCacheDeps = {},
): Promise<PriceFreshnessResult> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? refreshCardCache

  if (await cache.isEmpty()) {
    // The cache was empty, so a download that failed leaves nothing to price.
    const ready = await ensureCardCachePresent(policy, t('cli.cacheGate.pricingRequirement'), {
      cache,
      preload,
    })
    return ready
      ? { ready: true, lastRefreshedAt: await cache.getLastRefreshedAt() }
      : { ready: false, lastRefreshedAt: null }
  }

  const lastRefreshed = await cache.getLastRefreshedAt()
  if (lastRefreshed !== null) {
    const age = Date.now() - lastRefreshed
    if (age > PRICE_MAX_AGE_MS) {
      // A stale-price refresh that failed still leaves usable (older) prices, so
      // it is reported and the run continues.
      if (policy.mode === 'auto') {
        console.log(t('cli.cacheGate.pricesStaleRefreshing'))
        await preloadOrReport(preload)
      } else if (policy.mode === 'ask') {
        const accepted = await policy.confirm({
          message: t('cli.cacheGate.pricesAgeConfirm', { age: formatDuration(age) }),
          initial: false,
        })
        if (accepted) {
          await preloadOrReport(preload)
        }
      }
    }
  }
  return { ready: true, lastRefreshedAt: await cache.getLastRefreshedAt() }
}
