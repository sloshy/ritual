import { cardCache } from '../cache'
import { offerTagDownload } from '../cache/freshness'
import { sampleTagsPresent } from '../cache/status'
import { t } from '../i18n/t'
import { loadRitualConfig } from '../config/ritual-config'
import type { RefreshMode } from '../cache/refresh'
import { LIST_TYPES } from '../list/list-type'
import { dirForType } from '../list/resolve-list'
import { prepareCardCache, type CardCachePrepDeps } from '../site-build/card-fetch'
import { loadListSource } from '../site-build/lists'
import { enumerateSources } from './lists'

/** What {@link warmSiteCache} found and left behind. */
export type SiteCacheWarmth = {
  ready: boolean
  /** Distinct card names the served lists reference. */
  siteCardCount: number
}

/** Whether the card cache holds any cards at all — nothing the live server serves comes from anywhere else. */
export async function cardCacheReady(): Promise<boolean> {
  return !(await cardCache.isEmpty())
}

/** The gates {@link warmSiteCache} runs, injectable so a test can drive them without a network. */
export type WarmDeps = Pick<CardCachePrepDeps, 'ensureCards' | 'offerPrices'> & {
  hasTags?: (names: readonly string[]) => Promise<boolean>
  offerTags?: () => Promise<void>
}

/**
 * Bring the card cache up to date for the lists `serve --api` is about to serve,
 * applying the freshness policy `build-site` applies — over every card the
 * served payloads can ask for.
 *
 * Live payloads are computed from the cache with **no** Scryfall fallback (see
 * `createCacheCardSource`), so a cache the build would have refreshed is the
 * difference between a served card and a `null` one. The gates are
 * `build-site`'s own (`prepareCardCache`), plus the oracle/art tag offer its
 * fetch pass makes, over the names the live payloads resolve. Every gate is
 * best-effort: a cold network, a declined prompt or a list that will not load
 * leaves the cache as it was and the server still starts, which is why this
 * reports what the cache ended up holding rather than throwing.
 */
export async function warmSiteCache(
  mode: RefreshMode,
  deps: WarmDeps = {},
): Promise<SiteCacheWarmth> {
  const hasTags = deps.hasTags ?? sampleTagsPresent
  const offerTags = deps.offerTags ?? (async () => void (await offerTagDownload(mode)))

  const config = await loadRitualConfig()
  const cardNames = new Set<string>()
  for (const kind of LIST_TYPES) {
    const dir = dirForType(kind, config)
    for (const name of await enumerateSources(kind, config)) {
      const list = await loadListSource(kind, dir, name)
      if (typeof list === 'string') {
        console.warn(t('cli.buildSite.loadFailed', { kind, name, reason: list }))
        continue
      }
      for (const cardName of await list.cardNames()) cardNames.add(cardName)
    }
  }
  const { uniqueCards } = await prepareCardCache(
    { cardNames, mode, verbose: false },
    {
      ...deps,
      downloadFailed: (reason) => t('cli.serve.cacheDownloadFailed', { reason }),
    },
  )
  const count = uniqueCards.length

  // The site's tag filters need oracle/art tags on the cards; a cache populated
  // before tags existed has none, and the live payloads would ship empty filters.
  // A cache with no cards at all is a different problem, reported by the caller
  // — offering to tag nothing would only bury it.
  const ready = await cardCacheReady()
  if (ready && count > 0 && !(await hasTags(uniqueCards))) {
    await offerTags()
  }

  return { ready, siteCardCount: count }
}
