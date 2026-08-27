import { Command } from 'commander'
import { cliRefreshPolicy } from '../cli/refresh-policy'
import { t } from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'
import { bakedDictionaries } from '../generated/locales'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getCardPrintings } from '../scryfall'
import { cardCache } from '../cache'
import { isRunningFromSource } from '../config/runtime'
import { resolveOutDir } from '../site-build/dist-dir'
import {
  addSellModeOption,
  applySellModeOverride,
  addRefreshOption,
  resolveBuildLocale,
} from '../cli/options'
import { buildAndPublish } from '../site-build/publish'
import {
  deployCardArt,
  undeployedArtFiles,
  type CardArtDeployResult,
  type CardArtDeployWarning,
} from '../site-build/art-deploy'
import {
  getArtDir,
  getBannedPrintings,
  getCollectionsDir,
  getDecksDir,
  getDefaultCurrency,
  getRitualConfig,
  getSiteApiBaseUrl,
  getSiteSelectionConfig,
  getUiLocale,
  getWantedDir,
} from '../config/ritual-config'
import { siteBuylistContext } from '../cardkingdom'
import type { SiteDetailContext } from '../site-build/types'
import {
  parseCurrenciesFlag,
  type PriceCurrencies,
  type PriceCurrency,
} from '../pricing/price-currency'
import type {
  CollectionSummary,
  DeckSummary,
  ListSummary,
  WantedListSummary,
} from '../list/site-data'
import type { ListType } from '../list/list-type'
import { getErrorMessage, ExitCode, type ExitCodeValue } from '../util/errors'
import { emptyCacheAdvice } from '../cache/freshness'
import { isThemeName, resolveThemeName, themeNames, type CustomTheme } from '../theme/themes'
import type { RefreshMode, RefreshPolicy } from '../cache/refresh'
import {
  buildSiteSpaFromSource,
  createSymbolCollector,
  loadCustomThemes,
  type SiteSpaAssets,
} from '../site-build/assets'
import {
  loadLocaleFiles,
  planLocales,
  type BuildLocale,
  type LocaleBuildPlan,
} from '../site-build/locales'
import {
  reportSkippedSources,
  resolveBuildSources,
  type BuildSources,
  type SourceCategory,
} from '../site-build/sources'
import { collectSiteLists, writeListDetails } from '../site-build/lists'
import {
  attachBuildTags,
  downloadCardImages,
  fetchBuildCards,
  loadBakedFeed,
  prepareCardCache,
} from '../site-build/card-fetch'
import { writeSiteIndex, writeSiteShell } from '../site-build/write-shell'

export interface BuildSiteOptions {
  verbose?: boolean
  cacheImages?: boolean
  /**
   * The UI locale baked into this site: `<html lang>`/`dir` and
   * `index.json.uiLocale`. Defaults to the `uiLocale` config value.
   */
  locale?: string
  /** Which dictionaries to publish into `dist/locales/`. `all` means every one available. */
  locales?: string[]
  /** Dictionary JSON files to load from disk, the locale analogue of `--theme-file`. */
  localeFile?: string[]
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
  /**
   * Offer sell mode for this run whatever `site.sellMode` says (enable-only;
   * absent follows the config). Set as a session override so the buylist
   * refresh, the baked quotes and `index.json` all agree — see
   * {@link applySellModeOverride}.
   */
  sellMode?: boolean
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
    return { ok: false, error: t('cli.buildSite.selectionFlagEmpty', { flag }) }
  }
  return { ok: true, names: value }
}

/** The settings a build runs under once every flag has been validated. */
type BuildSettings = {
  availableCurrencies: PriceCurrencies
  /** The currency the site opens in: the configured default when built, else the first built. */
  defaultCurrency: PriceCurrency
  customThemes: CustomTheme[]
  /** Either a built-in `ThemeName` or a custom name from `--theme-file`. */
  initialThemeName: string
  localePlan: LocaleBuildPlan
  distDir: string
}

