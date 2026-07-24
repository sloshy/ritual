import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../cache'
import { getCacheFile } from '../cache/file-cache'
import { getCacheServerBaseUrl } from '../cache/config'
import { scryfallIdIndex } from '../cache/scryfall-id-index'
import { fetchSymbology } from '../scryfall'
import {
  getBannedPrintings,
  getCollectionsDir,
  getDecksDir,
  getDefaultCurrency,
  getSearchDebounceMs,
  getSiteSelectionConfig,
  getWantedDir,
  loadRitualConfig,
  type RitualConfig,
} from '../ritual-config'
import { resolveDeckSources, resolveListSources } from '../site/list-sources'
import { loadDeckSource, buildDeckArtifacts, type LoadedDeck } from '../site/details/deck'
import { loadCollectionSource, buildCollectionArtifacts } from '../site/details/collection'
import { loadWantedSource, buildWantedArtifacts } from '../site/details/wanted'
import type { SiteDetailContext } from '../site/details/types'
import { extractPrimerCardNames } from '../primer-parser'
import { extractChangelogCardNames } from '../changelog-parser'
import { isNoEntryError } from '../ensure-card-ids'
import { getErrorMessage } from '../errors'
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

function listDir(kind: ListType, config: RitualConfig): string {
  if (kind === 'deck') return getDecksDir(config)
  if (kind === 'collection') return getCollectionsDir(config)
  return getWantedDir(config)
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

/** Malformed lines are skipped by the parsers; say so in the server log rather than silently. */
function logParseWarnings(kind: ListType, basename: string, warnings: readonly string[]): void {
  for (const warning of warnings) {
    console.warn(`[${kind}:${basename}] ${warning}`)
  }
}

export function createLiveSiteData(): LiveSiteData {
  const listMemo = new Map<string, BuiltList>()
  // slug lookup for details, refreshed by every index enumeration.
  const slugMap = new Map<string, BuiltList>()
  let symbolMapPromise: Promise<Record<string, string>> | null = null
  let generation = 0
  let lastCacheFileMtimeMs = -1
  let pricesDate = new Date(0).toISOString()

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

  function configStampFor(config: RitualConfig): string {
    return JSON.stringify({
      defaultCurrency: getDefaultCurrency(config),
      bannedPrintings: [...getBannedPrintings(config)].sort(),
      searchDebounceMs: getSearchDebounceMs(config),
      selection: getSiteSelectionConfig(config.site),
    })
  }

  async function collectDeckNames(loaded: LoadedDeck): Promise<string[]> {
    const names: string[] = []
    loaded.data.sections.forEach((s) => s.cards.forEach((c) => names.push(c.name)))
    if (loaded.data.primer) {
      for (const name of extractPrimerCardNames(loaded.data.primer)) {
        names.push((await cardCache.resolveCardName(name.toLowerCase())) ?? name)
      }
    }
    for (const name of extractChangelogCardNames(loaded.changelog)) {
      names.push((await cardCache.resolveCardName(name.toLowerCase())) ?? name)
    }
    return names
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
    const dir = listDir(kind, config)
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
      const ctx = await makeContext(await collectDeckNames(loaded), config)
      const artifacts = await buildDeckArtifacts(loaded, ctx)
      slug = artifacts.slug
      summary = artifacts.summary
      detailBody = JSON.stringify(artifacts.detail)
    } else if (kind === 'collection') {
      const loaded = await loadCollectionSource(dir, basename)
      if (typeof loaded === 'string' || loaded.entries.length === 0) return null
      logParseWarnings(kind, basename, loaded.warnings)
      const ctx = await makeContext(
        loaded.entries.map((entry) => entry.name),
        config,
      )
      const artifacts = await buildCollectionArtifacts(loaded, ctx)
      slug = artifacts.slug
      summary = artifacts.summary
      detailBody = JSON.stringify(artifacts.detail)
    } else {
      const loaded = await loadWantedSource(dir, basename)
      if (typeof loaded === 'string' || loaded.entries.length === 0) return null
      logParseWarnings(kind, basename, loaded.warnings)
      const ctx = await makeContext(
        loaded.entries.map((entry) => entry.name),
        config,
      )
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

  async function enumerate(kind: ListType, config: RitualConfig): Promise<string[]> {
    const selection = getSiteSelectionConfig(config.site)
    try {
      if (kind === 'deck') {
        return await resolveDeckSources(
          listDir(kind, config),
          selection.includeDecks,
          selection.excludeDecks,
        )
      }
      if (kind === 'collection') {
        return await resolveListSources(
          listDir(kind, config),
          selection.includeCollections,
          selection.excludeCollections,
        )
      }
      return await resolveListSources(
        listDir(kind, config),
        selection.includeWantedLists,
        selection.excludeWantedLists,
      )
    } catch (e) {
      // A missing list directory is a normal empty category; anything else
      // (permissions, I/O) deserves a log line rather than a silent empty site.
      if (!isNoEntryError(e)) {
        console.warn(`Failed to enumerate ${kind} sources: ${getErrorMessage(e)}`)
      }
      return []
    }
  }

  async function getIndex(): Promise<LiveJson> {
    const config = await loadRitualConfig()
    await refreshGeneration()
    const configStamp = configStampFor(config)

    slugMap.clear()
    const decks: DeckSummary[] = []
    const collections: CollectionSummary[] = []
    const wantedLists: WantedListSummary[] = []
    // The single cast: getOrBuildList unifies the three kinds behind
    // ListSummary, but each call here only ever produces its own kind's shape.
    const collect = async <T extends ListSummary>(kind: ListType, into: T[]): Promise<void> => {
      for (const basename of await enumerate(kind, config)) {
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
      // Same-origin marker: this payload is only ever served by `serve --api`.
      apiBaseUrl: '',
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
