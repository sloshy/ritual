import { buylistFeedIsStale } from '../buylist'
import { defaultHttpClient } from '../util/http'
import type { HttpClient } from '../util/interfaces'
import { getLogger } from '../util/logger'
import { bulkAllowed, type RefreshPolicy } from '../cache/refresh'
import { loadRitualConfig, wantsCardKingdomFeed } from '../config/ritual-config'
import { t } from '../i18n/t'
import {
  isSyncMessage,
  nestSync,
  renderSyncMessage,
  syncDuration,
  syncMessage,
  syncRef,
  type SyncMessage,
  type SyncMessageRef,
} from '../sync/message'
import { loadCardKingdomCache, saveCardKingdomCache, type CardKingdomCacheFile } from './cache'
import { fetchCardKingdomFeed } from './client'
import { loadEnsuredFeed } from './memo'
import { FLAG, flagValue } from '../util/cli-tokens'

/**
 * Roughly how many megabytes the pricelist download weighs, for the sentences
 * that warn of it (`~70 MB`). An estimate, not a measurement, so it is a plain
 * round number rather than a size param formatted to two decimals.
 */
const FEED_DOWNLOAD_MB = 70

/** The lead sentence every "no buylist yet" message opens with. */
function noFeedLead(): SyncMessageRef {
  return syncRef('domain.cache.cardKingdom.noFeed')
}

/**
 * The standard remedy line for a missing Card Kingdom feed, CLI flavor — the
 * refusal `ritual sell` and `ritual price` report, in the CLI's language and
 * (English plus the key) in their `--output json` envelopes.
 */
export function missingFeedAdvice(): SyncMessage {
  return syncMessage('domain.cache.cardKingdom.missingAdvice', {
    lead: noFeedLead(),
    flag: flagValue(FLAG.refresh, 'auto'),
    size: FEED_DOWNLOAD_MB,
  })
}

/**
 * The same refusal for an HTTP caller, which has more ways to fix it than a
 * CLI flag. Kept beside {@link missingFeedAdvice} so the two flavors of one
 * sentence cannot drift. The MCP tool, route and command it names are
 * identifiers, passed as params so no translation can alter them.
 */
export function missingFeedApiAdvice(): SyncMessage {
  return syncMessage('domain.cache.cardKingdom.missingApiAdvice', {
    lead: noFeedLead(),
    tool: 'refresh_buylist',
    route: 'POST /api/sell/refresh',
    command: 'ritual sell --refresh auto',
  })
}

/** A usable feed: the cache file plus whether this call just downloaded it. */
export type CardKingdomFeedResult = CardKingdomCacheFile & {
  refreshed: boolean
  /**
   * The feed's product rows this call's download skipped as malformed, one
   * message each (capped, with a count of the rest) — English plus its key, so
   * the refresh route and MCP report what the console prints. Empty when
   * nothing was downloaded or every row parsed.
   */
  skippedRows: SyncMessage[]
  /**
   * Set when a wanted download failed and the stale cache is being used
   * instead — the failure reason, as a message (English plus its key) for the
   * caller to surface. Absent when the cache was simply fresh (or going stale
   * was accepted).
   */
  staleFallback?: SyncMessage
}

/** Injectable dependencies for {@link ensureCardKingdomFeed}. */
export type EnsureCardKingdomFeedDeps = {
  http?: HttpClient
  load?: () => Promise<CardKingdomCacheFile | null>
  save?: (file: CardKingdomCacheFile) => Promise<void>
  now?: () => number
  /** Treat a fresh cache as stale, so `auto` redownloads unconditionally. */
  force?: boolean
}

