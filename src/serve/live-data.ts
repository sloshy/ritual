import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../cache'
import { getCacheFile } from '../cache/file-cache'
import { getCacheServerBaseUrl } from '../cache/config'
import { scryfallIdIndex } from '../cache/scryfall-id-index'
import { fetchSymbology } from '../scryfall'
import {
  getBannedPrintings,
  getDefaultCurrency,
  getDefaultLanguage,
  getSearchDebounceMs,
  getSiteSelectionConfig,
  getSiteSellMode,
  getUiLocale,
  loadRitualConfig,
  type RitualConfig,
} from '../ritual-config'
import {
  detailBuylistContext,
  getCardKingdomFeed,
  type LoadedCardKingdomFeed,
} from '../cardkingdom'
import { compareData } from '../i18n/collate'
import { isLocaleTagError, parseLocaleTag } from '../i18n/locale-tag'
import { DEFAULT_LOCALE } from '../i18n/runtime'
import type { LocaleTag } from '../i18n/types'
import { dirForType } from '../resolve-list'
import { enumerateSources } from './lists'
import { deckCardNames, flatListCardNames } from '../site/details/card-names'
import { loadDeckSource, buildDeckArtifacts } from '../site/details/deck'
import { loadCollectionSource, buildCollectionArtifacts } from '../site/details/collection'
import { loadWantedSource, buildWantedArtifacts } from '../site/details/wanted'
import type { SiteDetailContext } from '../site/details/types'
import { createCacheCardSource } from './card-source'
import type {
  CollectionSummary,
  DeckSummary,
  SiteIndex,
  WantedListSummary,
} from '../site/data-types'
import type { ListType } from '../list-type'
import { VALID_CURRENCIES } from '../price-currency'
import type { PriceCurrency } from '../price-currency'

/** A ready-to-serve JSON payload with its HTTP caching metadata. */
export type LiveJson = {
  body: string
  etag: string
  lastModified: string
}

/**
 * Computes the public site's JSON payloads (index + per-list details) from the
 * markdown files on request, so admin/CLI edits appear without a rebuild.
 * Payloads use the exact shapes `build-site` bakes, memoized per list on the
 * list file's mtime, its changelog sidecar's mtime, the card cache generation,
 * and the relevant config slice.
 */
export interface LiveSiteData {
  getIndex(): Promise<LiveJson>
  getDetail(kind: ListType, slug: string): Promise<LiveJson | null>
}

/** What the live payloads need to know about the tree they are served from. */
export type LiveSiteDataOptions = {
  /**
   * The published site directory. Only the locale dictionaries are read from
   * it: `availableLocales` must describe the files the browser can actually
   * fetch, which is whatever the last build wrote into `dist/locales/`, not
   * what this binary happens to carry.
   */
  distDir?: string
}

/** All three currencies are always served live (build-site's default set). */
const LIVE_CURRENCIES: PriceCurrency[] = [...VALID_CURRENCIES]

type ListStamp = {
  listMtimeMs: number
  changesMtimeMs: number
  generation: number
  configStamp: string
}

type ListSummary = DeckSummary | CollectionSummary | WantedListSummary

type BuiltList = {
  slug: string
  summary: ListSummary
  detail: LiveJson
  stamp: ListStamp
}

async function statMtimeMs(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath)
    return stat.mtimeMs
  } catch {
    return 0
  }
}

function stampsEqual(a: ListStamp, b: ListStamp): boolean {
  return (
    a.listMtimeMs === b.listMtimeMs &&
    a.changesMtimeMs === b.changesMtimeMs &&
    a.generation === b.generation &&
    a.configStamp === b.configStamp
  )
}

function etagFor(body: string): string {
  return `"${Bun.hash(body).toString(16)}"`
}

/** Lines the parsers cannot read (malformed cards, prose) are skipped; say so in the server log rather than silently. */
function logParseWarnings(kind: ListType, basename: string, warnings: readonly string[]): void {
  for (const warning of warnings) {
    console.warn(`[${kind}:${basename}] ${warning}`)
  }
}

/**
 * The locales the served tree has dictionaries for, English first.
 *
 * Read from disk on every index request rather than memoized: a rebuild into
 * the same directory can add or remove languages under a running server, and
 * one `readdir` is noise next to the per-list stats the same request already
 * does.
 */
async function publishedLocales(distDir: string | undefined): Promise<LocaleTag[]> {
  if (distDir === undefined) return [DEFAULT_LOCALE]
  let entries: string[]
  try {
    entries = await fs.readdir(path.join(distDir, 'locales'))
  } catch {
    return [DEFAULT_LOCALE]
  }
  const tags: LocaleTag[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const tag = parseLocaleTag(name.slice(0, -'.json'.length))
    if (isLocaleTagError(tag) || tag === DEFAULT_LOCALE) continue
    tags.push(tag)
  }
  tags.sort(compareData)
  return [DEFAULT_LOCALE, ...tags]
}

