import { refreshCardCache } from '../cache/refresh-source'
import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { resolveDeckSources, resolveListSources } from '../site/list-sources'
import {
  fetchCardData,
  downloadImage,
  getCardPrintings,
  fetchRepresentativePrints,
  computeRepresentativePrints,
  fetchSymbology,
  downloadSymbol,
  downloadTagIndex,
  refreshTags,
  attachTags,
} from '../scryfall'
import { cardCache, ensureCacheForCards } from '../cache'
import { isRunningFromSource } from '../runtime'
import type { ScryfallCard } from '../types'
import { extractPrimerCardNames } from '../primer-parser'
import { extractChangelogCardNames } from '../changelog-parser'
import { resolveOutDir } from '../site/dist-dir'
import {
  getBannedPrintings,
  getCollectionsDir,
  getDecksDir,
  getDefaultCurrency,
  getRitualConfig,
  getSearchDebounceMs,
  getSiteApiBaseUrl,
  getSiteSelectionConfig,
  getWantedDir,
} from '../ritual-config'
import type {
  DeckSummary,
  CollectionSummary,
  WantedListSummary,
  SiteIndex,
} from '../site/data-types'
import { fetchDeckFromUrl } from '../importers/url-dispatch'
import { loadDeckSource, buildDeckArtifacts, type LoadedDeck } from '../site/details/deck'
import { loadCollectionSource, buildCollectionArtifacts } from '../site/details/collection'
import { loadWantedSource, buildWantedArtifacts } from '../site/details/wanted'
import type { SiteCardData, SiteDetailContext } from '../site/details/types'
import { parseWantedListFile } from './wanted-helpers'
import { parseCurrenciesFlag } from '../price-currency'
import type { PriceCurrency } from '../price-currency'
import { getErrorMessage } from '../errors'
import type { CacheManager } from '../interfaces'
import { PRICE_MAX_AGE_MS, BULK_FETCH_THRESHOLD } from '../cache/constants'
import {
  generateAllThemesCss,
  generateCustomThemeCss,
  isThemeName,
  parseCustomTheme,
  resolveThemeName,
  themeBootstrapScript,
  themeNames,
  type CustomTheme,
} from '../themes'
import { ExitCode } from './scripting'
import {
  addRefreshOption,
  bulkAllowed,
  refreshStaleAllowed,
  shouldBulkRefresh,
  type RefreshMode,
} from '../refresh'

export interface BuildSiteOptions {
  verbose?: boolean
  cacheImages?: boolean
  decks?: string[]
  collections?: string[]
  wantedLists?: string[]
  currencies?: string
  refresh?: RefreshMode
  theme?: string
  themeFile?: string[]
  moxfieldUserAgent?: string
  /**
   * Publish into this directory instead of `dist/`. A relative path resolves
   * against the Ritual base directory. The admin build route uses it to build
   * into a scratch directory it then swaps into place atomically.
   */
  outDir?: string
}

export type SiteSpaAssets = {
  appSvg: string
  stylesSourceCss: string
  appJs: string
}

async function buildSiteSpaFromSource(): Promise<SiteSpaAssets> {
  const { SolidPlugin } = await import('@dschz/bun-plugin-solid')
  const srcDir = path.join(import.meta.dir, '..', '..', 'src')
  const siteSrcDir = path.join(srcDir, 'site')
  const appSvgPath = path.join(import.meta.dir, '..', '..', 'app.svg')

  const jsResult = await Bun.build({
    entrypoints: [path.join(siteSrcDir, 'app.tsx')],
    target: 'browser',
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [SolidPlugin()],
  })
  if (!jsResult.success) {
    for (const log of jsResult.logs) console.error(log)
    throw new Error('Site SPA JS build failed')
  }
  const jsOutput = jsResult.outputs.find((o) => o.path.endsWith('.js'))
  if (!jsOutput) throw new Error('Site SPA JS build produced no .js output')
  const appJs = await jsOutput.text()

  const cssResult = await Bun.build({
    entrypoints: [path.join(siteSrcDir, 'styles.css')],
    target: 'browser',
    minify: false,
  })
  if (!cssResult.success) {
    for (const log of cssResult.logs) console.error(log)
    throw new Error('Site SPA CSS build failed')
  }
  const cssOutput = cssResult.outputs.find((o) => o.path.endsWith('.css'))
  if (!cssOutput) throw new Error('Site SPA CSS build produced no .css output')
  const stylesSourceCss = await cssOutput.text()

  const appSvg = await fs.readFile(appSvgPath, 'utf-8')

  return { appSvg, stylesSourceCss, appJs }
}