/** Print a refusal, set the exit code, and yield the `undefined` the caller stops on. */
function refuse(message: string, code: ExitCodeValue): undefined {
  console.error(message)
  process.exitCode = code
  return undefined
}

/**
 * Validate the currency, theme, locale and output-directory flags, in that
 * order. Prints the first problem, sets the exit code, and returns undefined
 * so the caller can stop before anything is read or written.
 */
async function resolveBuildSettings(options: BuildSiteOptions): Promise<BuildSettings | undefined> {
  let availableCurrencies: PriceCurrencies
  try {
    availableCurrencies = parseCurrenciesFlag(options.currencies)
  } catch (e) {
    return refuse(getErrorMessage(e), ExitCode.UsageError)
  }
  // The site opens in the configured default currency when it's built at all,
  // otherwise the first built currency.
  const configuredCurrency = getDefaultCurrency()
  const defaultCurrency = availableCurrencies.includes(configuredCurrency)
    ? configuredCurrency
    : availableCurrencies[0]

  const customThemes = await loadCustomThemes(options.themeFile ?? [])
  if (typeof customThemes === 'string') return refuse(customThemes, ExitCode.RuntimeError)
  const customNames = new Set(customThemes.map((theme) => theme.name))
  let initialThemeName: string
  const rawTheme = (options.theme ?? 'default').toLowerCase()
  if (customNames.has(rawTheme)) {
    initialThemeName = rawTheme
  } else {
    // `resolveThemeName` returns an error message string for unknown names;
    // `isThemeName` is the runtime discriminator since both are strings.
    const resolved = resolveThemeName(options.theme)
    if (!isThemeName(resolved)) return refuse(resolved, ExitCode.UsageError)
    initialThemeName = resolved
  }

  // Dictionaries this build could publish: whatever was baked into the binary
  // plus whatever `--locale-file` hands it — how a *released* binary mints a
  // locale it was never built with, the escape hatch `--theme-file` gives themes.
  const localeFiles = await loadLocaleFiles(options.localeFile ?? [])
  if (typeof localeFiles === 'string') return refuse(localeFiles, ExitCode.RuntimeError)
  const localePlan = planLocales({
    locale: options.locale,
    locales: options.locales,
    configured: getUiLocale(),
    available: [
      ...bakedDictionaries.map(({ tag, catalog }): BuildLocale => ({ tag, catalog })),
      // Last wins: a file on disk overrides a baked dictionary for the same tag.
      ...localeFiles,
    ],
  })
  if (typeof localePlan === 'string') return refuse(localePlan, ExitCode.UsageError)
  for (const warning of localePlan.warnings) console.warn(warning)

  const outDir = resolveOutDir(options.outDir)
  if (!outDir.ok) return refuse(outDir.error, ExitCode.UsageError)
  return {
    availableCurrencies,
    defaultCurrency,
    customThemes,
    initialThemeName,
    localePlan,
    distDir: outDir.dir,
  }
}

/**
 * Parse the three selection flags: a bare `--decks` (no names) is a usage error
 * rather than a silent full build. Returns undefined after reporting one.
 */
export function parseSelectionFlags(options: BuildSiteOptions): SelectionFlagNames | undefined {
  const parsed = {
    deck: selectionFlagNames(options.decks, '--decks'),
    collection: selectionFlagNames(options.collections, '--collections'),
    wanted: selectionFlagNames(options.wantedLists, '--wanted-lists'),
  }
  const flagError = Object.values(parsed).find(isFlagError)
  if (flagError) return refuse(flagError.error, ExitCode.UsageError)
  return {
    deck: parsed.deck.ok ? parsed.deck.names : undefined,
    collection: parsed.collection.ok ? parsed.collection.names : undefined,
    wanted: parsed.wanted.ok ? parsed.wanted.names : undefined,
  }
}

function isFlagError(result: SelectionFlagResult): result is SelectionFlagError {
  return !result.ok
}

type SelectionFlagError = Extract<SelectionFlagResult, { ok: false }>

/** The names each selection flag carried, or undefined where the flag was absent. */
export type SelectionFlagNames = Record<ListType, string[] | undefined>

