import { refreshCardCache } from '../cache/refresh-source'
import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  resolveSourceSelection,
  type ListSourceEntry,
  type SourceSelection,
} from '../site/list-sources'
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
import { buildAndPublish } from '../site/publish'
import {
  getBannedPrintings,
  getCollectionsDir,
  getDecksDir,
  getDefaultCurrency,
  getRitualConfig,
  getSearchDebounceMs,
  getSiteApiBaseUrl,
  getSiteSellMode,
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
import { emptyCacheAdvice } from '../cache/freshness'
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
  /**
   * Selection flags are optional-variadic, so commander answers `true` for a
   * bare `--decks`; {@link selectionFlagNames} turns that into a usage error.
   */
  decks?: string[] | boolean
  collections?: string[] | boolean
  wantedLists?: string[] | boolean
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

/** How the three list categories are named in build output. */
type ListKind = 'deck' | 'collection' | 'wanted list'

/** A source the build asked for and could not use. */
type SkippedSource = {
  kind: ListKind
  /** The name as the user or the config selection spelled it. */
  name: string
  reason: string
  /** True when the name came from a `--decks`-style flag rather than discovery. */
  explicit: boolean
}

/** One list category's resolved selection, plus what to call it in messages. */
type SourceCategory = {
  kind: ListKind
  dir: string
  configKey: 'includeDecks' | 'includeCollections' | 'includeWantedLists'
  selection: SourceSelection
  /**
   * The selection's sources minus the ones discovery already found unreadable.
   * Filled in by the reporting pass below, and what every loader iterates.
   */
  buildable: ListSourceEntry[]
}

/** `3 decks` / `1 collection` — one pluralizer for every list-count message. */
function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Deck sources may be URLs; those are fetched rather than resolved to a file. */
function isDeckUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://')
}

/** What a selection flag parsed to: names (or none given), or a usage error. */
export type SelectionFlagResult =
  | { ok: true; names: string[] | undefined }
  | { ok: false; error: string }

/**
 * The names an optional-variadic selection flag carries.
 *
 * Commander gives `true` for a bare `--decks` with no values, which used to read
 * as "flag not given" and silently build the *whole* config selection — the
 * opposite of what an empty `--decks $NAMES` meant to say. Reports the usage
 * error as a discriminated result, so a caller cannot mistake the message for a
 * requested list name.
 */
export function selectionFlagNames(
  value: string[] | boolean | undefined,
  flag: string,
): SelectionFlagResult {
  if (value === undefined || value === false) return { ok: true, names: undefined }
  if (value === true || (Array.isArray(value) && value.length === 0)) {
    return { ok: false, error: `${flag} requires at least one name.` }
  }
  return { ok: true, names: value }
}

/**
 * Print the end-of-build summary of everything that did not make it in.
 *
 * `published` is the difference between "your site is missing these" and "your
 * site is untouched", which is the fact a reader most needs from this block.
 */