/**
 * Apply the `--refresh` policy to the cached Card Kingdom feed and return a
 * usable feed, or the reason there is none. The download counts as a bulk
 * operation, so `no-bulk` behaves like `never`.
 *
 * - A fresh cache (younger than a day, matching CK's daily regeneration) is
 *   used as-is.
 * - A stale cache (a day old, so quoting yesterday's offers) is redownloaded
 *   without prompting under `ask` and `auto` — the same automatic treatment the
 *   Scryfall bulk cache gets, and the reason every buylist surface stays current
 *   on its own — and left alone under `no-bulk`/`never`.
 * - A missing cache is downloaded under `auto`, prompted for under `ask`
 *   (default yes; declining refuses), and refused under `no-bulk`/`never`.
 * - A download failure falls back to the stale cache when one exists
 *   (reported, not thrown); with no cache at all the failure is the refusal.
 *
 * Its console lines (progress, the prompt, the stale-fallback warning) are in
 * the active locale; what it returns is a message, English plus its key, since
 * a refusal reaches the admin API and MCP as well as the CLI.
 *
 * @returns The feed, or the message saying why there is none.
 */
export async function ensureCardKingdomFeed(
  policy: RefreshPolicy,
  deps: EnsureCardKingdomFeedDeps = {},
): Promise<CardKingdomFeedResult | SyncMessage> {
  const http = deps.http ?? defaultHttpClient
  const load = deps.load ?? loadCardKingdomCache
  const save = deps.save ?? saveCardKingdomCache
  const now = deps.now ?? Date.now

  const cached = await load()

  const download = async (): Promise<CardKingdomFeedResult | SyncMessage> => {
    getLogger().info(
      renderSyncMessage(syncRef('cli.cardKingdom.downloading', { size: FEED_DOWNLOAD_MB })),
    )
    const fetched = await fetchCardKingdomFeed(http)
    if (isSyncMessage(fetched)) return fetched
    for (const warning of fetched.warnings) getLogger().warn(renderSyncMessage(warning))
    const file: CardKingdomCacheFile = { retrievedAt: now(), feed: fetched.feed }
    await save(file)
    getLogger().info(t('cli.cardKingdom.updated', { count: fetched.feed.products.length }))
    return { ...file, refreshed: true, skippedRows: fetched.warnings }
  }

  if (cached && deps.force !== true && !buylistFeedIsStale(cached.retrievedAt, now())) {
    return { ...cached, refreshed: false, skippedRows: [] }
  }

  if (cached) {
    // Stale but present: refreshed without asking, the same rule the Scryfall
    // bulk cache follows. Card Kingdom regenerates the pricelist daily, so a
    // day-old feed is quoting yesterday's offers. Downloading one at all was an
    // explicit act (the missing-feed prompt below, or `--refresh auto`), and
    // running the command again — or starting a server — renews it.
    // `no-bulk`/`never` still forbid it, and keep the stale feed silently.
    const age = syncDuration(now() - cached.retrievedAt)
    if (bulkAllowed(policy.mode)) {
      getLogger().info(renderSyncMessage(syncRef('cli.cardKingdom.updating', { age })))
      const downloaded = await download()
      if (!isSyncMessage(downloaded)) return downloaded
      // A failed courtesy refresh degrades to the stale feed — reported both
      // ways, so a caller that only reads the result still learns of it.
      getLogger().warn(
        renderSyncMessage(
          syncRef('cli.cardKingdom.usingStale', { reason: nestSync(downloaded), age }),
        ),
      )
      return { ...cached, refreshed: false, skippedRows: [], staleFallback: downloaded }
    }
    return { ...cached, refreshed: false, skippedRows: [] }
  }

  // Missing entirely: only a download can help. This one still asks — it is the
  // first ~70 MB, and consenting to it is what licenses the silent daily
  // refreshes above.
  if (!bulkAllowed(policy.mode)) {
    return missingFeedAdvice()
  }
  if (policy.mode === 'ask') {
    const accepted = await policy.confirm({
      message: renderSyncMessage(
        syncRef('cli.cardKingdom.downloadPrompt', {
          lead: noFeedLead(),
          size: FEED_DOWNLOAD_MB,
        }),
      ),
      initial: true,
    })
    if (!accepted) {
      return missingFeedAdvice()
    }
  }
  return download()
}

/**
 * What {@link warmCardKingdomFeed} found and left behind.
 *
 * `ready: false` with no `problem` is the ordinary "no buylist here yet" state —
 * the warm declines to download a first feed, which is a decision rather than a
 * failure, and every other surface already says so where it matters (the admin
 * card's empty state, the routes' 503, `sell`'s advice).
 */