const ART_WARNING = {
  'source-unreadable': 'cli.buildSite.artSourceUnreadable',
  'copy-failed': 'cli.buildSite.artCopyFailed',
} as const satisfies Record<Exclude<CardArtDeployWarning['kind'], 'sidecar-unreadable'>, MessageKey>

/**
 * Copy custom art into the build before any detail is baked, so the bakers know
 * which references have no file. Every problem is warned about here, once per file.
 */
async function deployArtForBuild(
  categories: Iterable<SourceCategory>,
  buildDir: string,
): Promise<CardArtDeployResult> {
  const artDeploy = await deployCardArt({
    listFilePaths: [...categories].flatMap((category) =>
      category.buildable.map((source) => path.join(category.dir, `${source.basename}.md`)),
    ),
    artDir: getArtDir(),
    buildDir,
  })
  for (const warning of artDeploy.warnings) {
    console.warn(
      warning.kind === 'sidecar-unreadable'
        ? t('cli.buildSite.artSidecarFailed', { reason: warning.message })
        : t(ART_WARNING[warning.kind], { path: warning.relPath, reason: warning.message }),
    )
  }
  for (const relPath of artDeploy.missing) {
    console.warn(t('cli.buildSite.artMissing', { path: relPath, dir: getArtDir() }))
  }
  if (artDeploy.copied.length > 0) {
    console.log(
      t('cli.buildSite.artCopied', {
        counted: t('domain.count.files', { count: artDeploy.copied.length }),
      }),
    )
  }
  return artDeploy
}

/** Everything {@link bakeSite} needs that was settled before the scratch directory existed. */
type BakeInput = {
  options: Pick<BuildSiteOptions, 'cacheImages' | 'moxfieldUserAgent' | 'verbose'>
  settings: Omit<BuildSettings, 'distDir'>
  sources: BuildSources
  spa: SiteSpaAssets
  /** This run's `--refresh` policy. */
  policy: RefreshPolicy
}

/** Whether a bake should be published, and if not, why. */
type BakeResult = BakePublished | BakeWithheld
type BakePublished = { published: true }
type BakeWithheld = { published: false; reason: 'no-price-data' | 'named-source-skipped' }

/**
 * Bake the whole site into `buildDir`: art, symbols, cards, every list's
 * detail, then `index.json` and the shell.
 */