function reportSkippedSources(skipped: SkippedSource[], published: boolean): void {
  console.error(`\n⚠️  ${countOf(skipped.length, 'source')} could not be built:`)
  for (const source of skipped) {
    console.error(`  - ${source.kind} '${source.name}': ${source.reason}`)
  }
  console.error(
    published ? 'The site was published without them.' : 'The published site was left unchanged.',
  )
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
  const decksDir = getDecksDir()
  const collectionsDir = getCollectionsDir()
  const wantedListsSourceDir = getWantedDir()
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

  // Explicit selections, parsed before anything is read: a bare `--decks` (no
  // names) is a usage error rather than a silent full build.
  const parsedFlags = [
    selectionFlagNames(options.decks, '--decks'),
    selectionFlagNames(options.collections, '--collections'),
    selectionFlagNames(options.wantedLists, '--wanted-lists'),
  ]
  const flagError = parsedFlags.find((parsed) => !parsed.ok)
  if (flagError !== undefined && !flagError.ok) {
    console.error(flagError.error)
    process.exitCode = ExitCode.UsageError
    return
  }
  const [deckNames, collectionNames, wantedNames] = parsedFlags.map((parsed) =>
    parsed.ok ? parsed.names : undefined,
  )
  // Deck URLs are not files, so they bypass the file-name resolver entirely.
  const deckUrls = deckNames?.filter(isDeckUrl) ?? []
  const deckFileNames = deckNames?.filter((n) => !isDeckUrl(n))

  const deckSelection = await resolveSourceSelection(
    'deck',
    decksDir,
    deckFileNames,
    selection.includeDecks,
    selection.excludeDecks,
  )
  const collectionSelection = await resolveSourceSelection(
    'flat',
    collectionsDir,
    collectionNames,
    selection.includeCollections,
    selection.excludeCollections,
  )
  const wantedSelection = await resolveSourceSelection(
    'flat',
    wantedListsSourceDir,
    wantedNames,
    selection.includeWantedLists,
    selection.excludeWantedLists,
  )

  // Every source the build could not use, reported once as a summary at the end.
  // A source the *user named* going missing fails the build; a discovered one
  // that cannot be read is reported and skipped.
  const skipped: SkippedSource[] = []
  const skipSource = (kind: ListKind, name: string, reason: string, explicit: boolean): void => {
    skipped.push({ kind, name, reason, explicit })
    console.error(`Failed to load ${kind} '${name}': ${reason}`)
  }

  const deckCategory: SourceCategory = {
    kind: 'deck',
    dir: decksDir,
    configKey: 'includeDecks',
    selection: deckSelection,
    buildable: [],
  }
  const collectionCategory: SourceCategory = {
    kind: 'collection',
    dir: collectionsDir,
    configKey: 'includeCollections',
    selection: collectionSelection,
    buildable: [],
  }
  const wantedCategory: SourceCategory = {
    kind: 'wanted list',
    dir: wantedListsSourceDir,
    configKey: 'includeWantedLists',
    selection: wantedSelection,
    buildable: [],
  }
  const categories: SourceCategory[] = [deckCategory, collectionCategory, wantedCategory]
  for (const category of categories) {
    const { selection: resolved } = category
    if (resolved.explicit) {
      for (const name of resolved.missing) {
        skipSource(category.kind, name, `no ${category.kind} named that in ${category.dir}`, true)
      }
      for (const { name, matches } of resolved.ambiguous) {
        skipSource(
          category.kind,
          name,
          `matches ${countOf(matches.length, category.kind)} (${matches.join(', ')}) — name one exactly`,
          true,
        )
      }
    } else {
      for (const name of resolved.unmatchedIncludes) {
        console.warn(
          `⚠️  site.${category.configKey} lists '${name}', which matches no ${category.kind} in ${category.dir} — it may have been renamed or removed.`,
        )
      }
      // "Found" describes discovery, so it is printed for the config selection
      // only — a name that came from a flag was given, not found.
      if (resolved.sources.length > 0) {
        const names = resolved.sources.map((s) => s.displayName).join(', ')
        console.log(`Found ${countOf(resolved.sources.length, category.kind)}: ${names}`)
      }
    }
    // A file that exists but could not be read carries its reason from
    // discovery. Reported here and dropped from `sources`, so no loader is
    // handed a file already known to be unusable.
    for (const source of resolved.sources) {
      if (source.readError !== undefined) {
        skipSource(category.kind, source.displayName, source.readError, resolved.explicit)
      }
    }
    category.buildable = resolved.sources.filter((s) => s.readError === undefined)
  }

  if (skipped.some((source) => source.explicit)) {
    // A source the *user named* is missing, ambiguous or unreadable — all known
    // before anything is fetched or written, so the previously published site is
    // left entirely alone.
    reportSkippedSources(skipped, false)
    process.exitCode = ExitCode.RuntimeError
    return
  }

  if (
    deckUrls.length === 0 &&
    categories.every((category) => category.selection.sources.length === 0)
  ) {
    console.error(
      'Nothing to build: no decks, collections, or wanted lists were found. ' +
        'Create one with `ritual new deck "My Deck"` (or run `ritual edit`), then build again.',
    )
    process.exitCode = ExitCode.RuntimeError
    return
  }

  // How the cache refresh question is answered for this run (--refresh <mode>,
  // interactive by default).
  const mode = options.refresh ?? 'ask'

  console.log('Building static site...')
  if (cacheImages) {
    console.log('Caching deck card images locally and using dist/images paths.')
  } else {
    console.log('Using Scryfall image URLs from card data and skipping deck image downloads.')
  }

  // Build into a scratch directory and swap it into place only once the build
  // has succeeded: clearing the output directory first meant any later failure
  // (an empty cache, a cold network, an unreadable list) left the published site
  // gone rather than merely stale. Same mechanism the admin build route uses.
  const published = await buildAndPublish(distDir, async (buildDir): Promise<boolean> => {
    const imagesDir = path.join(buildDir, 'images')
    await fs.mkdir(imagesDir, { recursive: true })
    const symbolsDir = path.join(imagesDir, 'symbols')
    await fs.mkdir(symbolsDir, { recursive: true })
    await Bun.write(path.join(buildDir, 'app.svg'), siteSpaAssets.appSvg)

    // Fetch and download symbols. `never` means "use the existing cache as-is",
    // so an uncached symbology is left uncached rather than downloaded — the site
    // then renders without mana symbols, which the warning says out loud.
    console.log('Fetching and downloading mana symbols...')
    const symbologyNetwork = refreshStaleAllowed(mode)
    let symbols = await fetchSymbology({ network: symbologyNetwork })
    if (symbols.length === 0 && !symbologyNetwork) {
      console.warn(
        '⚠️  No cached symbology and --refresh never: mana symbols will be missing from the site. Re-run with --refresh auto to download them.',
      )
    }
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
        if (!symbologyNetwork) {
          for (const m of matches) if (!symbolMap[m]) missingSymbols.add(m)
          return
        }
        console.log('Found new symbols in text. Refreshing symbology...')
        symbols = await fetchSymbology({ force: true })
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

    /** Take a loaded deck into the build and harvest every card name it mentions. */
    const collectDeck = (loaded: LoadedDeck): void => {
      loadedDecks.push(loaded)
      console.log(`  - Loaded ${loaded.data.name}`)
      loaded.data.sections.forEach((s) => s.cards.forEach((c) => allCardNames.add(c.name)))
      // Card names referenced in the primer (for modal pre-fetching)
      if (loaded.data.primer) {
        for (const name of extractPrimerCardNames(loaded.data.primer)) primerCardNames.add(name)
      }
      // Card names referenced in the changelog
      for (const name of extractChangelogCardNames(loaded.changelog)) changelogCardNames.add(name)
    }

    // Phase 1: Load Decks
    if (deckUrls.length + deckCategory.buildable.length > 0) console.log('Loading decks...')
    for (const url of deckUrls) {
      let result: Awaited<ReturnType<typeof fetchDeckFromUrl>>
      try {
        result = await fetchDeckFromUrl(url, {
          moxfieldUserAgent: options.moxfieldUserAgent,
        })
      } catch (e) {
        skipSource('deck', url, getErrorMessage(e), true)
        continue
      }
      if (typeof result === 'string') {
        skipSource('deck', url, result, true)
        continue
      }
      collectDeck({ data: result, changelog: [], warnings: [], fileMtime: undefined })
    }
    for (const source of deckCategory.buildable) {
      const result = await loadDeckSource(decksDir, source.basename)
      if (typeof result === 'string') {
        skipSource('deck', source.displayName, result, deckSelection.explicit)
        continue
      }
      for (const warning of result.warnings) {
        console.warn(`  ⚠️  ${source.displayName}: ${warning}`)
      }
      collectDeck(result)
    }

    // Pre-load wanted list card names so they're fetched along with deck/collection
    // cards. Phase 5 builds from the same resolved selection, so the two stay in sync.
    for (const source of wantedCategory.buildable) {
      try {
        const wlContent = await fs.readFile(
          path.join(wantedListsSourceDir, `${source.basename}.md`),
          'utf-8',
        )
        const { entries: wlEntries } = parseWantedListFile(wlContent)
        for (const entry of wlEntries) allCardNames.add(entry.name)
      } catch {
        // Unreadable here is reported by the loader in Phase 5.
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

    // Ensure the full card cache has been bulk-downloaded at least once per week,
    // and trigger a bulk refresh if many cards are missing. Suppressed when bulk
    // downloads aren't permitted, leaving the per-card loop below to fill gaps.
    // A failed download must not abort a build the existing cache can still
    // serve — the same treatment the price-refresh gate below gives it.
    let cacheJustRefreshed = false
    try {
      ;({ refreshed: cacheJustRefreshed } = await ensureCacheForCards(allCardNames, undefined, {
        allowBulk: bulkAllowed(mode),
      }))
    } catch (e) {
      console.error(
        `Card cache download failed; building with the existing cache. ${getErrorMessage(e)}`,
      )
    }

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
      // Two very different causes wore the same message: an unusable cache, and a
      // workspace whose lists priced nothing because there are no cards in them.
      console.error(
        totalCards === 0
          ? 'No cards to price: every selected list is empty, so there is nothing to build.'
          : emptyCacheAdvice('No price data found in the card cache.'),
      )
      process.exitCode = ExitCode.RuntimeError
      return false
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
    const decksDataDir = path.join(buildDir, 'decks')
    await fs.mkdir(decksDataDir, { recursive: true })

    for (const loaded of loadedDecks) {
      const { slug, detail, summary } = await buildDeckArtifacts(loaded, detailCtx)
      await Bun.write(path.join(decksDataDir, `${slug}.json`), JSON.stringify(detail))
      decksSummaries.push(summary)
    }

    // Phase 4: Load and process collections
    const collectionsSummaries: CollectionSummary[] = []
    const collectionsDataDir = path.join(buildDir, 'collections')
    await fs.mkdir(collectionsDataDir, { recursive: true })

    if (collectionCategory.buildable.length > 0) console.log('Loading collections...')

    for (const source of collectionCategory.buildable) {
      const loaded = await loadCollectionSource(collectionsDir, source.basename)
      if (typeof loaded === 'string') {
        skipSource('collection', source.displayName, loaded, collectionSelection.explicit)
        continue
      }
      for (const w of loaded.warnings) {
        console.warn(`  ⚠️  ${source.displayName}: ${w}`)
      }
      if (loaded.entries.length === 0) {
        console.log(`  ${source.displayName}: no valid entries, skipping`)
        continue
      }

      const { slug, detail, summary } = await buildCollectionArtifacts(loaded, detailCtx)
      await Bun.write(path.join(collectionsDataDir, `${slug}.json`), JSON.stringify(detail))
      collectionsSummaries.push(summary)
      console.log(
        `  - Loaded ${summary.name} (${countOf(summary.cardCount, 'card')}, $${summary.totalPrice.toFixed(2)})`,
      )
    }

    // Phase 5: Load and process wanted lists, from the selection resolved up front
    // (the card pre-load used the same one, so both stay in sync).
    const wantedListsSummaries: WantedListSummary[] = []
    const wantedListsDataDir = path.join(buildDir, 'wanted')
    await fs.mkdir(wantedListsDataDir, { recursive: true })

    if (wantedCategory.buildable.length > 0) console.log('Loading wanted lists...')

    for (const source of wantedCategory.buildable) {
      const loaded = await loadWantedSource(wantedListsSourceDir, source.basename)
      if (typeof loaded === 'string') {
        skipSource('wanted list', source.displayName, loaded, wantedSelection.explicit)
        continue
      }
      for (const w of loaded.warnings) {
        console.warn(`  ⚠️  ${source.displayName}: ${w}`)
      }
      if (loaded.entries.length === 0) {
        console.log(`  ${source.displayName}: no valid entries, skipping`)
        continue
      }

      const { slug, detail, summary } = await buildWantedArtifacts(loaded, detailCtx)
      await Bun.write(path.join(wantedListsDataDir, `${slug}.json`), JSON.stringify(detail))
      wantedListsSummaries.push(summary)
      console.log(
        `  - Loaded ${summary.name} (${countOf(summary.cardCount, 'card')}, $${summary.totalPrice.toFixed(2)})`,
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
      // Baked even for a static build: in a split deployment index.json comes
      // from here while the quote API lives on a separate `serve --api` host.
      // The site still requires an API base before showing sell mode.
      sellMode: getSiteSellMode(),
    }
    await Bun.write(path.join(buildDir, 'index.json'), JSON.stringify(siteIndex))

    // Write pre-built SPA
    console.log('Writing Web App...')
    await Bun.write(path.join(buildDir, 'app.js'), siteSpaAssets.appJs)

    // Defense-in-depth: theme names always pass through `resolveThemeName`
    // or `parseCustomTheme` which enforce safe identifier patterns, but
    // re-validate at the HTML interpolation site so a future refactor can't
    // silently introduce attribute-injection.
    const safeInitialTheme = /^[a-z0-9][a-z0-9-]*$/.test(initialThemeName)
      ? initialThemeName
      : 'default'
    const initialThemeAttr =
      safeInitialTheme === 'default' ? '' : ` data-theme="${safeInitialTheme}"`

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
    await Bun.write(path.join(buildDir, 'index.html'), indexHtml)

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
      path.join(buildDir, 'styles.css'),
      `${allThemes}${customThemesCss ? '\n' + customThemesCss : ''}\n${siteSpaAssets.stylesSourceCss}`,
    )

    // A source the user *named* going missing is a failed build, not a partial
    // one: the scratch tree is discarded and the previous site stays published.
    // A discovered source that would not load is reported and built around.
    return !skipped.some((source) => source.explicit)
  })

  if (skipped.length > 0) {
    reportSkippedSources(skipped, published)
    if (!published) process.exitCode = ExitCode.RuntimeError
  }
  if (published) console.log(`Site generated in ${distDir}`)
}

/**
 * Register every commander option that maps to a {@link BuildSiteOptions} field.
 * Shared by `build-site` and `serve --build` so the two stay in sync.
 */
export function applyBuildSiteOptions(command: Command): Command {
  return addRefreshOption(
    command,
    'Card cache refresh policy: ask (default; bulk-downloads an empty or stale cache without asking, prompts for the price and tag refreshes), auto, no-bulk, never',
  )
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
      'Publish into this directory instead of dist/ (relative paths resolve against the Ritual directory); `serve` without --build serves it instead',
    )
}

export function registerBuildSiteCommand(program: Command): void {
  applyBuildSiteOptions(
    program
      .command('build-site')
      .description('Generate a static website for your decks, collections, and wanted lists'),
  ).action(async (options: BuildSiteOptions) => {
    await runBuildSite(options)
  })
}
