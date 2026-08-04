import { defaultHttpClient } from '../http'
import type { HttpClient } from '../interfaces'
import { getLogger } from '../logger'
import {
  bulkAllowed,
  shouldBulkRefresh,
  type BulkRefreshPrompt,
  type RefreshMode,
} from '../refresh'
import { formatDuration } from '../utils'
import {
  cardKingdomFeedIsStale,
  loadCardKingdomCache,
  saveCardKingdomCache,
  type CardKingdomCacheFile,
} from './cache'
import { fetchCardKingdomFeed } from './client'

/** The standard remedy line for a missing Card Kingdom feed. */
export function missingFeedAdvice(lead: string): string {
  return `${lead} Re-run with --refresh auto to download it (~70 MB).`
}

/** A usable feed: the cache file plus whether this call just downloaded it. */
export type CardKingdomFeedResult = CardKingdomCacheFile & {
  refreshed: boolean
  /**
   * Set when a wanted download failed and the stale cache is being used
   * instead — the failure reason, worded for the caller to surface. Absent
   * when the cache was simply fresh (or going stale was accepted).
   */
  staleFallback?: string
}

/** Injectable dependencies for {@link ensureCardKingdomFeed}. */
export type EnsureCardKingdomFeedDeps = {
  http?: HttpClient
  load?: () => Promise<CardKingdomCacheFile | null>
  save?: (file: CardKingdomCacheFile) => Promise<void>
  confirm?: (prompt: BulkRefreshPrompt) => Promise<boolean>
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
 * - A stale cache is redownloaded under `auto`, prompted for under `ask`
 *   (default no; declining — or prompts being unavailable — keeps the stale
 *   feed), and left alone under `no-bulk`/`never`.
 * - A missing cache is downloaded under `auto`, prompted for under `ask`
 *   (default yes; declining refuses), and refused under `no-bulk`/`never`.
 * - A download failure falls back to the stale cache when one exists
 *   (reported, not thrown); with no cache at all the failure is the refusal.
 *
 * @returns The feed, or an error string worded for the caller to report.
 */
export async function ensureCardKingdomFeed(
  mode: RefreshMode,
  deps: EnsureCardKingdomFeedDeps = {},
): Promise<CardKingdomFeedResult | string> {
  const http = deps.http ?? defaultHttpClient
  const load = deps.load ?? loadCardKingdomCache
  const save = deps.save ?? saveCardKingdomCache
  const confirm = deps.confirm ?? ((prompt: BulkRefreshPrompt) => shouldBulkRefresh(mode, prompt))
  const now = deps.now ?? Date.now

  const cached = await load()

  const download = async (): Promise<CardKingdomFeedResult | string> => {
    getLogger().info('Downloading the Card Kingdom buylist (~70 MB)...')
    const fetched = await fetchCardKingdomFeed(http)
    if (typeof fetched === 'string') return fetched
    for (const warning of fetched.warnings) getLogger().warn(warning)
    const file: CardKingdomCacheFile = { retrievedAt: now(), feed: fetched.feed }
    await save(file)
    getLogger().info(`Card Kingdom buylist updated (${fetched.feed.products.length} products).`)
    return { ...file, refreshed: true }
  }

  if (cached && deps.force !== true && !cardKingdomFeedIsStale(cached.retrievedAt, now())) {
    return { ...cached, refreshed: false }
  }

  if (cached) {
    // Stale but present: a refresh is a courtesy, never a requirement.
    const age = formatDuration(now() - cached.retrievedAt)
    if (
      bulkAllowed(mode) &&
      (mode === 'auto' ||
        (await confirm({
          message: `The Card Kingdom buylist was retrieved ${age} ago. Update it now (~70 MB)?`,
          initial: false,
        })))
    ) {
      const downloaded = await download()
      if (typeof downloaded !== 'string') return downloaded
      // A failed courtesy refresh degrades to the stale feed — reported both
      // ways, so a caller that only reads the result still learns of it.
      getLogger().warn(`${downloaded} Using the buylist retrieved ${age} ago instead.`)
      return { ...cached, refreshed: false, staleFallback: downloaded }
    }
    return { ...cached, refreshed: false }
  }

  // Missing entirely: only a download can help.
  if (!bulkAllowed(mode)) {
    return missingFeedAdvice('No Card Kingdom buylist has been downloaded yet.')
  }
  if (mode === 'ask') {
    const accepted = await confirm({
      message: 'No Card Kingdom buylist has been downloaded yet. Download it now (~70 MB)?',
      initial: true,
    })
    if (!accepted) {
      return missingFeedAdvice('No Card Kingdom buylist has been downloaded yet.')
    }
  }
  return download()
}