async function bakeSite(input: BakeInput, buildDir: string): Promise<BakeResult> {
  const { options, settings, sources, spa, policy } = input
  const { availableCurrencies, defaultCurrency, localePlan } = settings
  const { skipped, skipSource, categories } = sources
  const cacheImages = options.cacheImages === true
  const useScryfallImgUrls = !cacheImages
  const imagesDir = path.join(buildDir, 'images')
  const symbolsDir = path.join(imagesDir, 'symbols')
  await fs.mkdir(symbolsDir, { recursive: true })

  const artDeploy = await deployArtForBuild(Object.values(categories), buildDir)
  const { symbolMap, ensureSymbols } = await createSymbolCollector(policy.mode, symbolsDir)

  // Phase 1: Load every list and harvest the card names
  const { lists, cardNames } = await collectSiteLists({
    deckUrls: sources.deckUrls,
    categories,
    moxfieldUserAgent: options.moxfieldUserAgent,
    skipSource,
  })

  // Phase 2: Fetch Cards with Progress Bar
  const { uniqueCards, priceTimestampSeed } = await prepareCardCache({
    cardNames,
    policy,
    verbose: options.verbose === true,
  })
  const buylist = siteBuylistContext(await loadBakedFeed(policy))

  console.log(t('cli.buildSite.fetchingData'))
  const { cardData, latestPriceTimestamp } = await fetchBuildCards({
    uniqueCards,
    policy,
    availableCurrencies,
    // Card Kingdom's own printing picks, only when the site offers CK prices.
    ckQuote: buylist?.quotePrintings ? buylist.quote : null,
    cacheImages,
    imagesDir,
    ensureSymbols,
    priceTimestampSeed,
  })
  await attachBuildTags(cardData, policy)

  if (latestPriceTimestamp == null) {
    // Two very different causes wore the same message: an unusable cache, and a
    // workspace whose lists priced nothing because there are no cards in them.
    console.error(
      uniqueCards.length === 0
        ? t('cli.buildSite.noCardsToPrice')
        : emptyCacheAdvice(t('cli.buildSite.noPriceData')),
    )
    return { published: false, reason: 'no-price-data' }
  }
  const pricesDate = new Date(latestPriceTimestamp).toISOString()

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
    // Absent when sell mode is off or no feed could be had: every detail then
    // ships without a `buylist` field, which the site reads as "not baked".
    ...(buylist ? { buylist } : {}),
    // Art the copy pass did not deploy — absent, unreadable, or a failed
    // copy: those cards bake no `customArt` and fall back to their real art.
    // Already warned about above, once per file.
    missingArtFiles: undeployedArtFiles(artDeploy),
    onCardShipped: async (card) => {
      await ensureSymbols(card.mana_cost)
      await ensureSymbols(card.oracle_text)
      if (cacheImages) {
        await downloadCardImages(card, imagesDir)
      }
    },
    warn: (message) => console.warn(message),
  }

  // Phases 3–5: bake each kind's details. The summaries come back as the union
  // `writeListDetails` writes; each kind's array only ever holds its own shape.
  console.log(t('cli.buildSite.generatingData'))
  const write = (kind: ListType, loadingMessage?: string): Promise<ListSummary[]> =>
    writeListDetails({
      category: categories[kind],
      loads: lists[kind],
      buildDir,
      detailCtx,
      skipSource,
      loadingMessage,
    })
  const decks = (await write('deck')) as DeckSummary[]
  const collections = (await write(
    'collection',
    t('cli.buildSite.loadingCollections'),
  )) as CollectionSummary[]
  const wantedLists = (await write(
    'wanted',
    t('cli.buildSite.loadingWantedLists'),
  )) as WantedListSummary[]

  await writeSiteIndex(buildDir, {
    decks,
    collections,
    wantedLists,
    useScryfallImgUrls,
    defaultCurrency,
    availableCurrencies,
    pricesDate,
    uiLocale: localePlan.locale,
    availableLocales: localePlan.emitted.map((entry) => entry.tag),
    // Present only for split deployments (static site on a CDN + separately
    // hosted `ritual serve --api`); `serve --api` itself serves index.json
    // dynamically and shadows this value with a same-origin marker.
    apiBaseUrl: getSiteApiBaseUrl(),
  })
  await writeSiteShell({
    buildDir,
    spa,
    localePlan,
    initialThemeName: settings.initialThemeName,
    customThemes: settings.customThemes,
  })

  // A source the user *named* going missing is a failed build, not a partial
  // one: the scratch tree is discarded and the previous site stays published.
  // A discovered source that would not load is reported and built around.
  return skipped.some((source) => source.explicit)
    ? { published: false, reason: 'named-source-skipped' }
    : { published: true }
}

