import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { extractMarkdownTitle } from '../markdown-utils'
import { importFromTextFile, listDeckFiles } from '../importers/text-file'
import {
  fetchCardData,
  downloadImage,
  getCardPrintings,
  fetchRepresentativePrints,
  computeRepresentativePrints,
  fetchSymbology,
  downloadSymbol,
  preloadCache,
} from '../scryfall'
import { cardCache, ensureCacheForCards } from '../cache'
import { isRunningFromSource } from '../runtime'
import type { DeckData, Finish, ScryfallCard } from '../types'
import { extractPrimerCardNames } from '../primer-parser'
import { parseChangelog, extractChangelogCardNames } from '../changelog-parser'
import type { ChangelogPage } from '../changelog-parser'
import { getBaseDir } from '../base-dir'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../ritual-config'
import type {
  DeckSummary,
  DeckDetail,
  CollectionSummary,
  CollectionDetail,
  CollectionCardEntry,
  WantedListSummary,
  WantedListDetail,
  WantedListCardEntry,
  WantedListEntryState,
  SiteIndex,
} from '../site/data-types'
import { ArchidektClient } from '../clients/ArchidektClient'
import { fetchMoxfieldDeck } from '../importers/moxfield-lib'
import { resolveCardImageSources } from '../site/image-sources'
import { parseCollectionFile, getPriceForFinish, resolveFinish } from './price-collection'
import { parseWantedListFile } from './wanted-helpers'
import { parseCurrenciesFlag, getCardPrice, getCardPriceForFinish } from '../price-currency'
import type { PriceCurrency } from '../price-currency'
import { getErrorMessage } from '../errors'
import type { CacheManager } from '../interfaces'
import { PRICE_MAX_AGE_MS, BULK_FETCH_THRESHOLD } from '../cache/constants'
import {
  generateAllThemesCss,
  generateCustomThemeCss,
  parseCustomTheme,
  resolveThemeName,
  themeBootstrapScript,
  themeNames,
  type CustomTheme,
} from '../themes'
import prompts from 'prompts'

export interface BuildSiteOptions {
  verbose?: boolean
  cacheImages?: boolean
  decks?: string[]
  collections?: string[]
  wantedLists?: string[]
  collectionSort?: string
  deckSort?: string
  currencies?: string
  yes?: boolean
  theme?: string
  themeFile?: string[]
}

export type SiteSpaAssets = {
  appSvg: string
  stylesSourceCss: string
  appJs: string
}

type LoadedDeck = { data: DeckData; changelog: ChangelogPage[] }

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

async function loadCustomThemes(paths: readonly string[]): Promise<CustomTheme[]> {
  const themes: CustomTheme[] = []
  for (const filePath of paths) {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      console.error(`Failed to read --theme-file '${filePath}': ${getErrorMessage(err)}`)
      process.exit(1)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.error(`--theme-file '${filePath}' is not valid JSON: ${getErrorMessage(err)}`)
      process.exit(1)
    }
    const result = parseCustomTheme(parsed)
    if (typeof result === 'string') {
      console.error(`--theme-file '${filePath}': ${result}`)
      process.exit(1)
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
  assumeYes: boolean,
): Promise<void> {
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

  const shouldPreload =
    assumeYes ||
    (
      await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Redownload the latest Scryfall card cache now?',
        initial: false,
      })
    ).value === true

  if (shouldPreload) {
    await preloadCache()
  }
}