/** Loads every `--theme-file` JSON; returns an error message string on the first failure. */
async function loadCustomThemes(paths: readonly string[]): Promise<CustomTheme[] | string> {
  const themes: CustomTheme[] = []
  for (const filePath of paths) {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      return `Failed to read --theme-file '${filePath}': ${getErrorMessage(err)}`
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      return `--theme-file '${filePath}' is not valid JSON: ${getErrorMessage(err)}`
    }
    const result = parseCustomTheme(parsed)
    if (typeof result === 'string') {
      return `--theme-file '${filePath}': ${result}`
    }
    themes.push(result)
  }
  return themes
}

async function checkAndOfferBulkPriceRefresh(
  uniqueCards: string[],
  totalCards: number,
  cardCache: CacheManager<ScryfallCard[]>,
  lastBulkRefresh: number | null | undefined,
  cacheJustRefreshed: boolean,
  mode: RefreshMode,
): Promise<void> {
  if (!bulkAllowed(mode)) return

  const bulkCacheIsRecent =
    cacheJustRefreshed ||
    (lastBulkRefresh != null && Date.now() - lastBulkRefresh < PRICE_MAX_AGE_MS)
  if (bulkCacheIsRecent) return

  let stalePriceCount = 0
  for (const name of uniqueCards) {
    if (await cardCache.isBlocked?.(name)) continue
    const timestamp = await cardCache.getTimestamp?.(name)
    if (timestamp == null || Date.now() - timestamp >= PRICE_MAX_AGE_MS) {
      stalePriceCount++
    }
  }

  if (stalePriceCount <= BULK_FETCH_THRESHOLD) return

  console.log(`\n${stalePriceCount} of ${totalCards} card(s) have prices older than 24 hours.`)
  console.log(
    `Redownloading the Scryfall bulk card cache (includes fresh prices) would be faster than refreshing each card individually.`,
  )

  const shouldPreload = await shouldBulkRefresh(mode, {
    message: 'Redownload the latest Scryfall card cache now?',
    initial: false,
  })

  if (shouldPreload) {
    // Best-effort warm: `refreshCardCache` propagates now, and a cold network
    // must not fail a build that can still run against the existing cache.
    try {
      await refreshCardCache()
    } catch (e) {
      console.error(
        `Card cache refresh failed; building with the existing cache. ${getErrorMessage(e)}`,
      )
    }
  }
}

