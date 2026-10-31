import path from 'node:path'
import { getCacheDir } from './file-cache'
import { cardCache } from './instances'
import { getCacheFeedUrl, getCacheSource, type CacheSource } from '../config/ritual-config'
import { preloadCache, preloadCacheFromFiles } from '../scryfall'
import { CacheFeedClient } from './feed-client'
import { defaultHttpClient } from '../util/http'
import { getLogger } from '../util/logger'
import { getErrorMessage } from '../util/errors'
import { t } from '../i18n/t'
import { CONFIG_KEY } from '../util/cli-tokens'

/**
 * Resolve the feed URL: explicit flag, else the `cacheFeedUrl` config key, else
 * none. There is no public feed to fall back to, so a feed-sourced refresh with
 * neither has nowhere to sync from: the commands that ask for the feed by flag
 * refuse it (`rejectFeedSourceWithoutUrl`), and a refresh the config sent to the
 * feed warns and uses Scryfall.
 */
export function resolveFeedUrl(explicit?: string): string | undefined {
  return explicit ?? getCacheFeedUrl()
}

/** Where a fetching client keeps its downloaded artifacts and sync state. */
export function getFeedClientDataDir(): string {
  return path.join(getCacheDir(), 'feed-client')
}

/** Options for {@link createCacheFeedClient}. */
export type CreateCacheFeedClientOptions = {
  url: string
  p2p?: boolean
  torrentPort?: number
}

/** Build the standard feed client wired to the real cache-ingest pipeline. */
export function createCacheFeedClient(options: CreateCacheFeedClientOptions): CacheFeedClient {
  return new CacheFeedClient({
    feedUrl: options.url,
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
export async function refreshCardCacheFromFeed(
  url: string,
  force = false,
): Promise<'ingested' | 'unchanged'> {
  const client = createCacheFeedClient({ url })
  try {
    const { outcome } = await client.sync({ force })
    if (outcome === 'unchanged') {
      getLogger().info(t('cli.cacheStore.feedUnchanged'))
      await cardCache.bulkSet({})
    }
    return outcome
  } finally {
    await client.stop()
  }
}

/** Per-run overrides for {@link refreshCardCache}, plus injectable test seams. */
export type RefreshCardCacheOptions = {
  /** Override the configured `cacheSource` for this run. */
  source?: CacheSource
  /** Feed URL override — implies the feed source. */
  url?: string
  /** Re-download and re-ingest even when the feed reports no changes. */
  force?: boolean
  /** Test seam for the feed sync path. */
  feedRefresh?: (url: string, force?: boolean) => Promise<'ingested' | 'unchanged'>
  /** Test seam for the direct Scryfall preload. */
  scryfallPreload?: () => Promise<void>
}

/**
 * Refresh the card cache from the configured source: the cache feed when
 * `cacheSource` is 'feed' (falling back to the direct Scryfall bulk download
 * with a warning when the feed is unreachable, or when no feed URL is set),
 * otherwise Scryfall. An explicit `url` selects the feed source even when the
 * config says Scryfall.
 */
export async function refreshCardCache(options: RefreshCardCacheOptions = {}): Promise<void> {
  const source = options.source ?? (options.url !== undefined ? 'feed' : getCacheSource())
  const feedRefresh = options.feedRefresh ?? refreshCardCacheFromFeed
  const scryfallPreload = options.scryfallPreload ?? preloadCache
  if (source === 'feed') {
    const url = resolveFeedUrl(options.url)
    if (url === undefined) {
      getLogger().warn(
        t('cli.cacheStore.feedUrlMissing', {
          sourceKey: CONFIG_KEY.cacheSource,
          urlKey: CONFIG_KEY.cacheFeedUrl,
        }),
      )
    } else {
      try {
        await feedRefresh(url, options.force ?? false)
        return
      } catch (e) {
        getLogger().warn(t('cli.cacheStore.feedFallback', { reason: getErrorMessage(e) }))
      }
    }
  }
  await scryfallPreload()
}