export async function runBuildSite(options: BuildSiteOptions): Promise<void> {
  // Before anything reads sell mode; see `applySellModeOverride` for the rule.
  applySellModeOverride(options)

  const settings = await resolveBuildSettings(options)
  if (!settings) return
  const { distDir } = settings
  // Lazy import: keeps `.compiled.{js,css}` text imports out of the source-mode
  // module graph (those files are gitignored). The path must stay a literal
  // string so `bun build --compile` can embed the module into the binary.
  const siteSpaAssets: SiteSpaAssets = isRunningFromSource()
    ? await buildSiteSpaFromSource()
    : (await import('../site/bundled-assets')).getBundledSiteAssets()
  // Explicit selections, parsed before anything is read.
  const flags = parseSelectionFlags(options)
  if (!flags) return
  // Which decks/collections/wanted lists are published. CLI flags override this
  // per category; otherwise the `site` config selection applies (default: all).
  const sources = await resolveBuildSources({
    named: flags,
    dirs: { deck: getDecksDir(), collection: getCollectionsDir(), wanted: getWantedDir() },
    selection: getSiteSelectionConfig(getRitualConfig().site),
  })
  const { skipped } = sources

  if (skipped.some((source) => source.explicit)) {
    // A source the *user named* is missing, ambiguous or unreadable — all known
    // before anything is fetched or written, so the previously published site is
    // left entirely alone.
    reportSkippedSources(skipped, false)
    process.exitCode = ExitCode.RuntimeError
    return
  }

  if (
    sources.deckUrls.length === 0 &&
    Object.values(sources.categories).every((category) => category.selection.sources.length === 0)
  ) {
    return refuse(t('cli.buildSite.nothingToBuild'), ExitCode.RuntimeError)
  }

  // How the cache refresh question is answered for this run (--refresh <mode>,
  // interactive by default).
  const policy = cliRefreshPolicy(options.refresh ?? 'ask')

  console.log(t('cli.buildSite.starting'))
  console.log(
    options.cacheImages === true
      ? t('cli.buildSite.cachingImages')
      : t('cli.buildSite.usingImageUrls'),
  )

  // Build into a scratch directory and swap it into place only once the build
  // has succeeded: clearing the output directory first meant any later failure
  // (an empty cache, a cold network, an unreadable list) left the published site
  // gone rather than merely stale. Same mechanism the admin build route uses.
  const published = await buildAndPublish(
    distDir,
    async (buildDir) =>
      (await bakeSite({ options, settings, sources, spa: siteSpaAssets, policy }, buildDir))
        .published,
  )

  if (skipped.length > 0) reportSkippedSources(skipped, published)
  if (published) console.log(t('cli.buildSite.done', { dir: distDir }))
  else process.exitCode = ExitCode.RuntimeError
}

/**
 * Register every commander option that maps to a {@link BuildSiteOptions} field.
 * Shared by `build-site` and `serve --build` so the two stay in sync.
 */
export function applyBuildSiteOptions(command: Command): Command {
  const withBuildFlags = addRefreshOption(command, t('help.buildSite.refresh'))
    .option('-v, --verbose', t('help.buildSite.verbose'))
    .option('--cache-images', t('help.buildSite.cacheImages'))
    .option('--decks [names...]', t('help.buildSite.decks'))
    .option('--collections [names...]', t('help.buildSite.collections'))
    .option('--wanted-lists [names...]', t('help.buildSite.wantedLists'))
    .option('--currencies <list>', t('help.buildSite.currencies'))
    .option(
      '--theme <name>',
      t('help.buildSite.theme', { themes: themeNames.join(', ') }),
      'default',
    )
    .option('--theme-file <path...>', t('help.buildSite.themeFile'))
    // Declared here so `build-site --help` documents the flag on the command it
    // belongs to — but see `resolveBuildLocale`: the root program declares
    // `--locale` too, and commander gives the root the value from either
    // position, so this declaration never receives one.
    .option('--locale <tag>', t('help.buildSite.locale'))
    .option('--locales <tags...>', t('help.buildSite.locales'))
    .option('--locale-file <path...>', t('help.buildSite.localeFile'))
    .option('--moxfield-user-agent <agent>', t('help.buildSite.moxfieldUserAgent'))
    .option('--out-dir <path>', t('help.buildSite.outDir'))
  // Registered here so `serve` inherits it too, but it is *not* build-only:
  // `serve --api` reads sell mode per request, which is why serve's
  // build-only-flags guard exempts it there alongside --refresh.
  return addSellModeOption(withBuildFlags, t('help.buildSite.sellMode'))
}

export function registerBuildSiteCommand(program: Command): void {
  const command = applyBuildSiteOptions(
    program.command('build-site').description(t('help.buildSite.description')),
  )
  command.action(async (options: BuildSiteOptions) => {
    await runBuildSite({ ...options, locale: resolveBuildLocale(command, options) })
  })
}
