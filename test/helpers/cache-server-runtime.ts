import { FileCacheManager, getCacheFile } from '../../src/cache'
import type { CacheServerRuntime } from '../../src/cache-server/server'
import { ScryfallClient } from '../../src/scryfall'
import { MemoryFileSystemClient, type MockHttpClient } from '../test-utils'

/**
 * A cache server's runtime over the bound workspace's cache, reaching Scryfall
 * through `http`, with no price-refresh scheduler. `localCardCache` lets a
 * suite hand in a cache it has rigged to fail.
 */
export function cacheServerRuntime(
  http: MockHttpClient,
  localCardCache: FileCacheManager<'cards'> = new FileCacheManager(getCacheFile, 'cards', 0),
): CacheServerRuntime {
  return {
    localCardCache,
    localPriceCache: new FileCacheManager(getCacheFile, 'prices'),
    localScryfallClient: new ScryfallClient(http, localCardCache, new MemoryFileSystemClient(), 0),
    priceRefreshScheduler: null,
  }
}