export async function runBuildSite(options: BuildSiteOptions): Promise<void> {
  let availableCurrencies: PriceCurrency[]
  try {
    availableCurrencies = parseCurrenciesFlag(options.currencies)
  } catch (e) {
    console.error(getErrorMessage(e))
    return
  }
  const defaultCurrency = availableCurrencies[0]!

  const customThemes = await loadCustomThemes(options.themeFile ?? [])
  const customNames = new Set(customThemes.map((t) => t.name))
  // Open-ended type: either a built-in `ThemeName` or a custom name from
  // `--theme-file`. Both are validated upstream.
  const initialThemeName: string = (() => {
    const raw = (options.theme ?? 'default').toLowerCase()
    if (customNames.has(raw)) return raw
    return resolveThemeName(options.theme)
  })()

  const distDir = path.join(getBaseDir(), 'dist')
  const imagesDir = path.join(distDir, 'images')
  const decksDir = getDecksDir()
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
    // No --decks flag or flag without names: build all decks found
    try {
      const files = await listDeckFiles(decksDir)
      deckSources = files.map((f) => f.slice(0, -3))
      if (deckSources.length > 0) {
        console.log(`Found ${deckSources.length} decks: ${deckSources.join(', ')}`)
      }
    } catch (e) {
      console.error('Failed to read decks directory:', e)
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
    let deckData: DeckData | undefined
    try {
      if (source.startsWith('http')) {
        if (source.includes('archidekt')) {
          const match = source.match(/archidekt\.com\/decks\/(\d+)/)
          if (match && match[1]) deckData = await new ArchidektClient().fetchDeck(match[1])
        } else if (source.includes('moxfield')) {
          const match = source.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/)
          if (match && match[1]) deckData = await fetchMoxfieldDeck(match[1])
        }
      } else {
        const fileName = path.basename(source.endsWith('.md') ? source : `${source}.md`)
        deckData = await importFromTextFile(path.join(decksDir, fileName))
      }
    } catch (e) {
      console.error(`Failed to load deck '${source}':`, e)
      continue
    }

    if (deckData) {
      // Load changelog if it exists
      let changelog: ChangelogPage[] = []
      if (!source.startsWith('http')) {
        const baseName = source.endsWith('.md') ? source.slice(0, -3) : source
        const changelogPath = path.join(decksDir, `${baseName}.changes.md`)
        try {
          const changelogContent = await fs.readFile(changelogPath, 'utf-8')
          changelog = parseChangelog(changelogContent)
        } catch {
          // No changelog file, that's fine
        }
      }

      loadedDecks.push({ data: deckData, changelog })
      console.log(`  - Loaded ${deckData.name}`)
      // Collect deck card names
      deckData.sections.forEach((s) => s.cards.forEach((c) => allCardNames.add(c.name)))
      // Collect card names referenced in the primer (for modal pre-fetching)
      if (deckData.primer) {
        for (const name of extractPrimerCardNames(deckData.primer)) {
          primerCardNames.add(name)
        }
      }
      // Collect card names referenced in the changelog
      for (const name of extractChangelogCardNames(changelog)) {
        changelogCardNames.add(name)
      }
    }
  }

  // Pre-load wanted list card names so they're fetched along with deck/collection cards
  {
    const wlDir = getWantedDir()
    try {
      const wlFiles = await fs.readdir(wlDir)
      const wlMdFiles = wlFiles.filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
      for (const f of wlMdFiles) {
        try {
          const wlContent = await fs.readFile(path.join(wlDir, f), 'utf-8')
          const { entries: wlEntries } = parseWantedListFile(wlContent)
          for (const entry of wlEntries) {
            allCardNames.add(entry.name)
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // No wanted/ directory
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
  // and trigger a bulk refresh if many cards are missing.
  const { refreshed: cacheJustRefreshed } = await ensureCacheForCards(allCardNames)

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
    options.yes === true,
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

  const globalLowestPriceCardMap: Record<string, ScryfallCard | null> = {}
  const globalLowestPriceCardMapEur: Record<string, ScryfallCard | null> = {}
  const globalLowestPriceCardMapTix: Record<string, ScryfallCard | null> = {}
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
      if (pricesFresh) {
        const sortedPrintings = [...printings].sort((a, b) =>
          (b.released_at ?? '').localeCompare(a.released_at ?? ''),
        )
        repPrints = computeRepresentativePrints(
          sortedPrintings,
          sortedPrintings,
          availableCurrencies,
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
        globalLowestPriceCardMap[name] = cheap ?? rep ?? card
        globalCheapestCardMap[name] = cheap ?? rep ?? card
      }

      if (hasEur) {
        const rep = repPrints.eur?.representative ?? null
        const cheap = repPrints.eur?.cheapest ?? null
        if (!rep) {
          globalMissingCards.eur!.add(name)
          console.warn(`⚠️  '${name}' has no EUR pricing.`)
        }
        globalLowestPriceCardMapEur[name] = cheap ?? rep ?? card
        globalCheapestCardMapEur[name] = cheap ?? rep ?? card
      }

      if (hasTix) {
        const rep = repPrints.tix?.representative ?? null
        const cheap = repPrints.tix?.cheapest ?? null
        if (!rep) {
          globalMissingCards.tix!.add(name)
          console.warn(`⚠️  '${name}' has no TIX pricing.`)
        }
        globalLowestPriceCardMapTix[name] = cheap ?? rep ?? card
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
        hasUsd ? globalLowestPriceCardMap[name] : null,
        hasEur ? globalLowestPriceCardMapEur[name] : null,
        hasTix ? globalLowestPriceCardMapTix[name] : null,
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

  if (latestPriceTimestamp == null) {
    throw new Error('No price data found. Run the cache refresh before building the site.')
  }
  const pricesDate = new Date(latestPriceTimestamp).toISOString()

  // Phase 3: Generate JSON data files and SPA bundle
  console.log('Generating data files...')
  const decksSummaries: DeckSummary[] = []
  const decksDataDir = path.join(distDir, 'decks')
  await fs.mkdir(decksDataDir, { recursive: true })

  for (const { data: deckData, changelog } of loadedDecks) {
    // Find Featured Card
    let featured: ScryfallCard | null = null
    const commanderSection = deckData.sections.find(
      (s) => s.name.toLowerCase() === 'commander' || s.name.toLowerCase() === 'commanders',
    )

    const deckCards: ScryfallCard[] = []
    deckData.sections.forEach((s) =>
      s.cards.forEach((c) => {
        const card = globalCardMap[c.name]
        if (card) deckCards.push(card)
      }),
    )

    if (commanderSection && commanderSection.cards[0]) {
      const cmdrName = commanderSection.cards[0].name
      featured = globalCardMap[cmdrName] || null
    }

    if (!featured && deckCards.length > 0) {
      let maxPrice = -1
      for (const card of deckCards) {
        const price = parseFloat(card.prices.usd || '0')
        if (price > maxPrice) {
          maxPrice = price
          featured = card
        }
      }
    }

    const safeName = deckData.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    // Generate Deck List Text (Commander + Main)
    const textLines: string[] = []
    const cmdrSection = deckData.sections.find((s) => s.name.toLowerCase().includes('commander'))
    const mainSection = deckData.sections.find(
      (s) => s.name.toLowerCase() === 'main' || s.name.toLowerCase() === 'mainboard',
    )

    if (cmdrSection) {
      textLines.push(`## ${cmdrSection.name}`)
      cmdrSection.cards.forEach((c) => textLines.push(`${c.quantity} ${c.name}`))
      textLines.push('')
    }

    if (mainSection) {
      textLines.push(`## ${mainSection.name}`)
      mainSection.cards.forEach((c) => textLines.push(`${c.quantity} ${c.name}`))
    } else {
      // Include all other sections (except Sideboard/Maybeboard/Token)
      deckData.sections.forEach((s) => {
        const name = s.name.toLowerCase()
        if (name.includes('commander')) return // Already handled
        if (name.includes('maybeboard')) return
        if (name.includes('sideboard')) return
        if (name.includes('token')) return

        textLines.push('')
        textLines.push(`## ${s.name}`)
        s.cards.forEach((c) => textLines.push(`${c.quantity} ${c.name}`))
      })
    }

    const deckText = textLines.join('\n').trim()
    const deckTextPath = path.join(decksDataDir, `${safeName}.txt`)
    await Bun.write(deckTextPath, deckText)

    // Build deck-specific card map and printings (only cards in this deck)
    const deckCardMap: Record<string, ScryfallCard | null> = {}
    const deckPrintingsMap: Record<string, ScryfallCard[]> = {}
    const deckLowestPriceCardMap: Record<string, ScryfallCard | null> = {}
    const deckLowestPriceCardMapEur: Record<string, ScryfallCard | null> = {}
    const deckLowestPriceCardMapTix: Record<string, ScryfallCard | null> = {}
    deckData.sections.forEach((s) =>
      s.cards.forEach((c) => {
        deckCardMap[c.name] = globalCardMap[c.name] ?? null
        if (globalPrintingsMap[c.name]) {
          deckPrintingsMap[c.name] = globalPrintingsMap[c.name]!
        }
        if (hasUsd) deckLowestPriceCardMap[c.name] = globalLowestPriceCardMap[c.name] ?? null
        if (hasEur) deckLowestPriceCardMapEur[c.name] = globalLowestPriceCardMapEur[c.name] ?? null
        if (hasTix) deckLowestPriceCardMapTix[c.name] = globalLowestPriceCardMapTix[c.name] ?? null
      }),
    )

    // Also include primer-referenced cards so [[Card Name]] links resolve at runtime
    if (deckData.primer) {
      for (const name of extractPrimerCardNames(deckData.primer)) {
        const canonical = (await cardCache.resolveCardName(name.toLowerCase())) ?? name
        if (!(canonical in deckCardMap)) {
          deckCardMap[canonical] = globalCardMap[canonical] ?? null
        }
        if (!(canonical in deckPrintingsMap)) {
          // The card's actual Scryfall name may differ from the primer key (e.g. different
          // punctuation), so also check globalPrintingsMap under the card's real name.
          const actualName = deckCardMap[canonical]?.name ?? canonical
          deckPrintingsMap[canonical] =
            globalPrintingsMap[canonical] ?? globalPrintingsMap[actualName] ?? []
        }
      }
    }

    // Also include changelog-referenced cards so change history card links resolve at runtime
    for (const name of extractChangelogCardNames(changelog)) {
      const canonical = (await cardCache.resolveCardName(name.toLowerCase())) ?? name
      if (!(canonical in deckCardMap)) {
        deckCardMap[canonical] = globalCardMap[canonical] ?? null
      }
      if (!(canonical in deckPrintingsMap)) {
        const actualName = deckCardMap[canonical]?.name ?? canonical
        deckPrintingsMap[canonical] =
          globalPrintingsMap[canonical] ?? globalPrintingsMap[actualName] ?? []
      }
    }

    // Collect missing cards for this deck
    const deckMissingCards: Partial<Record<PriceCurrency, string[]>> = {}
    for (const cur of availableCurrencies) {
      const missing = Array.from(globalMissingCards[cur] ?? []).filter((name) =>
        deckData.sections.some((s) => s.cards.some((c) => c.name === name)),
      )
      if (missing.length > 0) {
        deckMissingCards[cur] = missing
      }
    }

    // cardId is shipped on each public-site card so the trade page can
    // encode deck cards into shareable URLs.
    const deckDetail: DeckDetail = {
      deck: deckData,
      cards: deckCardMap,
      printings: deckPrintingsMap,
      lowestPriceCards: hasUsd ? deckLowestPriceCardMap : undefined,
      lowestPriceCardsEur: hasEur ? deckLowestPriceCardMapEur : undefined,
      lowestPriceCardsTix: hasTix ? deckLowestPriceCardMapTix : undefined,
      symbolMap,
      exportPath: `decks/${safeName}.txt`,
      useScryfallImgUrls,
      defaultCurrency,
      availableCurrencies,
      missingCards: deckMissingCards,
      pricesDate,
      changelog: changelog.length > 0 ? changelog : undefined,
    }
    await Bun.write(path.join(decksDataDir, `${safeName}.json`), JSON.stringify(deckDetail))

    // Build summary for index
    const cardCount = deckData.sections.reduce((acc, s) => acc + s.cards.length, 0)
    const featuredImage = featured
      ? resolveCardImageSources(featured, useScryfallImgUrls).frontImage
      : ''

    // Compute deck prices (mainboard + sideboard + commander, not extras)
    let deckTotalPrice = 0
    let deckLowestPrice = 0
    let deckTotalPriceEur = 0
    let deckLowestPriceEur = 0
    let deckTotalPriceTix = 0
    let deckLowestPriceTix = 0
    let missingPriceCount = 0
    let missingPriceCountEur = 0
    let missingPriceCountTix = 0
    for (const section of deckData.sections) {
      const sLow = section.name.toLowerCase()
      if (sLow.includes('maybeboard') || sLow.includes('token')) continue
      for (const c of section.cards) {
        if (hasUsd) {
          const defaultCard = globalCardMap[c.name]
          const cheapCard = globalCheapestCardMap[c.name]
          const cardPrice = parseFloat(defaultCard?.prices.usd || '0')
          deckTotalPrice += cardPrice * c.quantity
          deckLowestPrice += parseFloat(cheapCard?.prices.usd || '0') * c.quantity
          if (!defaultCard?.prices.usd) missingPriceCount += c.quantity
        }
        if (hasEur) {
          const defaultCard = globalCardMap[c.name]
          const cheapCard = globalCheapestCardMapEur[c.name]
          const cardPrice = defaultCard ? getCardPrice(defaultCard, 'eur') : 0
          deckTotalPriceEur += cardPrice * c.quantity
          deckLowestPriceEur += (cheapCard ? getCardPrice(cheapCard, 'eur') : 0) * c.quantity
          if (cardPrice === 0) missingPriceCountEur += c.quantity
        }
        if (hasTix) {
          const defaultCard = globalCardMap[c.name]
          const cheapCard = globalCheapestCardMapTix[c.name]
          const cardPrice = defaultCard ? getCardPrice(defaultCard, 'tix') : 0
          deckTotalPriceTix += cardPrice * c.quantity
          deckLowestPriceTix += (cheapCard ? getCardPrice(cheapCard, 'tix') : 0) * c.quantity
          if (cardPrice === 0) missingPriceCountTix += c.quantity
        }
      }
    }

    const summary: DeckSummary = {
      slug: safeName,
      name: deckData.name,
      featuredCardImage: featuredImage,
      commander: featured && commanderSection ? featured.name : null,
      cardCount,
      totalPrice: hasUsd ? deckTotalPrice : undefined,
      lowestPrice: hasUsd ? deckLowestPrice : undefined,
      totalPriceEur: hasEur ? deckTotalPriceEur : undefined,
      lowestPriceEur: hasEur ? deckLowestPriceEur : undefined,
      totalPriceTix: hasTix ? deckTotalPriceTix : undefined,
      lowestPriceTix: hasTix ? deckLowestPriceTix : undefined,
      missingPriceCount: hasUsd ? missingPriceCount : undefined,
      missingPriceCountEur: hasEur ? missingPriceCountEur : undefined,
      missingPriceCountTix: hasTix ? missingPriceCountTix : undefined,
    }
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
    // No --collections flag or flag without names: build all collections found
    try {
      const files = await fs.readdir(collectionsDir)
      collectionSources = files
        .filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
        .map((f) => f.slice(0, -3))
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
    const fileName = colName.endsWith('.md') ? colName : `${colName}.md`
    const filePath = path.join(collectionsDir, fileName)

    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch {
      console.error(`Failed to read collection file: ${fileName}`)
      continue
    }

    const { entries, warnings } = parseCollectionFile(content)
    for (const w of warnings) {
      console.warn(`  ⚠️  ${w}`)
    }

    if (entries.length === 0) {
      console.log(`  ${colName}: no valid entries, skipping`)
      continue
    }

    const displayName = extractMarkdownTitle(content) ?? colName

    // Load changelog if it exists
    let collectionChangelog: ChangelogPage[] = []
    const baseName = colName.endsWith('.md') ? colName.slice(0, -3) : colName
    const changelogPath = path.join(collectionsDir, `${baseName}.changes.md`)
    try {
      const changelogContent = await fs.readFile(changelogPath, 'utf-8')
      collectionChangelog = parseChangelog(changelogContent)
    } catch {
      // No changelog file
    }

    // Resolve exact printings for each entry
    const collectionCardMap: Record<string, ScryfallCard | null> = {}
    const collectionPrintingsMap: Record<string, ScryfallCard[]> = {}
    const cardEntries: CollectionCardEntry[] = []
    let totalPrice = 0
    let totalPriceEur = 0
    let totalPriceTix = 0
    let missingPriceCount = 0
    let missingPriceCountEur = 0
    let missingPriceCountTix = 0
    let featured: ScryfallCard | null = null
    let featuredPrice = -1

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      const cardKey = `${entry.set}:${entry.collectorNumber}`

      if (!collectionCardMap[cardKey]) {
        // Try to find exact printing
        const printings = await getCardPrintings(entry.name)
        if (!collectionPrintingsMap[entry.name]) {
          collectionPrintingsMap[entry.name] = printings
        }
        const exactPrinting = printings.find(
          (p) =>
            p.set.toLowerCase() === entry.set.toLowerCase() &&
            p.collector_number === entry.collectorNumber,
        )

        if (exactPrinting) {
          collectionCardMap[cardKey] = exactPrinting

          // Ensure symbols
          await ensureSymbols(exactPrinting.mana_cost)
          await ensureSymbols(exactPrinting.oracle_text)

          // Download images if caching
          if (cacheImages) {
            if (exactPrinting.image_uris?.normal) {
              await downloadImage(
                exactPrinting.image_uris.normal,
                path.join(imagesDir, `${exactPrinting.id}.jpg`),
              )
            } else if (exactPrinting.card_faces && exactPrinting.card_faces[0]) {
              if (exactPrinting.card_faces[0].image_uris?.normal) {
                await downloadImage(
                  exactPrinting.card_faces[0].image_uris.normal,
                  path.join(imagesDir, `${exactPrinting.id}.jpg`),
                )
              }
              if (exactPrinting.card_faces[1]?.image_uris?.normal) {
                await downloadImage(
                  exactPrinting.card_faces[1].image_uris.normal,
                  path.join(imagesDir, `${exactPrinting.id}_back.jpg`),
                )
              }
            }
          }
        } else {
          console.warn(
            `  ⚠️  Could not find printing for '${entry.name}' (${entry.set.toUpperCase()}:${entry.collectorNumber})`,
          )
          collectionCardMap[cardKey] = null
        }
      }

      const card = collectionCardMap[cardKey] ?? null
      const finish: Finish = card ? resolveFinish(entry, card) : entry.finish || 'nonfoil'
      const price = card ? getPriceForFinish(card, finish) : 0
      const priceEur = card ? getCardPriceForFinish(card, finish, 'eur') : 0
      const priceTix = card ? getCardPriceForFinish(card, finish, 'tix') : 0
      totalPrice += price
      totalPriceEur += priceEur
      totalPriceTix += priceTix
      if (price === 0) missingPriceCount++
      if (priceEur === 0) missingPriceCountEur++
      if (priceTix === 0) missingPriceCountTix++

      if (card && price > featuredPrice) {
        featuredPrice = price
        featured = card
      }

      cardEntries.push({
        name: entry.name,
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish,
        condition: entry.condition ?? 'NM',
        price,
        fileOrder: i,
        note: entry.note,
        cardId: entry.cardId,
      })
    }

    const safeName = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    // Write collection export files (MD and CSV)
    const exportMdPath = `collections/${safeName}.md`
    const exportCsvPath = `collections/${safeName}.csv`

    // Write original MD file
    await Bun.write(path.join(distDir, exportMdPath), content)

    // Write CSV
    const csvLines = ['Name,Set,Collector Number,Finish,Condition,Quantity']
    for (const entry of entries) {
      const finish = entry.finish || ''
      const condition = entry.condition || ''
      const csvName = entry.name.includes(',') ? `"${entry.name}"` : entry.name
      csvLines.push(
        `${csvName},${entry.set.toUpperCase()},${entry.collectorNumber},${finish},${condition},${entry.quantity}`,
      )
    }
    await Bun.write(path.join(distDir, exportCsvPath), csvLines.join('\n'))

    // Write collection detail JSON
    // Include changelog-referenced cards in the card maps
    for (const clName of extractChangelogCardNames(collectionChangelog)) {
      const canonical = (await cardCache.resolveCardName(clName.toLowerCase())) ?? clName
      if (!collectionCardMap[canonical]) {
        // Find a representative card for this name
        const printingsForCard = await getCardPrintings(canonical)
        if (printingsForCard.length > 0) {
          if (!collectionPrintingsMap[canonical]) {
            collectionPrintingsMap[canonical] = printingsForCard
          }
          const sorted = [...printingsForCard].sort((a, b) =>
            (b.released_at ?? '').localeCompare(a.released_at ?? ''),
          )
          const repPrints = computeRepresentativePrints(sorted, sorted, availableCurrencies)
          collectionCardMap[canonical] = repPrints.usd?.representative ?? sorted[0]!
        }
      }
    }

    const collectionDetailData: CollectionDetail = {
      name: displayName,
      entries: cardEntries,
      cards: collectionCardMap,
      printings: collectionPrintingsMap,
      symbolMap,
      useScryfallImgUrls,
      totalPrice,
      defaultCurrency,
      exportMdPath,
      exportCsvPath,
      pricesDate,
      changelog: collectionChangelog.length > 0 ? collectionChangelog : undefined,
    }
    await Bun.write(
      path.join(collectionsDataDir, `${safeName}.json`),
      JSON.stringify(collectionDetailData),
    )

    // Build summary for index
    const featuredImage = featured
      ? resolveCardImageSources(featured, useScryfallImgUrls).frontImage
      : ''

    const summary: CollectionSummary = {
      slug: safeName,
      name: displayName,
      featuredCardImage: featuredImage,
      cardCount: entries.length,
      totalPrice,
      totalPriceEur,
      totalPriceTix,
      missingPriceCount,
      missingPriceCountEur,
      missingPriceCountTix,
    }
    collectionsSummaries.push(summary)
    console.log(`  - Loaded ${displayName} (${entries.length} cards, $${totalPrice.toFixed(2)})`)
  }

  // Phase 5: Load and process wanted lists
  const wantedListsSourceDir = getWantedDir()
  const wantedListsSummaries: WantedListSummary[] = []
  const wantedListsDataDir = path.join(distDir, 'wanted')
  await fs.mkdir(wantedListsDataDir, { recursive: true })

  let wantedListSources: string[] = []
  if (options.wantedLists && Array.isArray(options.wantedLists) && options.wantedLists.length > 0) {
    wantedListSources = options.wantedLists
  } else {
    try {
      const files = await fs.readdir(wantedListsSourceDir)
      wantedListSources = files
        .filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
        .map((f) => f.slice(0, -3))
      if (wantedListSources.length > 0) {
        console.log(
          `Found ${wantedListSources.length} wanted lists: ${wantedListSources.join(', ')}`,
        )
      }
    } catch {
      // No wanted/ directory, skip silently
    }
  }

  if (wantedListSources.length > 0) {
    console.log('Loading wanted lists...')
  }

  for (const wlName of wantedListSources) {
    const fileName = wlName.endsWith('.md') ? wlName : `${wlName}.md`
    const filePath = path.join(wantedListsSourceDir, fileName)

    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch {
      console.error(`Failed to read wanted list file: ${fileName}`)
      continue
    }

    const { entries } = parseWantedListFile(content)

    if (entries.length === 0) {
      console.log(`  ${wlName}: no valid entries, skipping`)
      continue
    }

    const displayName = extractMarkdownTitle(content) ?? wlName

    // Load changelog if it exists
    let wlChangelog: ChangelogPage[] = []
    const baseName = wlName.endsWith('.md') ? wlName.slice(0, -3) : wlName
    const changelogPath = path.join(wantedListsSourceDir, `${baseName}.changes.md`)
    try {
      const changelogContent = await fs.readFile(changelogPath, 'utf-8')
      wlChangelog = parseChangelog(changelogContent)
    } catch {
      // No changelog file
    }

    const wlCardMap: Record<string, ScryfallCard | null> = {}
    const wlPrintingsMap: Record<string, ScryfallCard[]> = {}
    const cardEntries: WantedListCardEntry[] = []
    let totalPrice = 0
    let totalPriceEur = 0
    let totalPriceTix = 0
    let missingPriceCount = 0
    let missingPriceCountEur = 0
    let missingPriceCountTix = 0
    let featured: ScryfallCard | null = null
    let featuredPrice = -1

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!

      // Determine state
      let state: WantedListEntryState
      if (!entry.set || !entry.collectorNumber) {
        state = 'name-only'
      } else if (!entry.finish) {
        state = 'printing'
      } else {
        state = 'fully-specified'
      }

      // Ensure printings are fetched
      if (!wlPrintingsMap[entry.name]) {
        const printings = await getCardPrintings(entry.name)
        wlPrintingsMap[entry.name] = printings
      }
      const printings = wlPrintingsMap[entry.name]!

      let price = 0
      let priceEur = 0
      let priceTix = 0
      let card: ScryfallCard | null = null

      if (state === 'name-only') {
        // Use cheapest printing for wanted list entries
        const cheapUsd = globalCheapestCardMap[entry.name]
        const cheapEur = globalCheapestCardMapEur[entry.name]
        const cheapTix = globalCheapestCardMapTix[entry.name]
        card = cheapUsd ?? cheapEur ?? cheapTix ?? globalCardMap[entry.name] ?? null
        if (card) {
          const cardKey = `${card.set}:${card.collector_number}`
          wlCardMap[cardKey] = card
          wlCardMap[entry.name] = card

          if (hasUsd) {
            const c = cheapUsd ?? card
            price = parseFloat(c.prices.usd || '0')
            if (price === 0) missingPriceCount++
          }
          if (hasEur) {
            const c = cheapEur ?? card
            priceEur = getCardPrice(c, 'eur')
            if (priceEur === 0) missingPriceCountEur++
          }
          if (hasTix) {
            const c = cheapTix ?? card
            priceTix = getCardPrice(c, 'tix')
            if (priceTix === 0) missingPriceCountTix++
          }
        } else {
          missingPriceCount++
          missingPriceCountEur++
          missingPriceCountTix++
        }
      } else {
        // State 2 or 3: find exact printing
        const exactPrinting = printings.find(
          (p) =>
            p.set.toLowerCase() === entry.set!.toLowerCase() &&
            p.collector_number === entry.collectorNumber,
        )
        const cardKey = `${entry.set!.toLowerCase()}:${entry.collectorNumber}`

        if (exactPrinting) {
          card = exactPrinting
          wlCardMap[cardKey] = exactPrinting
          wlCardMap[entry.name] = wlCardMap[entry.name] ?? exactPrinting

          await ensureSymbols(exactPrinting.mana_cost)
          await ensureSymbols(exactPrinting.oracle_text)

          if (cacheImages) {
            await downloadCardImages(exactPrinting, imagesDir)
          }

          if (state === 'fully-specified') {
            if (hasUsd) {
              price = getCardPriceForFinish(exactPrinting, entry.finish!, 'usd')
              if (price === 0) missingPriceCount++
            }
            if (hasEur) {
              priceEur = getCardPriceForFinish(exactPrinting, entry.finish!, 'eur')
              if (priceEur === 0) missingPriceCountEur++
            }
            if (hasTix) {
              priceTix = getCardPriceForFinish(exactPrinting, entry.finish!, 'tix')
              if (priceTix === 0) missingPriceCountTix++
            }
          } else {
            // State 2: cheapest finish of this printing
            const defaultFinish = resolveFinish(
              {
                name: entry.name,
                quantity: 1,
                set: entry.set!,
                collectorNumber: entry.collectorNumber!,
              },
              exactPrinting,
            )

            if (hasUsd) {
              price = getCardPriceForFinish(exactPrinting, defaultFinish, 'usd')
              if (price === 0) missingPriceCount++
            }
            if (hasEur) {
              priceEur = getCardPriceForFinish(exactPrinting, defaultFinish, 'eur')
              if (priceEur === 0) missingPriceCountEur++
            }
            if (hasTix) {
              priceTix = getCardPriceForFinish(exactPrinting, defaultFinish, 'tix')
              if (priceTix === 0) missingPriceCountTix++
            }
          }
        } else {
          console.warn(
            `  ⚠️  Could not find printing for '${entry.name}' (${entry.set!.toUpperCase()}:${entry.collectorNumber})`,
          )
          wlCardMap[cardKey] = null
          missingPriceCount++
          missingPriceCountEur++
          missingPriceCountTix++
        }
      }

      totalPrice += price
      totalPriceEur += priceEur
      totalPriceTix += priceTix

      if (card && price > featuredPrice) {
        featuredPrice = price
        featured = card
      }

      cardEntries.push({
        name: entry.name,
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        price,
        fileOrder: i,
        note: entry.note,
        state,
        cardId: entry.cardId,
      })
    }

    const safeName = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    // Write wanted list export MD
    const exportMdPath = `wanted/${safeName}.md`
    await Bun.write(path.join(distDir, exportMdPath), content)

    // Include changelog-referenced cards
    for (const clName of extractChangelogCardNames(wlChangelog)) {
      const canonical = (await cardCache.resolveCardName(clName.toLowerCase())) ?? clName
      if (!wlCardMap[canonical]) {
        const printingsForCard = await getCardPrintings(canonical)
        if (printingsForCard.length > 0) {
          if (!wlPrintingsMap[canonical]) {
            wlPrintingsMap[canonical] = printingsForCard
          }
          const sorted = [...printingsForCard].sort((a, b) =>
            (b.released_at ?? '').localeCompare(a.released_at ?? ''),
          )
          const repPrints = computeRepresentativePrints(sorted, sorted, availableCurrencies)
          wlCardMap[canonical] = repPrints.usd?.representative ?? sorted[0]!
        }
      }
    }

    const wlDetailData: WantedListDetail = {
      name: displayName,
      entries: cardEntries,
      cards: wlCardMap,
      printings: wlPrintingsMap,
      symbolMap,
      useScryfallImgUrls,
      totalPrice,
      defaultCurrency,
      exportMdPath,
      pricesDate,
      changelog: wlChangelog.length > 0 ? wlChangelog : undefined,
    }
    await Bun.write(path.join(wantedListsDataDir, `${safeName}.json`), JSON.stringify(wlDetailData))

    const featuredImage = featured
      ? resolveCardImageSources(featured, useScryfallImgUrls).frontImage
      : ''

    const summary: WantedListSummary = {
      slug: safeName,
      name: displayName,
      featuredCardImage: featuredImage,
      cardCount: entries.length,
      totalPrice,
      totalPriceEur,
      totalPriceTix,
      missingPriceCount,
      missingPriceCountEur,
      missingPriceCountTix,
    }
    wantedListsSummaries.push(summary)
    console.log(`  - Loaded ${displayName} (${entries.length} cards, $${totalPrice.toFixed(2)})`)
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
 * Shared by `build-site` and `serve-site` so the two stay in sync.
 */
export function applyBuildSiteOptions(command: Command): Command {
  return command
    .option('-v, --verbose', 'Show list of cards to be fetched')
    .option(
      '--cache-images',
      'Download and use local deck card images instead of Scryfall image URLs',
    )
    .option('--decks [names...]', 'Deck names or URLs to build (default: all in decks/)')
    .option('--collections [names...]', 'Collection names to build (default: all in collections/)')
    .option('--wanted-lists [names...]', 'Wanted list names to build (default: all in wanted/)')
    .option(
      '--collection-sort <field>',
      'Default sort order for collections (file-order, name, price, set-code, type, cmc, color-identity)',
      'file-order',
    )
    .option(
      '--deck-sort <field>',
      'Default sort order for decks (name, cmc, price, type, edhrec, color-identity)',
      'name',
    )
    .option(
      '--currencies <list>',
      'Comma-separated currencies to include: usd, eur, tix (default: all three; first is default)',
    )
    .option('-y, --yes', 'Skip confirmation prompts and auto-accept (e.g. bulk cache redownload)')
    .option(
      '--theme <name>',
      `Initial theme baked into the generated HTML (${themeNames.join(', ')}, or a custom theme name loaded via --theme-file)`,
      'default',
    )
    .option(
      '--theme-file <path...>',
      'Load one or more custom theme JSON files; their names become selectable alongside the built-ins',
    )
}

export function registerBuildSiteCommand(program: Command): void {
  applyBuildSiteOptions(
    program.command('build-site').description('Generate a static website for decks'),
  ).action(async (options: BuildSiteOptions) => {
    await runBuildSite(options)
  })
}
