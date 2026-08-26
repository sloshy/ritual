import { cardCache, ensureCacheForCards } from '../cache'
import { offerBulkPriceRefresh, offerTagDownload } from '../cache/freshness'
import { sampleTagsPresent } from '../cache/status'
import { getErrorMessage } from '../util/errors'
import { t } from '../i18n/t'
import { loadRitualConfig, type RitualConfig } from '../config/ritual-config'
import { bulkAllowed, type RefreshMode } from '../cache/refresh'
import { dirForType } from '../list/resolve-list'
import { deckCardNames, flatListCardNames } from '../site/details/card-names'
import { loadCollectionSource } from '../site/details/collection'
import { loadDeckSource } from '../site/details/deck'
import { loadWantedSource } from '../site/details/wanted'
import { enumerateSources } from './lists'

/** What {@link warmSiteCache} found and left behind. */
export type SiteCacheWarmth = {
  /** Whether the cache holds any cards at all — see {@link cardCacheReady}. */
  ready: boolean
  /** Distinct card names the served lists reference. */
  siteCardCount: number
}

/**
 * Whether the card cache holds any cards at all. Nothing the live server serves
 * — payload cards, autocomplete, printings — comes from anywhere else.
 */
export async function cardCacheReady(): Promise<boolean> {
  return !(await cardCache.isEmpty())
}

/**
 * Every card name the served lists mention, through the same loaders and the
 * same name collectors the live payloads use — so the warm covers exactly the
 * cards a request can ask for, changelog and primer references included.
 *
 * A list that will not load is warmed past rather than fatal: the server starts
 * either way, and the same file's failure is reported again when a request
 * tries to serve it.
 */
async function collectSiteCardNames(config: RitualConfig): Promise<Set<string>> {
  const names = new Set<string>()

  const skip = (kind: string, basename: string, reason: string): void => {
    console.warn(`Skipping ${kind} '${basename}' while warming the card cache: ${reason}`)
  }

  const decksDir = dirForType('deck', config)
  for (const basename of await enumerateSources('deck', config)) {
    const loaded = await loadDeckSource(decksDir, basename)
    if (typeof loaded === 'string') {
      skip('deck', basename, loaded)
      continue
    }
    for (const name of await deckCardNames(loaded)) names.add(name)
  }

  for (const kind of ['collection', 'wanted'] as const) {
    const dir = dirForType(kind, config)
    for (const basename of await enumerateSources(kind, config)) {
      const loaded =
        kind === 'collection'
          ? await loadCollectionSource(dir, basename)
          : await loadWantedSource(dir, basename)
      if (typeof loaded === 'string') {
        skip(kind, basename, loaded)
        continue
      }
      for (const name of await flatListCardNames(loaded)) names.add(name)
    }
  }

  return names
}

/**
 * The gates {@link warmSiteCache} runs, injectable so a test can drive their
 * order and arguments without a network. Each defaults to the real gate.
 */
export type WarmDeps = {
  ensureCards?: (names: Set<string>, allowBulk: boolean) => Promise<boolean>
  offerPrices?: (names: readonly string[], cacheJustRefreshed: boolean) => Promise<void>
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
 * difference between a served card and a `null` one. The three gates are
 * `build-site`'s, in its order:
 *
 * 1. Bulk-download when the cache has never been downloaded, is over a week old,
 *    or is missing many of the site's cards.
 * 2. Offer a redownload when the site's prices are more than a day old.
 * 3. Offer the oracle/art tag download the tag filters need.
 *
 * Every gate is best-effort: a cold network or a declined prompt leaves the
 * cache as it was and the server still starts, which is why this reports what
 * the cache ended up holding rather than throwing.
 *
 */
export async function warmSiteCache(
  mode: RefreshMode,
  deps: WarmDeps = {},
): Promise<SiteCacheWarmth> {
  const ensureCards =
    deps.ensureCards ??
    (async (names, allowBulk) =>
      (await ensureCacheForCards(names, undefined, { allowBulk })).refreshed)
  const offerPrices =
    deps.offerPrices ??
    ((names, cacheJustRefreshed) => offerBulkPriceRefresh(names, mode, cacheJustRefreshed))
  const hasTags = deps.hasTags ?? sampleTagsPresent
  const offerTags = deps.offerTags ?? (async () => void (await offerTagDownload(mode)))

  const config = await loadRitualConfig()
  const siteCardNames = await collectSiteCardNames(config)
  const uniqueCards = [...siteCardNames]
  const count = uniqueCards.length
  console.log(`Found ${t('cli.serve.uniqueCards', { count })} across the served lists.`)

  await cardCache.purgeExpiredBlocklist()

  let cacheJustRefreshed = false
  try {
    cacheJustRefreshed = await ensureCards(siteCardNames, bulkAllowed(mode))
  } catch (e) {
    console.error(
      `Card cache download failed; serving from the existing cache. ${getErrorMessage(e)}`,
    )
  }

  await offerPrices(uniqueCards, cacheJustRefreshed)

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
