import fs from 'node:fs/promises'
import path from 'node:path'
import { artSidecarPath } from '../list/card-art'
import { cardCache } from '../cache'
import { getCacheFile } from '../cache/file-cache'
import { getCacheServerBaseUrl } from '../cache/config'
import { scryfallIdIndex } from '../cache/scryfall-id-index'
import { fetchSymbology } from '../scryfall'
import {
  getBannedPrintings,
  getDefaultCurrency,
  getDefaultLanguage,
  getPriceSources,
  getSearchDebounceMs,
  getSiteSelectionConfig,
  getSiteSellMode,
  getUiLocale,
  loadRitualConfig,
  wantsCardKingdomFeed,
  type RitualConfig,
} from '../config/ritual-config'
import { getCardKingdomFeed, siteBuylistContext, type LoadedCardKingdomFeed } from '../cardkingdom'
import { compareData } from '../i18n/collate'
import { isLocaleTagError, parseLocaleTag } from '../i18n/locale-tag'
import { DEFAULT_LOCALE } from '../i18n/runtime'
import type { LocaleTag } from '../i18n/types'
import { dirForType } from '../list/resolve-list'
import { enumerateSources } from './lists'
import { loadListSource } from '../site-build/lists'
import type { SiteDetailContext } from '../site-build/types'
import { buildSiteIndex } from '../site-build/write-shell'
import { createCacheCardSource } from './card-source'
import type {
  CollectionSummary,
  DeckSummary,
  ListSummary,
  WantedListSummary,
} from '../list/site-data'
import { t } from '../i18n/t'
import type { ListType } from '../list/list-type'
import { VALID_CURRENCIES } from '../pricing/price-currency'
import type { PriceCurrency } from '../pricing/price-currency'

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

export type LiveSiteDataOptions = {
  /**
   * The published site directory, read only for its locale dictionaries:
   * `availableLocales` must describe the files the browser can actually fetch.
   */
  distDir?: string
}

/** All three currencies are always served live (build-site's default set). */
const LIVE_CURRENCIES: PriceCurrency[] = [...VALID_CURRENCIES]

type ListStamp = {
  listMtimeMs: number
  changesMtimeMs: number
  /** mtime of the `.art.json` custom-art sidecar; 0 when the list has none. */
  artMtimeMs: number
  generation: number
  configStamp: string
}

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
    a.artMtimeMs === b.artMtimeMs &&
    a.generation === b.generation &&
    a.configStamp === b.configStamp
  )
}

function etagFor(body: string): string {
  return `"${Bun.hash(body).toString(16)}"`
}

/** Lines the parsers cannot read (malformed cards, prose) are skipped; say so in the server log rather than silently. */
function logListWarning(kind: ListType, basename: string, warning: string): void {
  console.warn(`[${kind}:${basename}] ${warning}`)
}