export function createLiveSiteData(options: LiveSiteDataOptions = {}): LiveSiteData {
  const listMemo = new Map<string, BuiltList>()
  // slug lookup for details, refreshed by every index enumeration.
  const slugMap = new Map<string, BuiltList>()
  let symbolMapPromise: Promise<Record<string, string>> | null = null
  let generation = 0
  let lastCacheFileMtimeMs = -1
  let pricesDate = new Date(0).toISOString()
  /** The feed the current pass bakes quotes from; null when sell mode is off or none is cached. */
  let buylistFeed: LoadedCardKingdomFeed | null = null

  function getSymbolMap(): Promise<Record<string, string>> {
    // Fetched once per server lifetime (disk-cached in cache/symbology.json);
    // maps to Scryfall's remote svg URIs so live payloads are self-contained.
    symbolMapPromise ??= fetchSymbology().then((symbols) => {
      const map: Record<string, string> = {}
      for (const s of symbols) {
        map[s.symbol] = s.svg_uri
      }
      return map
    })
    return symbolMapPromise
  }

  /**
   * Advance the cache generation. Only index requests pay this cost: details
   * reuse the last-known generation, bounding full cache-file reloads (which
   * follow an invalidate) to index navigations.
   */
  async function refreshGeneration(): Promise<void> {
    if (getCacheServerBaseUrl()) {
      const refreshedAt = (await cardCache.getLastRefreshedAt()) ?? 0
      // A shared cache server refreshing behind us stales the id index the same
      // way a local cache-file rewrite does.
      if (refreshedAt !== generation) scryfallIdIndex.reset()
      generation = refreshedAt
      pricesDate = new Date(generation > 0 ? generation : Date.now()).toISOString()
      return
    }
    const mtimeMs = await statMtimeMs(getCacheFile())
    if (mtimeMs !== lastCacheFileMtimeMs) {
      lastCacheFileMtimeMs = mtimeMs
      // A separate CLI process may have refreshed the cache; drop the memos so
      // the next read sees the new contents.
      cardCache.invalidate()
      scryfallIdIndex.reset()
    }
    generation = mtimeMs
    const lastRefreshed = await cardCache.getLastRefreshedAt()
    pricesDate = new Date(lastRefreshed ?? (mtimeMs > 0 ? mtimeMs : Date.now())).toISOString()
  }

  /**
   * Point {@link buylistFeed} at the cached buyer feed for this pass and report
   * its identity for the memo stamp. Reads the process memo, which re-parses
   * only when the cache file's mtime/size moved — so an out-of-band
   * `ritual sell --refresh` (or `POST /api/sell/refresh`) is picked up here, and
   * the changed stamp rebuilds every list's baked quotes.
   *
   * @returns When the feed in use was downloaded, or null when there is none.
   */
  async function refreshBuylistFeed(config: RitualConfig): Promise<number | null> {
    buylistFeed = getSiteSellMode(config) ? await getCardKingdomFeed() : null
    return buylistFeed?.file.retrievedAt ?? null
  }

  function configStampFor(config: RitualConfig, buylistRetrievedAt: number | null): string {
    return JSON.stringify({
      defaultCurrency: getDefaultCurrency(config),
      bannedPrintings: [...getBannedPrintings(config)].sort(),
      searchDebounceMs: getSearchDebounceMs(config),
      defaultLanguage: getDefaultLanguage(config),
      // Every field the index payload reads from config has to be here, or a
      // `config set` of it is invisible until some unrelated file's mtime moves
      // — the failure mode this allowlist exists to make reviewable.
      uiLocale: getUiLocale(config),
      selection: getSiteSelectionConfig(config.site),
      sellMode: getSiteSellMode(config),
      // Not config, but it lands in the same payloads: details carry baked
      // buylist quotes, so a refreshed buyer feed has to invalidate them too.
      // `null` (no feed, or sell mode off) serializes as distinctly as any
      // download time does.
      buylist: buylistRetrievedAt,
    })
  }

  async function makeContext(
    names: readonly string[],
    config: RitualConfig,
  ): Promise<SiteDetailContext> {
    const bannedPrintings = getBannedPrintings(config)
    const source = await createCacheCardSource(names, {
      currencies: LIVE_CURRENCIES,
      bannedPrintings,
    })
    const configuredCurrency = getDefaultCurrency(config)
    return {
      cardData: source.cardData,
      resolveCardName: source.resolveCardName,
      getPrintings: source.getPrintings,
      bannedPrintings,
      symbolMap: await getSymbolMap(),
      useScryfallImgUrls: true,
      defaultCurrency: configuredCurrency,
      availableCurrencies: LIVE_CURRENCIES,
      pricesDate,
      // Quotes are baked into the detail here exactly as `build-site` bakes
      // them, so the site's sell mode reads one shape in both modes and never
      // calls the quotes API. Absent feed (or sell mode off) = no baked field.
      ...(buylistFeed ? { buylist: detailBuylistContext(buylistFeed) } : {}),
      // Surface data-quality warnings (e.g. an unresolvable printing) in the
      // server log, matching what build-site prints for the same condition.
      warn: (message) => console.warn(message),
    }
  }

  async function getOrBuildList(
    kind: ListType,
    basename: string,
    config: RitualConfig,
    configStamp: string,
  ): Promise<BuiltList | null> {
    const dir = dirForType(kind, config)
    const fileName = basename.endsWith('.md') ? basename : `${basename}.md`
    const listMtimeMs = await statMtimeMs(path.join(dir, fileName))
    if (listMtimeMs === 0) return null
    const changesMtimeMs = await statMtimeMs(
      path.join(dir, `${fileName.slice(0, -'.md'.length)}.changes.md`),
    )
    const stamp: ListStamp = { listMtimeMs, changesMtimeMs, generation, configStamp }

    const key = `${kind}:${basename}`
    const memoized = listMemo.get(key)
    if (memoized && stampsEqual(memoized.stamp, stamp)) return memoized

    let slug: string
    let summary: ListSummary
    let detailBody: string
    if (kind === 'deck') {
      const loaded = await loadDeckSource(dir, basename)
      if (typeof loaded === 'string') return null
      logParseWarnings(kind, basename, loaded.warnings)
      const ctx = await makeContext(await deckCardNames(loaded), config)
      const artifacts = await buildDeckArtifacts(loaded, ctx)
      slug = artifacts.slug
      summary = artifacts.summary
      detailBody = JSON.stringify(artifacts.detail)
    } else if (kind === 'collection') {
      const loaded = await loadCollectionSource(dir, basename)
      if (typeof loaded === 'string' || loaded.entries.length === 0) return null
      logParseWarnings(kind, basename, loaded.warnings)
      const ctx = await makeContext(await flatListCardNames(loaded), config)
      const artifacts = await buildCollectionArtifacts(loaded, ctx)
      slug = artifacts.slug
      summary = artifacts.summary
      detailBody = JSON.stringify(artifacts.detail)
    } else {
      const loaded = await loadWantedSource(dir, basename)
      if (typeof loaded === 'string' || loaded.entries.length === 0) return null
      logParseWarnings(kind, basename, loaded.warnings)
      const ctx = await makeContext(await flatListCardNames(loaded), config)
      const artifacts = await buildWantedArtifacts(loaded, ctx)
      slug = artifacts.slug
      summary = artifacts.summary
      detailBody = JSON.stringify(artifacts.detail)
    }

    const built: BuiltList = {
      slug,
      summary,
      detail: {
        body: detailBody,
        etag: etagFor(detailBody),
        lastModified: new Date(Math.max(listMtimeMs, changesMtimeMs)).toUTCString(),
      },
      stamp,
    }
    listMemo.set(key, built)
    return built
  }

  async function getIndex(): Promise<LiveJson> {
    const config = await loadRitualConfig()
    await refreshGeneration()
    const configStamp = configStampFor(config, await refreshBuylistFeed(config))

    slugMap.clear()
    const decks: DeckSummary[] = []
    const collections: CollectionSummary[] = []
    const wantedLists: WantedListSummary[] = []
    // The single cast: getOrBuildList unifies the three kinds behind
    // ListSummary, but each call here only ever produces its own kind's shape.
    const collect = async <T extends ListSummary>(kind: ListType, into: T[]): Promise<void> => {
      for (const basename of await enumerateSources(kind, config)) {
        const built = await getOrBuildList(kind, basename, config, configStamp)
        if (!built) continue
        into.push(built.summary as T)
        slugMap.set(`${kind}:${built.slug}`, built)
      }
    }
    await collect('deck', decks)
    await collect('collection', collections)
    await collect('wanted', wantedLists)

    const configuredCurrency = getDefaultCurrency(config)
    const index: SiteIndex = {
      decks,
      collections,
      wantedLists: wantedLists.length > 0 ? wantedLists : undefined,
      useScryfallImgUrls: true,
      defaultCurrency: configuredCurrency,
      availableCurrencies: LIVE_CURRENCIES,
      pricesDate,
      searchDebounceMs: getSearchDebounceMs(config),
      defaultLanguage: getDefaultLanguage(config),
      uiLocale: getUiLocale(config),
      availableLocales: await publishedLocales(options.distDir),
      // Same-origin marker: this payload is only ever served by `serve --api`.
      apiBaseUrl: '',
      sellMode: getSiteSellMode(config),
    }
    const body = JSON.stringify(index)
    const newestMtime = [...listMemo.values()].reduce(
      (max, built) => Math.max(max, built.stamp.listMtimeMs, built.stamp.changesMtimeMs),
      0,
    )
    return {
      body,
      etag: etagFor(body),
      lastModified: new Date(newestMtime > 0 ? newestMtime : Date.now()).toUTCString(),
    }
  }

  async function getDetail(kind: ListType, slug: string): Promise<LiveJson | null> {
    // Refresh the enumeration (and each list's memo) so the slug lookup sees
    // current selection config, files, and content.
    await getIndex()
    return slugMap.get(`${kind}:${slug}`)?.detail ?? null
  }

  return { getIndex, getDetail }
}