export async function runBuildSite(options: BuildSiteOptions): Promise<void> {
  let availableCurrencies: PriceCurrency[]
  try {
    availableCurrencies = parseCurrenciesFlag(options.currencies)
  } catch (e) {
    console.error(getErrorMessage(e))
    process.exitCode = ExitCode.UsageError
    return
  }
  // The site opens in the configured default currency when it's built at all,
  // otherwise the first built currency.
  const configuredCurrency = getDefaultCurrency()
  const defaultCurrency = availableCurrencies.includes(configuredCurrency)
    ? configuredCurrency
    : availableCurrencies[0]!

  const customThemesResult = await loadCustomThemes(options.themeFile ?? [])
  if (typeof customThemesResult === 'string') {
    console.error(customThemesResult)
    process.exitCode = ExitCode.RuntimeError
    return
  }
  const customThemes = customThemesResult
  const customNames = new Set(customThemes.map((t) => t.name))
  // Open-ended type: either a built-in `ThemeName` or a custom name from
  // `--theme-file`. Both are validated here before use.
  let initialThemeName: string
  const rawTheme = (options.theme ?? 'default').toLowerCase()
  if (customNames.has(rawTheme)) {
    initialThemeName = rawTheme
  } else {
    // `resolveThemeName` returns an error message string for unknown names;
    // `isThemeName` is the runtime discriminator since both are strings.
    const resolved = resolveThemeName(options.theme)
    if (!isThemeName(resolved)) {
      console.error(resolved)
      process.exitCode = ExitCode.UsageError
      return
    }
    initialThemeName = resolved
  }

  const outDir = resolveOutDir(options.outDir)
  if (!outDir.ok) {
    console.error(outDir.error)
    process.exitCode = ExitCode.UsageError
    return
  }
  const distDir = outDir.dir
  const imagesDir = path.join(distDir, 'images')
  const decksDir = getDecksDir()
  // Which decks/collections/wanted lists are published. CLI flags override this
  // per category; otherwise the `site` config selection applies (default: all).
  const selection = getSiteSelectionConfig(getRitualConfig().site)
  // Lazy import: keeps `.compiled.{js,css}` text imports out of the source-mode
  // module graph (those files are gitignored). The path must stay a literal
  // string so `bun build --compile` can embed the module into the binary.
  const siteSpaAssets: SiteSpaAssets = isRunningFromSource()
    ? await buildSiteSpaFromSource()
    : (await import('../site/bundled-assets')).getBundledSiteAssets()
  const cacheImages = options.cacheImages === true
  const useScryfallImgUrls = !cacheImages

  const downloadCardImages = async (card: ScryfallCard, imgDir: string) => {
    if (card.image_uris?.normal) {
      await downloadImage(card.image_uris.normal, path.join(imgDir, `${card.id}.jpg`))
    } else if (card.card_faces && card.card_faces[0]) {
      if (card.card_faces[0].image_uris?.normal) {
        await downloadImage(
          card.card_faces[0].image_uris.normal,
          path.join(imgDir, `${card.id}.jpg`),
        )
      }
      if (card.card_faces[1]?.image_uris?.normal) {
        await downloadImage(
          card.card_faces[1].image_uris.normal,
          path.join(imgDir, `${card.id}_back.jpg`),
        )
      }
    }
  }

  let deckSources: string[]
  if (options.decks && Array.isArray(options.decks) && options.decks.length > 0) {
    deckSources = options.decks
  } else {
    // No --decks flag: build the decks allowed by `site.includeDecks` (default: all)
    try {
      deckSources = await resolveDeckSources(
        decksDir,
        selection.includeDecks,
        selection.excludeDecks,
      )
      if (deckSources.length > 0) {
        console.log(`Found ${deckSources.length} decks: ${deckSources.join(', ')}`)
      }
    } catch (e) {
      console.error('Failed to read decks directory:', getErrorMessage(e))
      process.exitCode = ExitCode.RuntimeError
      return
    }
  }

  console.log('Building static site...')
  if (cacheImages) {
    console.log('Caching deck card images locally and using dist/images paths.')
  } else {
    console.log('Using Scryfall image URLs from card data and skipping deck image downloads.')
  }

  await fs.rm(distDir, { recursive: true, force: true })
  await fs.mkdir(imagesDir, { recursive: true })
  const symbolsDir = path.join(imagesDir, 'symbols')
  await fs.mkdir(symbolsDir, { recursive: true })
  await Bun.write(path.join(distDir, 'app.svg'), siteSpaAssets.appSvg)

  // Fetch and download symbols
  console.log('Fetching and downloading mana symbols...')
  let symbols = await fetchSymbology()
  const symbolMap: Record<string, string> = {} // { "{W}": "images/symbols/W.svg" }
  const missingSymbols = new Set<string>()

  const updateSymbolMap = async () => {
    await Promise.all(
      symbols.map(async (s) => {
        if (symbolMap[s.symbol]) return
        try {
          const filename = await downloadSymbol(s, symbolsDir)
          symbolMap[s.symbol] = `images/symbols/${filename}`
        } catch (e) {
          console.error(`Failed to download symbol ${s.symbol}:`, e)
        }
      }),
    )
  }

  await updateSymbolMap()

  const ensureSymbols = async (text: string | undefined | null) => {
    if (!text) return
    const matches = text.match(/\{[^{}]+\}/g)
    if (!matches) return

    let needsRefresh = false
    for (const m of matches) {
      if (!symbolMap[m] && !missingSymbols.has(m)) {
        needsRefresh = true
        break
      }
    }

    if (needsRefresh) {
      console.log('Found new symbols in text. Refreshing symbology...')
      symbols = await fetchSymbology(true)
      await updateSymbolMap()

      // Mark still-missing symbols as missing so we don't retry loop
      for (const m of matches) {
        if (!symbolMap[m]) {
          missingSymbols.add(m)
        }
      }
    }
  }

  const loadedDecks: LoadedDeck[] = []
  const globalCardMap: Record<string, ScryfallCard | null> = {}
  const globalPrintingsMap: Record<string, ScryfallCard[]> = {}
  const allCardNames = new Set<string>()
  const primerCardNames = new Set<string>()
  const changelogCardNames = new Set<string>()

  // Phase 1: Load Decks
  console.log('Loading decks...')
  for (const source of deckSources) {
    let loaded: LoadedDeck
    if (source.startsWith('http')) {
      let result: Awaited<ReturnType<typeof fetchDeckFromUrl>>
      try {
        result = await fetchDeckFromUrl(source, {
          moxfieldUserAgent: options.moxfieldUserAgent,
        })
      } catch (e) {
        console.error(`Failed to load deck '${source}':`, e)
        continue
      }
      if (typeof result === 'string') {
        console.error(`Failed to load deck '${source}': ${result}`)
        continue
      }
      loaded = { data: result, changelog: [], fileMtime: undefined }
    } else {
      const result = await loadDeckSource(decksDir, source)
      if (typeof result === 'string') {
        console.error(`Failed to load deck '${source}': ${result}`)
        continue
      }
      loaded = result
    }

    loadedDecks.push(loaded)
    console.log(`  - Loaded ${loaded.data.name}`)
    // Collect deck card names
    loaded.data.sections.forEach((s) => s.cards.forEach((c) => allCardNames.add(c.name)))
    // Collect card names referenced in the primer (for modal pre-fetching)
    if (loaded.data.primer) {
      for (const name of extractPrimerCardNames(loaded.data.primer)) {
        primerCardNames.add(name)
      }
    }
    // Collect card names referenced in the changelog
    for (const name of extractChangelogCardNames(loaded.changelog)) {
      changelogCardNames.add(name)
    }
  }

  // Resolve which wanted lists are published (CLI flag overrides `site` config,
  // default: all). Computed here so the pre-load below and Phase 5 stay in sync.
  const wantedListsSourceDir = getWantedDir()
  let wantedListSources: string[]
  if (options.wantedLists && options.wantedLists.length > 0) {
    wantedListSources = options.wantedLists
  } else {
    try {
      wantedListSources = await resolveListSources(
        wantedListsSourceDir,
        selection.includeWantedLists,
        selection.excludeWantedLists,
      )
    } catch {
      wantedListSources = [] // No wanted/ directory
    }
  }

  // Pre-load wanted list card names so they're fetched along with deck/collection cards
  for (const wlName of wantedListSources) {
    const fileName = wlName.endsWith('.md') ? wlName : `${wlName}.md`
    try {
      const wlContent = await fs.readFile(path.join(wantedListsSourceDir, fileName), 'utf-8')
      const { entries: wlEntries } = parseWantedListFile(wlContent)
      for (const entry of wlEntries) {
        allCardNames.add(entry.name)
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Phase 2: Fetch Cards with Progress Bar

  // Resolve primer card names to their canonical (proper-case) names via the cache index
  for (const name of primerCardNames) {
    const canonical = await cardCache.resolveCardName(name.toLowerCase())
    allCardNames.add(canonical ?? name)
  }

  // Resolve changelog card names (cards referenced in change history)
  for (const name of changelogCardNames) {
    const canonical = await cardCache.resolveCardName(name.toLowerCase())
    allCardNames.add(canonical ?? name)
  }

  // Purge expired blocklist entries before fetching
  await cardCache.purgeExpiredBlocklist()

  const uniqueCards = Array.from(allCardNames)
  const totalCards = uniqueCards.length
  console.log(`\nFound ${totalCards} unique cards.`)

  // How the cache refresh question is answered for this run (--refresh <mode>,
  // interactive by default).
  const mode = options.refresh ?? 'ask'

  // Ensure the full card cache has been bulk-downloaded at least once per week,
  // and trigger a bulk refresh if many cards are missing. Suppressed when bulk
  // downloads aren't permitted, leaving the per-card loop below to fill gaps.
  const { refreshed: cacheJustRefreshed } = await ensureCacheForCards(allCardNames, undefined, {
    allowBulk: bulkAllowed(mode),
  })

  // Collect missing card names (for verbose output and individual fetching)
  const missingCards: string[] = []
  for (const name of uniqueCards) {
    const cached = await cardCache.get(name)
    if (!cached) {
      missingCards.push(name)
    }
  }

  if (options.verbose) {
    if (missingCards.length > 0) {
      console.log(`Fetch List (${missingCards.length}):`)
      missingCards.forEach((c) => console.log(` - ${c}`))
    } else {
      console.log('All cards are cached.')
    }
  }

  const lastBulkRefresh = await cardCache.getLastRefreshedAt?.()
  await checkAndOfferBulkPriceRefresh(
    uniqueCards,
    totalCards,
    cardCache,
    lastBulkRefresh,
    cacheJustRefreshed,
    mode,
  )

  console.log('Fetching data...')

  const updateProgress = (current: number, total: number) => {
    const width = 30
    const percentage = total === 0 ? 100 : Math.round((current / total) * 100)
    const filled = total === 0 ? width : Math.round((width * current) / total)
    const empty = width - filled
    const bar = '█'.repeat(filled) + '░'.repeat(empty)
    process.stdout.write(`\r[${bar}] ${percentage}% (${current}/${total})`)
  }

  let processed = 0
  updateProgress(0, totalCards)

  const hasUsd = availableCurrencies.includes('usd')
  const hasEur = availableCurrencies.includes('eur')
  const hasTix = availableCurrencies.includes('tix')

  const globalCheapestCardMap: Record<string, ScryfallCard | null> = {}
  const globalCheapestCardMapEur: Record<string, ScryfallCard | null> = {}
  const globalCheapestCardMapTix: Record<string, ScryfallCard | null> = {}

  // Track cards missing prices per currency
  const globalMissingCards: Partial<Record<PriceCurrency, Set<string>>> = {}
  for (const cur of availableCurrencies) {
    globalMissingCards[cur] = new Set()
  }

  let latestPriceTimestamp: number | null =
    typeof lastBulkRefresh === 'number' ? lastBulkRefresh : null

  for (const name of uniqueCards) {
    if (await cardCache.isBlocked(name)) {
      processed++
      updateProgress(processed, totalCards)
      continue
    }
    if (!globalCardMap[name]) {
      const card = await fetchCardData(name, { silent: true })
      globalCardMap[name] = card

      const printings = await getCardPrintings(name)
      globalPrintingsMap[name] = printings

      // Use cached prices if they are less than one day old; otherwise fetch fresh from Scryfall
      const priceTimestamp = await cardCache.getTimestamp?.(name)
      const pricesFresh =
        priceTimestamp !== null &&
        priceTimestamp !== undefined &&
        Date.now() - priceTimestamp < PRICE_MAX_AGE_MS
      if (
        priceTimestamp != null &&
        (latestPriceTimestamp == null || priceTimestamp > latestPriceTimestamp)
      ) {
        latestPriceTimestamp = priceTimestamp
      }
      let repPrints
      if (pricesFresh || !refreshStaleAllowed(mode)) {
        // Use cached prices when they're fresh, or when --refresh never forbids
        // refetching merely-stale prices.
        const sortedPrintings = [...printings].sort((a, b) =>
          (b.released_at ?? '').localeCompare(a.released_at ?? ''),
        )
        repPrints = computeRepresentativePrints(
          sortedPrintings,
          sortedPrintings,
          availableCurrencies,
          getBannedPrintings(),
        )
      } else {
        // Fetch representative and cheapest print per requested currency (all pages via queue)
        repPrints = await fetchRepresentativePrints(name, availableCurrencies)
      }

      if (hasUsd) {
        const rep = repPrints.usd?.representative ?? null
        const cheap = repPrints.usd?.cheapest ?? null
        if (!rep) {
          globalMissingCards.usd!.add(name)
          console.warn(`⚠️  '${name}' has no USD pricing.`)
        } else {
          globalCardMap[name] = rep
        }
        globalCheapestCardMap[name] = cheap ?? rep ?? card
      }

      if (hasEur) {
        const rep = repPrints.eur?.representative ?? null
        const cheap = repPrints.eur?.cheapest ?? null
        if (!rep) {
          globalMissingCards.eur!.add(name)
          console.warn(`⚠️  '${name}' has no EUR pricing.`)
        }
        globalCheapestCardMapEur[name] = cheap ?? rep ?? card
      }

      if (hasTix) {
        const rep = repPrints.tix?.representative ?? null
        const cheap = repPrints.tix?.cheapest ?? null
        if (!rep) {
          globalMissingCards.tix!.add(name)
          console.warn(`⚠️  '${name}' has no TIX pricing.`)
        }
        globalCheapestCardMapTix[name] = cheap ?? rep ?? card
      }

      const effectiveCard = globalCardMap[name]
      if (effectiveCard) {
        await ensureSymbols(effectiveCard.mana_cost)
        await ensureSymbols(effectiveCard.oracle_text)

        if (cacheImages) {
          // Download images for the default card
          await downloadCardImages(effectiveCard, imagesDir)
        }
      }

      // Download images for representative price cards if different
      const repCards = [
        hasUsd ? globalCheapestCardMap[name] : null,
        hasEur ? globalCheapestCardMapEur[name] : null,
        hasTix ? globalCheapestCardMapTix[name] : null,
      ]
      const seenIds = new Set<string>()
      if (globalCardMap[name]?.id) seenIds.add(globalCardMap[name].id)
      for (const repCard of repCards) {
        if (repCard && !seenIds.has(repCard.id)) {
          seenIds.add(repCard.id)
          if (cacheImages) {
            await downloadCardImages(repCard, imagesDir)
          }
          await ensureSymbols(repCard.mana_cost)
          await ensureSymbols(repCard.oracle_text)
        }
      }
    }
    processed++
    updateProgress(processed, totalCards)
  }
  process.stdout.write('\n\n')

  // The site's tag filters need oracle/art tags on the cards. If none are present
  // (e.g. a cache populated before tags existed), fetch them now rather than
  // shipping empty filters — gated by the same refresh mode as the bulk download.
  const collectBuildCards = (): ScryfallCard[] => {
    const cards = new Set<ScryfallCard>()
    for (const map of [
      globalCardMap,
      globalCheapestCardMap,
      globalCheapestCardMapEur,
      globalCheapestCardMapTix,
    ]) {
      for (const card of Object.values(map)) if (card) cards.add(card)
    }
    for (const printings of Object.values(globalPrintingsMap)) {
      for (const card of printings) cards.add(card)
    }
    return [...cards]
  }
  const hasAnyTags = (cards: ScryfallCard[]): boolean =>
    cards.some((c) => (c.oracleTags?.length ?? 0) > 0 || (c.artTags?.length ?? 0) > 0)

  const buildCards = collectBuildCards()
  if (buildCards.length > 0 && !hasAnyTags(buildCards)) {
    const refresh = await shouldBulkRefresh(mode, {
      message:
        'The card cache has no oracle/art tags (used by the site’s tag filters). Download them now?',
      initial: true,
    })
    if (refresh) {
      console.log('Fetching oracle/art tags from Scryfall...')
      const tagIndex = await downloadTagIndex()
      if (tagIndex) {
        // Tag the cards headed for this build, then bake into the cache so future
        // builds and CLI features have them too (no re-download — reuse the index).
        for (const card of buildCards) attachTags(card, tagIndex)
        await refreshTags(tagIndex)
        console.log('Added oracle/art tags to the card cache.')
      } else {
        console.warn("Could not download tags; the site's tag filters will be empty.")
      }
    } else {
      console.log(
        "Skipping tag download; the site's tag filters will be empty. " +
          'Run `ritual cache refresh-tags` later to add them.',
      )
    }
  }

  if (latestPriceTimestamp == null) {
    throw new Error('No price data found. Run the cache refresh before building the site.')
  }
  const pricesDate = new Date(latestPriceTimestamp).toISOString()

  // Everything the detail builders need, closed over the prefetched maps above.
  const cardData: SiteCardData = {
    cards: globalCardMap,
    printings: globalPrintingsMap,
    cheapest: {
      ...(hasUsd ? { usd: globalCheapestCardMap } : {}),
      ...(hasEur ? { eur: globalCheapestCardMapEur } : {}),
      ...(hasTix ? { tix: globalCheapestCardMapTix } : {}),
    },
    missing: {},
  }
  for (const cur of availableCurrencies) {
    cardData.missing[cur] = Array.from(globalMissingCards[cur] ?? [])
  }
  const detailCtx: SiteDetailContext = {
    cardData,
    resolveCardName: (name) => cardCache.resolveCardName(name),
    getPrintings: (name) => getCardPrintings(name),
    bannedPrintings: getBannedPrintings(),
    symbolMap,
    useScryfallImgUrls,
    defaultCurrency,
    availableCurrencies,
    pricesDate,
    onCardShipped: async (card) => {
      await ensureSymbols(card.mana_cost)
      await ensureSymbols(card.oracle_text)
      if (cacheImages) {
        await downloadCardImages(card, imagesDir)
      }
    },
    warn: (message) => console.warn(message),
  }

  // Phase 3: Generate JSON data files and SPA bundle
  console.log('Generating data files...')
  const decksSummaries: DeckSummary[] = []
  const decksDataDir = path.join(distDir, 'decks')
  await fs.mkdir(decksDataDir, { recursive: true })

  for (const loaded of loadedDecks) {
    const { slug, detail, summary } = await buildDeckArtifacts(loaded, detailCtx)
    await Bun.write(path.join(decksDataDir, `${slug}.json`), JSON.stringify(detail))
    decksSummaries.push(summary)
  }

  // Phase 4: Load and process collections
  const collectionsDir = getCollectionsDir()
  const collectionsSummaries: CollectionSummary[] = []
  const collectionsDataDir = path.join(distDir, 'collections')
  await fs.mkdir(collectionsDataDir, { recursive: true })

  let collectionSources: string[] = []
  if (options.collections && Array.isArray(options.collections) && options.collections.length > 0) {
    collectionSources = options.collections
  } else {
    // No --collections flag: build the collections allowed by `site.includeCollections`
    try {
      collectionSources = await resolveListSources(
        collectionsDir,
        selection.includeCollections,
        selection.excludeCollections,
      )
      if (collectionSources.length > 0) {
        console.log(
          `Found ${collectionSources.length} collections: ${collectionSources.join(', ')}`,
        )
      }
    } catch {
      // No collections/ directory, skip silently
    }
  }

  if (collectionSources.length > 0) {
    console.log('Loading collections...')
  }

  for (const colName of collectionSources) {
    const loaded = await loadCollectionSource(collectionsDir, colName)
    if (typeof loaded === 'string') {
      console.error(loaded)
      continue
    }
    for (const w of loaded.warnings) {
      console.warn(`  ⚠️  ${w}`)
    }
    if (loaded.entries.length === 0) {
      console.log(`  ${colName}: no valid entries, skipping`)
      continue
    }

    const { slug, detail, summary } = await buildCollectionArtifacts(loaded, detailCtx)
    await Bun.write(path.join(collectionsDataDir, `${slug}.json`), JSON.stringify(detail))
    collectionsSummaries.push(summary)
    console.log(
      `  - Loaded ${summary.name} (${summary.cardCount} cards, $${summary.totalPrice.toFixed(2)})`,
    )
  }

  // Phase 5: Load and process wanted lists. The source list was resolved earlier
  // (alongside the card pre-load) so both stay in sync.
  const wantedListsSummaries: WantedListSummary[] = []
  const wantedListsDataDir = path.join(distDir, 'wanted')
  await fs.mkdir(wantedListsDataDir, { recursive: true })

  if (wantedListSources.length > 0) {
    console.log(`Found ${wantedListSources.length} wanted lists: ${wantedListSources.join(', ')}`)
    console.log('Loading wanted lists...')
  }

  for (const wlName of wantedListSources) {
    const loaded = await loadWantedSource(wantedListsSourceDir, wlName)
    if (typeof loaded === 'string') {
      console.error(loaded)
      continue
    }
    if (loaded.entries.length === 0) {
      console.log(`  ${wlName}: no valid entries, skipping`)
      continue
    }

    const { slug, detail, summary } = await buildWantedArtifacts(loaded, detailCtx)
    await Bun.write(path.join(wantedListsDataDir, `${slug}.json`), JSON.stringify(detail))
    wantedListsSummaries.push(summary)
    console.log(
      `  - Loaded ${summary.name} (${summary.cardCount} cards, $${summary.totalPrice.toFixed(2)})`,
    )
  }

  // Write index JSON
  const siteIndex: SiteIndex = {
    decks: decksSummaries,
    collections: collectionsSummaries,
    wantedLists: wantedListsSummaries.length > 0 ? wantedListsSummaries : undefined,
    useScryfallImgUrls,
    defaultCurrency,
    availableCurrencies,
    pricesDate,
    searchDebounceMs: getSearchDebounceMs(),
    // Present only for split deployments (static site on a CDN + separately
    // hosted `ritual serve --api`); `serve --api` itself serves index.json
    // dynamically and shadows this value with a same-origin marker.
    apiBaseUrl: getSiteApiBaseUrl(),
  }
  await Bun.write(path.join(distDir, 'index.json'), JSON.stringify(siteIndex))

  // Write pre-built SPA
  console.log('Writing Web App...')
  await Bun.write(path.join(distDir, 'app.js'), siteSpaAssets.appJs)

  // Defense-in-depth: theme names always pass through `resolveThemeName`
  // or `parseCustomTheme` which enforce safe identifier patterns, but
  // re-validate at the HTML interpolation site so a future refactor can't
  // silently introduce attribute-injection.
  const safeInitialTheme = /^[a-z0-9][a-z0-9-]*$/.test(initialThemeName)
    ? initialThemeName
    : 'default'
  const initialThemeAttr = safeInitialTheme === 'default' ? '' : ` data-theme="${safeInitialTheme}"`

  // Generate index.html shell
  const indexHtml = `<!DOCTYPE html>
<html lang="en"${initialThemeAttr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Ritual</title>
  <link rel="icon" type="image/svg+xml" href="app.svg">
  <script>${themeBootstrapScript}</script>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="app.js"></script>
</body>
</html>`
  await Bun.write(path.join(distDir, 'index.html'), indexHtml)

  // Write bundled CSS — emit every built-in theme as a `:root[data-theme=...]`
  // block so the runtime can switch by toggling the html attribute, plus
  // any custom themes from --theme-file.
  console.log(
    `Writing CSS (initial theme: ${initialThemeName}${
      customThemes.length > 0 ? `, +${customThemes.length} custom` : ''
    })...`,
  )
  const allThemes = generateAllThemesCss()
  const customThemesCss = customThemes.map((t) => generateCustomThemeCss(t)).join('\n')
  await Bun.write(
    path.join(distDir, 'styles.css'),
    `${allThemes}${customThemesCss ? '\n' + customThemesCss : ''}\n${siteSpaAssets.stylesSourceCss}`,
  )

  console.log(`Site generated in ${distDir}`)
}

/**
 * Register every commander option that maps to a {@link BuildSiteOptions} field.
 * Shared by `build-site` and `serve --build` so the two stay in sync.
 */
export function applyBuildSiteOptions(command: Command): Command {
  return addRefreshOption(command)
    .option('-v, --verbose', 'Show list of cards to be fetched')
    .option(
      '--cache-images',
      'Download and use local deck card images instead of Scryfall image URLs',
    )
    .option(
      '--decks [names...]',
      'Deck names or URLs to build (default: the site.includeDecks config selection)',
    )
    .option(
      '--collections [names...]',
      'Collection names to build (default: the site.includeCollections config selection)',
    )
    .option(
      '--wanted-lists [names...]',
      'Wanted list names to build (default: the site.includeWantedLists config selection)',
    )
    .option(
      '--currencies <list>',
      'Comma-separated currencies to include: usd, eur, tix (default: all three; first is default)',
    )
    .option(
      '--theme <name>',
      `Initial theme baked into the generated HTML (${themeNames.join(', ')}, or a custom theme name loaded via --theme-file)`,
      'default',
    )
    .option(
      '--theme-file <path...>',
      'Load one or more custom theme JSON files; their names become selectable alongside the built-ins',
    )
    .option(
      '--moxfield-user-agent <agent>',
      'Moxfield-approved unique User-Agent string (required for Moxfield deck URLs unless MOXFIELD_USER_AGENT is set)',
    )
    .option(
      '--out-dir <path>',
      'Build into this directory instead of dist/ — the directory is cleared before the build (relative paths resolve against the Ritual directory)',
    )
}

export function registerBuildSiteCommand(program: Command): void {
  applyBuildSiteOptions(
    program.command('build-site').description('Generate a static website for decks'),
  ).action(async (options: BuildSiteOptions) => {
    await runBuildSite(options)
  })
}