/**
 * The locales the served tree has dictionaries for, English first. Read on
 * every index request rather than memoized: a rebuild into the same directory
 * can add or remove languages under a running server.
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
  /** The feed the current pass bakes quotes from; null when nothing wants it (no sell mode, no cardkingdom price source) or none is cached. */
  let buylistFeed: LoadedCardKingdomFeed | null = null

  function getSymbolMap(): Promise<Record<string, string>> {
    // Once per server lifetime; Scryfall's remote svg URIs keep payloads self-contained.
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
    buylistFeed = wantsCardKingdomFeed(config) ? await getCardKingdomFeed() : null
    return buylistFeed?.file.retrievedAt ?? null
  }

  function configStampFor(config: RitualConfig, buylistRetrievedAt: number | null): string {
    return JSON.stringify({
      defaultCurrency: getDefaultCurrency(config),
      bannedPrintings: [...getBannedPrintings(config)].sort(),
      searchDebounceMs: getSearchDebounceMs(config),
      defaultLanguage: getDefaultLanguage(config),
      // Every config field the payloads read has to be here, or a `config set`
      // of it is invisible until some unrelated file's mtime moves.
      uiLocale: getUiLocale(config),
      selection: getSiteSelectionConfig(config.site),
      sellMode: getSiteSellMode(config),
      priceSources: getPriceSources(config),
      // Not config, but details carry baked buylist quotes, so a refreshed
      // buyer feed has to invalidate them too. `null` = no feed, or sell mode off.
      buylist: buylistRetrievedAt,
    })
  }

  async function makeContext(
    names: readonly string[],
    config: RitualConfig,
  ): Promise<SiteDetailContext> {
    const bannedPrintings = getBannedPrintings(config)
    const buylist = siteBuylistContext(buylistFeed, config)
    const source = await createCacheCardSource(names, {
      currencies: LIVE_CURRENCIES,
      bannedPrintings,
      ...(buylist?.quotePrintings ? { cardKingdomQuote: buylist.quote } : {}),
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
      // Baked exactly as `build-site` bakes them, so sell mode reads one shape
      // in both modes. Absent feed (or sell mode off) = no baked field.
      ...(buylist ? { buylist } : {}),
      // No `missingArtFiles`: nothing is deployed here, so every custom-art
      // reference is baked as `art/<relpath>` and answered live by `/art/*`.
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
    const listFilePath = path.join(dir, fileName)
    const listMtimeMs = await statMtimeMs(listFilePath)
    if (listMtimeMs === 0) return null
    const changesMtimeMs = await statMtimeMs(
      path.join(dir, `${fileName.slice(0, -'.md'.length)}.changes.md`),
    )
    // Custom art is list metadata carried by its own sidecar, so a change to it
    // moves no other file's mtime — without this the detail would keep its
    // previously baked art until the list itself was edited.
    const artMtimeMs = await statMtimeMs(artSidecarPath(listFilePath))
    const stamp: ListStamp = {
      listMtimeMs,
      changesMtimeMs,
      artMtimeMs,
      generation,
      configStamp,
    }

    const key = `${kind}:${basename}`
    const memoized = listMemo.get(key)
    if (memoized && stampsEqual(memoized.stamp, stamp)) return memoized

    const list = await loadListSource(kind, dir, basename)
    if (typeof list === 'string') return null
    for (const warning of list.warnings) logListWarning(kind, basename, warning)
    // The same rule as the build: an empty flat list is skipped, and said so.
    if (list.isEmpty) {
      logListWarning(kind, basename, t('cli.buildSite.noValidEntries', { name: list.name }))
      return null
    }
    const { slug, summary, detail } = await list.build(
      await makeContext(await list.cardNames(), config),
    )
    const detailBody = JSON.stringify(detail)

    const built: BuiltList = {
      slug,
      summary,
      detail: {
        body: detailBody,
        etag: etagFor(detailBody),
        lastModified: new Date(Math.max(listMtimeMs, changesMtimeMs, artMtimeMs)).toUTCString(),
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

    const index = buildSiteIndex(
      {
        decks,
        collections,
        wantedLists,
        useScryfallImgUrls: true,
        defaultCurrency: getDefaultCurrency(config),
        availableCurrencies: LIVE_CURRENCIES,
        pricesDate,
        uiLocale: getUiLocale(config),
        availableLocales: await publishedLocales(options.distDir),
        // Same-origin marker: this payload is only ever served by `serve --api`.
        apiBaseUrl: '',
      },
      config,
    )
    const body = JSON.stringify(index)
    // Every file the payloads are built from, art sidecars included — the index
    // carries each list's totals, and those move when custom art is set or
    // cleared. Matches the per-detail `lastModified` below it.
    const newestMtime = [...listMemo.values()].reduce(
      (max, built) =>
        Math.max(max, built.stamp.listMtimeMs, built.stamp.changesMtimeMs, built.stamp.artMtimeMs),
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
