/**
 * Process-lifetime memo of the parsed Card Kingdom feed and its lookup index.
 *
 * The cached feed is ~20 MB of JSON over ~150k products; parsing it and
 * building three index maps takes long enough that doing it per request makes
 * the sell endpoints unusable under a long-lived `serve --api` or admin server.
 * The memo is keyed on the cache file's mtime and size, so an out-of-band
 * refresh (the CLI, another process) is picked up without a restart, and
 * `invalidateCardKingdomIndex` drops it eagerly after this process downloads.
 *
 * Strictly read-only: nothing here ever reaches the network. Downloading is
 * `ensureCardKingdomFeed`'s job, reachable only from the CLI and
 * `POST /api/sell/refresh`.
 */

import { stat } from 'node:fs/promises'
import { buylistFeedIsStale, type BuylistFeedStamp } from '../buylist'
import { hasErrorCode } from '../errors'
import { buildCardKingdomIndex, type CardKingdomIndex } from './feed'
import { getCardKingdomCachePath, loadCardKingdomCache, type CardKingdomCacheFile } from './cache'
// Type-only, so the `ensure.ts` → `memo.ts` value import stays the single
// direction at runtime.
import type { CardKingdomFeedResult } from './ensure'

/** A cached feed plus its prebuilt lookup index. */
export type LoadedCardKingdomFeed = {
  file: CardKingdomCacheFile
  index: CardKingdomIndex
}

/**
 * Identity of the cache file a memo entry was built from. The path is part of
 * it because the base dir is a runtime setting: a process that switches base
 * dirs (the test suite does, per workspace) must not serve one workspace's feed
 * to another that happens to have written the same byte count.
 */
type CacheStamp = { path: string; mtimeMs: number; size: number }

type MemoEntry = CacheStamp & { loaded: LoadedCardKingdomFeed }

let memo: MemoEntry | null = null
/** In-flight load, so concurrent requests share one parse instead of racing. */
let pending: Promise<LoadedCardKingdomFeed | null> | null = null

async function readStamp(): Promise<CacheStamp | null> {
  const path = getCardKingdomCachePath()
  try {
    const stats = await stat(path)
    return { path, mtimeMs: stats.mtimeMs, size: stats.size }
  } catch (e) {
    if (hasErrorCode(e, 'ENOENT')) return null
    throw e
  }
}

function sameStamp(a: CacheStamp, b: CacheStamp): boolean {
  return a.path === b.path && a.mtimeMs === b.mtimeMs && a.size === b.size
}

/**
 * The cached feed and its index, or null when no feed has been downloaded.
 * Never downloads: callers that need one present must have run a refresh, and
 * report a 503 with the remedy otherwise.
 */
export async function getCardKingdomFeed(): Promise<LoadedCardKingdomFeed | null> {
  const stamp = await readStamp()
  if (stamp === null) {
    memo = null
    return null
  }
  if (memo && sameStamp(memo, stamp)) return memo.loaded

  if (!pending) {
    pending = (async (): Promise<LoadedCardKingdomFeed | null> => {
      const file = await loadCardKingdomCache()
      if (file === null) return null
      const loaded: LoadedCardKingdomFeed = {
        file,
        index: buildCardKingdomIndex(file.feed.products),
      }
      // Re-stat after the read: a refresh that landed mid-parse must not be
      // memoized under the pre-write stamp and served until the next write.
      const after = await readStamp()
      memo = after ? { ...after, loaded } : null
      return loaded
    })().finally(() => {
      pending = null
    })
  }
  return pending
}

/**
 * The memoized feed when it is already warm for the current cache file, and
 * null otherwise. Never reads or parses the cache — the "do I already have
 * this?" half of {@link getCardKingdomFeed}, for callers that hold the feed's
 * contents themselves and only want to avoid re-indexing them.
 */
export async function peekCardKingdomFeed(): Promise<LoadedCardKingdomFeed | null> {
  const stamp = await readStamp()
  return stamp !== null && memo !== null && sameStamp(memo, stamp) ? memo.loaded : null
}

/** Drop the memo, so the next read re-parses. Call after writing the cache file. */
export function invalidateCardKingdomIndex(): void {
  memo = null
}

/**
 * Index a feed already held in memory — the just-downloaded one — and adopt it
 * as the memo under the cache file's current stamp. Callers that have the feed
 * in hand use this instead of {@link getCardKingdomFeed} so a refresh does not
 * re-read and re-parse the ~20 MB file it just wrote.
 */
export async function adoptCardKingdomFeed(
  file: CardKingdomCacheFile,
): Promise<LoadedCardKingdomFeed> {
  const loaded: LoadedCardKingdomFeed = {
    file,
    index: buildCardKingdomIndex(file.feed.products),
  }
  const stamp = await readStamp()
  memo = stamp ? { ...stamp, loaded } : null
  return loaded
}

/**
 * The indexed feed for a result {@link ensureCardKingdomFeed} just returned,
 * without ever re-reading the cache file.
 *
 * The rule every caller of `ensureCardKingdomFeed` needs and none should
 * restate: a run that just downloaded adopts what it wrote, and one that did not
 * reuses the process memo when it is warm — a long-lived admin building
 * repeatedly pays nothing. Only when the memo is cold does it index, and even
 * then from the file already in hand rather than re-reading and re-parsing the
 * ~20 MB it was handed.
 *
 * Only the cache file's own fields are adopted: `refreshed`/`staleFallback` are
 * the ensure call's control flow, and the memo holds a `CardKingdomCacheFile`.
 */
export async function loadEnsuredFeed(
  result: CardKingdomFeedResult,
): Promise<LoadedCardKingdomFeed> {
  const file: CardKingdomCacheFile = { retrievedAt: result.retrievedAt, feed: result.feed }
  if (result.refreshed) return adoptCardKingdomFeed(file)
  return (await peekCardKingdomFeed()) ?? (await adoptCardKingdomFeed(file))
}

/** Freshness facts about a loaded feed, for status endpoints and UI stamps. */
export type CardKingdomFeedStamp = BuylistFeedStamp

/** Summarize a loaded feed's freshness as of `now`. */
export function feedStamp(
  loaded: LoadedCardKingdomFeed,
  now: number = Date.now(),
): CardKingdomFeedStamp {
  return {
    feedCreatedAt: loaded.file.feed.createdAt,
    feedRetrievedAt: loaded.file.retrievedAt,
    stale: buylistFeedIsStale(loaded.file.retrievedAt, now),
    productCount: loaded.file.feed.products.length,
  }
}
