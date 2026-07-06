import path from 'node:path'
import { getCacheDir } from './file-cache'
import { cardCache } from './instances'
import { getCacheFeedUrl, getCacheSource, type CacheSource } from '../ritual-config'
import { preloadCache, preloadCacheFromFiles } from '../scryfall'
import { CacheFeedClient, DEFAULT_FEED_URL } from '../cache-feed/fetch'
import { defaultHttpClient } from '../http'
import { getLogger } from '../logger'
import { getErrorMessage } from '../errors'

/** Resolve the feed URL: explicit flag > `cacheFeedUrl` config > built-in default. */
export function resolveFeedUrl(explicit?: string): string {
  return explicit ?? getCacheFeedUrl() ?? DEFAULT_FEED_URL
}

/** Where a fetching client keeps its downloaded artifacts and sync state. */
export function getFeedClientDataDir(): string {
  return path.join(getCacheDir(), 'feed-client')
}

/** Options for {@link createCacheFeedClient}. */
export type CreateCacheFeedClientOptions = {
  url?: string
  p2p?: boolean
  torrentPort?: number
}

/** Build the standard feed client wired to the real cache-ingest pipeline. */
export function createCacheFeedClient(
  options: CreateCacheFeedClientOptions = {},
): CacheFeedClient {
  return new CacheFeedClient({
    feedUrl: resolveFeedUrl(options.url),
    dataDir: getFeedClientDataDir(),
    http: defaultHttpClient,
    ingest: preloadCacheFromFiles,
    ...(options.p2p !== undefined ? { p2p: options.p2p } : {}),
    ...(options.torrentPort !== undefined ? { torrentPort: options.torrentPort } : {}),
  })
}

/**
 * One-shot feed sync: download changed artifacts (uploading to peers for the
 * duration of the download), ingest them, and record the state. When the feed
 * is unchanged, touches the cache's staleness timestamp instead — the feed
 * just confirmed the local data is current, so prompts should not keep firing.
 */
export async function refreshCardCacheFromFeed(url?: string): Promise<'ingested' | 'unchanged'> {
  const client = createCacheFeedClient({ url })
  try {
    const { outcome } = await client.sync()
    if (outcome === 'unchanged') {
      getLogger().info('Cache feed is unchanged; card cache is current.')
      await cardCache.bulkSet({})
    }
    return outcome
  } finally {
    await client.stop()
  }
}

/** Injectable dependencies for {@link refreshCardCache} (tests only). */
export type RefreshCardCacheDeps = {
  source?: CacheSource
  feedRefresh?: (url?: string) => Promise<'ingested' | 'unchanged'>
  scryfallPreload?: () => Promise<void>
}

/**
 * Refresh the card cache from the configured source: the cache feed when
 * `cacheSource` is 'feed' (falling back to the direct Scryfall bulk download
 * with a warning when the feed is unreachable), otherwise Scryfall.
 */
export async function refreshCardCache(deps: RefreshCardCacheDeps = {}): Promise<void> {
  const source = deps.source ?? getCacheSource()
  const feedRefresh = deps.feedRefresh ?? refreshCardCacheFromFeed
  const scryfallPreload = deps.scryfallPreload ?? preloadCache
  if (source === 'feed') {
    try {
      await feedRefresh()
      return
    } catch (e) {
      getLogger().warn(`Feed refresh failed (${getErrorMessage(e)}); falling back to Scryfall.`)
    }
  }
  await scryfallPreload()
}