export type BuylistWarmth = {
  /**
   * Whether anything wants the feed at all — sell mode or the `cardkingdom`
   * price source. When false, nothing was checked.
   */
  enabled: boolean
  /** Whether a usable feed is cached now. */
  ready: boolean
  /** Whether this call downloaded one. */
  refreshed: boolean
  /**
   * Why a refresh this call wanted did not happen, English plus its key. Never
   * set for a missing feed.
   */
  problem?: SyncMessage
}

/** Injectable dependencies for {@link warmCardKingdomFeed}. */
export type WarmCardKingdomFeedDeps = EnsureCardKingdomFeedDeps & {
  /**
   * Force the feed-wanted gate on or off instead of consulting
   * {@link wantsCardKingdomFeed} (sell mode or the `cardkingdom` price source).
   *
   * No command passes it any more — `admin` used to, to force sell mode on
   * regardless of config, and now follows the same gate as `serve` and
   * `build-site`. Kept as the seam that lets a caller decide the policy
   * itself, and lets tests exercise the warm without a config on disk.
   */
  sellMode?: boolean
  /** Index the ensured feed into the process memo. */
  adopt?: (result: CardKingdomFeedResult) => Promise<unknown>
}

/**
 * The startup line reporting a warm that wanted to refresh and could not, or
 * nothing when there is nothing to say — a console line, in the active locale.
 * Shared so both servers word it once.
 */
export function sellModeWarning(warmth: BuylistWarmth): string | undefined {
  if (warmth.problem === undefined) return undefined
  return renderSyncMessage(
    syncRef('cli.cardKingdom.sellModeProblem', { problem: nestSync(warmth.problem) }),
  )
}

/**
 * Bring the Card Kingdom buylist up to date before a long-lived server starts
 * serving quotes from it.
 *
 * The quote routes are strictly cache-backed — an unauthenticated, wildcard-CORS
 * endpoint must never be able to trigger a ~70 MB download — which left a server
 * quoting whatever feed happened to be on disk, indefinitely. Startup is the
 * right place for the download instead: it is operator-initiated, it happens
 * once, and it is the same moment the card cache is warmed.
 *
 * Only ever *updates* a buylist. Loading the cache first is what makes that
 * structural rather than aspirational: a feed that is absent — or present and
 * unreadable, which loading reports the same way — ends the warm right there,
 * so no reachable path can prompt (a server start must not block on a question)
 * or spend ~70 MB on a capability this deployment may never use. The feed it did
 * find is handed to the gate, so the ~20 MB parse happens once.
 *
 * Never fatal either: a server with no buylist still serves everything else.
 */
export async function warmCardKingdomFeed(
  policy: RefreshPolicy,
  deps: WarmCardKingdomFeedDeps = {},
): Promise<BuylistWarmth> {
  const { sellMode, adopt, ...ensureDeps } = deps
  const enabled = sellMode ?? wantsCardKingdomFeed(await loadRitualConfig())
  if (!enabled) return { enabled: false, ready: false, refreshed: false }

  const cached = await (ensureDeps.load ?? loadCardKingdomCache)()
  if (!cached) return { enabled: true, ready: false, refreshed: false }

  const result = await ensureCardKingdomFeed(policy, { ...ensureDeps, load: async () => cached })
  if (isSyncMessage(result)) {
    // Unreachable in practice — the gate refuses only a missing feed, and this
    // one is in hand — but a refusal is still a refusal, not a usable feed.
    return { enabled: true, ready: false, refreshed: false, problem: result }
  }
  if (result.refreshed) {
    // Index the feed we just wrote so the first quote request does not pay to
    // parse it. `loadEnsuredFeed` owns that rule, shared with `build-site`: it
    // never re-reads the file already in hand. A feed that was *not* refreshed
    // is deliberately left un-indexed — the warm's job is to update a buylist,
    // not to spend a startup building an index the process may never use.
    await (adopt ?? loadEnsuredFeed)(result)
  }
  return {
    enabled: true,
    ready: true,
    refreshed: result.refreshed,
    ...(result.staleFallback === undefined ? {} : { problem: result.staleFallback }),
  }
}
