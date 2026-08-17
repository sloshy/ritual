import { Command } from 'commander'
import { isCatalogEntryError, parseCatalogEntry } from '../i18n/catalog'
import { compareData } from '../i18n/collate'
import { en, type MessageKey } from '../i18n/messages/en'
import { isLocaleTagError, parseLocaleTag } from '../i18n/locale-tag'
import { DEFAULT_LOCALE } from '../i18n/runtime'
import { t } from '../i18n/t'
import type { LocaleCatalog, LocaleTag } from '../i18n/types'
import { bakedDictionaries } from '../generated/locales'
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
  attachTags,
} from '../scryfall'
import { cardCache, ensureCacheForCards } from '../cache'
import { isRunningFromSource } from '../runtime'
import type { ScryfallCard } from '../types'
import { resolveOutDir } from '../site/dist-dir'
import { addSellModeOption, applySellModeOverride } from './sell-mode-flag'
import { buildAndPublish } from '../site/publish'
import { deployCardArt, undeployedArtFiles } from '../site/art-deploy'
import {
  getArtDir,
  getBannedPrintings,
  getCollectionsDir,
  getDecksDir,
  getDefaultCurrency,
  getDefaultLanguage,
  getRitualConfig,
  getPriceSources,
  getSearchDebounceMs,
  getSiteApiBaseUrl,
  getSiteSellMode,
  wantsCardKingdomFeed,
  getSiteSelectionConfig,
  getUiLocale,
  getWantedDir,
  isConfigParseError,
  parseUiLocale,
} from '../ritual-config'
import {
  detailBuylistContext,
  ensureCardKingdomFeed,
  loadEnsuredFeed,
  type LoadedCardKingdomFeed,
} from '../cardkingdom'
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
import { deckCardNames, flatListCardNames } from '../site/details/card-names'
import type { SiteCardData, SiteDetailContext } from '../site/details/types'
import { parseCurrenciesFlag } from '../price-currency'
import type { PriceCurrency } from '../price-currency'
import { getErrorMessage } from '../errors'
import { PRICE_MAX_AGE_MS } from '../cache/constants'
import { emptyCacheAdvice, offerBulkPriceRefresh, offerTagDownload } from '../cache/freshness'
import {
  generateAllThemesCss,
  generateCustomThemeCss,
  isThemeName,
  parseCustomTheme,
  resolveThemeName,
  themeNames,
  type CustomTheme,
} from '../themes'
import { appBootScript, BOOT_SCRIPT_FILE, renderAppShell } from '../site/html-shell'
import { ExitCode } from './scripting'
import { addRefreshOption, bulkAllowed, refreshStaleAllowed, type RefreshMode } from '../refresh'

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
      return t('cli.buildSite.themeFileUnreadable', {
        path: filePath,
        reason: getErrorMessage(err),
      })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      return t('cli.buildSite.themeFileNotJson', {
        path: filePath,
        reason: getErrorMessage(err),
      })
    }
    const result = parseCustomTheme(parsed)
    if (typeof result === 'string') {
      return t('cli.buildSite.themeFileInvalid', { path: filePath, reason: result })
    }
    themes.push(result)
  }
  return themes
}

// ---------------------------------------------------------------------------
// Locales
// ---------------------------------------------------------------------------

/** One dictionary this build can publish, ready to write. */
export type BuildLocale = {
  tag: LocaleTag
  catalog: LocaleCatalog
}

/**
 * Parse a `--locale-file` document into a dictionary, or explain why it is not
 * one.
 *
 * Deliberately tolerant about *coverage* and strict about *shape*: keys the
 * English catalog does not have are dropped (a dictionary written against an
 * older build is still worth shipping — `t()` falls back per key), while a
 * value {@link parseCatalogEntry} refuses is a malformed file and fails the
 * build. `scripts/check-locales.ts` is the full validator; this is the build's
 * own gate on untrusted input, and it shares the shape parser with the browser's
 * dictionary fetch so the two can never disagree about what `t()` can render.
 */
export function parseLocaleFile(raw: string): LocaleCatalog | string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return t('cli.buildSite.localeFileNotJson', { reason: getErrorMessage(err) })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return t('cli.buildSite.localeFileNotObject')
  }
  const catalog: LocaleCatalog = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in en)) continue
    // The shape rule itself comes from `src/i18n/catalog.ts`, which is also what
    // the browser's dictionary fetch and `scripts/check-locales.ts` use. Only the
    // build-specific behavior stays here: drop keys English does not have, and
    // wrap the parser's explanation in a `cli.buildSite.localeFile*` message.
    const entry = parseCatalogEntry(value)
    if (isCatalogEntryError(entry)) {
      return t('cli.buildSite.localeFileBadValue', { key, reason: entry.error })
    }
    catalog[key] = entry
  }
  return catalog
}

/**
 * Load every `--locale-file`. The file *name* is the locale tag (`de-AT.json`),
 * matching the `locales/<tag>.json` layout translators work in and
 * `check-locales.ts --emit-template` writes.
 *
 * Returns an error message string on the first failure, like
 * {@link loadCustomThemes}.
 */
async function loadLocaleFiles(paths: readonly string[]): Promise<BuildLocale[] | string> {
  const locales: BuildLocale[] = []
  for (const filePath of paths) {
    const name = path.basename(filePath).replace(/\.json$/i, '')
    const tag = parseLocaleTag(name)
    if (isLocaleTagError(tag)) {
      return t('cli.buildSite.localeFileBadTag', { path: filePath, reason: tag.error })
    }
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      return t('cli.buildSite.localeFileUnreadable', {
        path: filePath,
        reason: getErrorMessage(err),
      })
    }
    const parsed = parseLocaleFile(raw)
    if (typeof parsed === 'string') {
      return t('cli.buildSite.localeFileInvalid', { path: filePath, reason: parsed })
    }
    locales.push({ tag, catalog: parsed })
  }
  return locales
}

/** What {@link planLocales} decides from. Nothing is read ambiently. */
export type LocalePlanInput = {
  /** The `--locale` value as typed, or undefined to fall back to the configured one. */
  locale: string | undefined
  /** The `--locales` values as typed, or undefined for the default (English only). */
  locales: readonly string[] | undefined
  /** The configured `uiLocale` — the baked default when no flag names one. */
  configured: LocaleTag
  /** Every dictionary this build could publish. English is implicit and never listed. */
  available: readonly BuildLocale[]
}

/** The locale decisions a build acts on. */
export type LocaleBuildPlan = {
  /** The baked default: `<html lang>`/`dir` and `index.json.uiLocale`. */
  locale: LocaleTag
  /** The dictionaries to publish into `dist/locales/`, English first. */
  emitted: BuildLocale[]
  /** Non-fatal notes to print — a baked locale with no dictionary, so far. */
  warnings: string[]
}

/**
 * Decide which locale this site is baked in and which dictionaries ship with
 * it. Pure, so the flag semantics are unit-testable; returns an error message
 * string for a usage error, per the repo's parser convention.
 *
 * A baked locale with no dictionary is a *warning*, not an error: a catalog
 * with zero coverage is the degenerate case of a partial one, and per the
 * missing-key contract those must stay shippable. A `--locales` tag with no
 * dictionary is an error, because that flag's whole job is to name files to
 * emit.
 */
export function planLocales(input: LocalePlanInput): LocaleBuildPlan | string {
  const bakedRaw = input.locale ?? input.configured
  const baked = parseUiLocale(bakedRaw)
  if (isConfigParseError(baked)) {
    return t('cli.buildSite.localeInvalid', { value: bakedRaw, reason: baked.error })
  }

  const byTag = new Map<string, BuildLocale>()
  for (const entry of input.available) byTag.set(entry.tag.toLowerCase(), entry)

  const wanted: LocaleTag[] = [DEFAULT_LOCALE]
  const addTag = (tag: LocaleTag): void => {
    if (!wanted.some((existing) => existing.toLowerCase() === tag.toLowerCase())) wanted.push(tag)
  }

  for (const requested of input.locales ?? []) {
    if (requested.trim().toLowerCase() === 'all') {
      for (const entry of input.available) addTag(entry.tag)
      continue
    }
    const tag = parseUiLocale(requested)
    if (isConfigParseError(tag)) {
      return t('cli.buildSite.localesInvalid', { value: requested, reason: tag.error })
    }
    if (tag !== DEFAULT_LOCALE && !byTag.has(tag.toLowerCase())) {
      return t('cli.buildSite.localesUnknown', { tag })
    }
    addTag(tag)
  }

  const warnings: string[] = []
  // The baked default is always emitted: a site whose shell says `lang="de"`
  // must be able to fetch the German dictionary it names.
  if (baked !== DEFAULT_LOCALE) {
    if (byTag.has(baked.toLowerCase())) addTag(baked)
    else {
      warnings.push(t('cli.buildSite.bakedLocaleUndictionaried', { tag: baked }))
    }
  }

  const emitted: BuildLocale[] = wanted.map(
    (tag) => byTag.get(tag.toLowerCase()) ?? { tag, catalog: en },
  )
  return { locale: baked, emitted, warnings }
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

/**
 * `3 decks` / `1 collection` — the counted-noun message for each list kind.
 * Keys rather than rendered strings, so the table can be built at module load
 * without freezing the wording in the locale that happened to be active then.
 */
const KIND_COUNT = {
  deck: 'domain.count.decks',
  collection: 'domain.count.collections',
  'wanted list': 'domain.count.wantedLists',
} as const satisfies Record<ListKind, MessageKey>

/**
 * The `$select` branch each list kind picks. A stable token rather than the
 * English noun, so a translator never has to reproduce `'wanted list'` as a
 * JSON key to hit the right branch.
 */
const KIND_BRANCH = {
  deck: 'deck',
  collection: 'collection',
  'wanted list': 'wanted',
} as const satisfies Record<ListKind, string>

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
    return { ok: false, error: t('cli.buildSite.selectionFlagEmpty', { flag }) }
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
  console.error(
    `\n${t('cli.buildSite.skippedHeader', {
      counted: t('domain.count.sources', { count: skipped.length }),
    })}`,
  )
  for (const source of skipped) {
    console.error(
      t('cli.buildSite.skippedEntry', {
        kind: KIND_BRANCH[source.kind],
        name: source.name,
        reason: source.reason,
      }),
    )
  }
  console.error(published ? t('cli.buildSite.publishedWithout') : t('cli.buildSite.leftUnchanged'))
}

export async function runBuildSite(options: BuildSiteOptions): Promise<void> {
  // Before anything reads sell mode; see `applySellModeOverride` for the rule.
  applySellModeOverride(options)

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

  // Dictionaries this build could publish: whatever was baked into the binary
  // (`RITUAL_BUNDLED_LOCALES`) plus whatever `--locale-file` hands it. The file
  // path is how a *released* binary mints a locale it was never built with —
  // the same escape hatch `--theme-file` gives themes.
  const localeFilesResult = await loadLocaleFiles(options.localeFile ?? [])
  if (typeof localeFilesResult === 'string') {
    console.error(localeFilesResult)
    process.exitCode = ExitCode.RuntimeError
    return
  }
  const availableLocaleCatalogs: BuildLocale[] = [
    ...bakedDictionaries.map(({ tag, catalog }): BuildLocale => ({ tag, catalog })),
    // Last wins: a file on disk overrides a baked dictionary for the same tag.
    ...localeFilesResult,
  ]
  const localePlan = planLocales({
    locale: options.locale,
    locales: options.locales,
    configured: getUiLocale(),
    available: availableLocaleCatalogs,
  })
  if (typeof localePlan === 'string') {
    console.error(localePlan)
    process.exitCode = ExitCode.UsageError
    return
  }
  for (const warning of localePlan.warnings) console.warn(warning)

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
    console.error(t('cli.buildSite.loadFailed', { kind: KIND_BRANCH[kind], name, reason }))
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
        skipSource(
          category.kind,
          name,
          t('cli.buildSite.sourceMissing', {
            kind: KIND_BRANCH[category.kind],
            dir: category.dir,
          }),
          true,
        )
      }
      for (const { name, matches } of resolved.ambiguous) {
        skipSource(
          category.kind,
          name,
          t('cli.buildSite.sourceAmbiguous', {
            counted: t(KIND_COUNT[category.kind], { count: matches.length }),
            matches: matches.join(', '),
          }),
          true,
        )
      }
    } else {
      for (const name of resolved.unmatchedIncludes) {
        console.warn(
          t('cli.buildSite.includeUnmatched', {
            kind: KIND_BRANCH[category.kind],
            configKey: category.configKey,
            name,
            dir: category.dir,
          }),
        )
      }
      // "Found" describes discovery, so it is printed for the config selection
      // only — a name that came from a flag was given, not found.
      if (resolved.sources.length > 0) {
        const names = resolved.sources.map((s) => s.displayName).join(', ')
        console.log(
          t('cli.buildSite.foundSources', {
            counted: t(KIND_COUNT[category.kind], { count: resolved.sources.length }),
            names,
          }),
        )
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
    console.error(t('cli.buildSite.nothingToBuild'))
    process.exitCode = ExitCode.RuntimeError
    return
  }

  // How the cache refresh question is answered for this run (--refresh <mode>,
  // interactive by default).
  const mode = options.refresh ?? 'ask'

  console.log(t('cli.buildSite.starting'))
  console.log(cacheImages ? t('cli.buildSite.cachingImages') : t('cli.buildSite.usingImageUrls'))

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

    // Custom art, before any detail is baked: a file that isn't there must be
    // known by the time the bakers decide which cards carry a `customArt` path.
    const artDeploy = await deployCardArt({
      listFilePaths: categories.flatMap((category) =>
        category.buildable.map((source) => path.join(category.dir, `${source.basename}.md`)),
      ),
      artDir: getArtDir(),
      buildDir,
    })
    for (const warning of artDeploy.warnings) {
      if (warning.kind === 'sidecar-unreadable') {
        console.warn(t('cli.buildSite.artSidecarFailed', { reason: warning.message }))
      } else if (warning.kind === 'source-unreadable') {
        console.warn(
          t('cli.buildSite.artSourceUnreadable', {
            path: warning.relPath,
            reason: warning.message,
          }),
        )
      } else {
        console.warn(
          t('cli.buildSite.artCopyFailed', { path: warning.relPath, reason: warning.message }),
        )
      }
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

    // Fetch and download symbols. `never` means "use the existing cache as-is",
    // so an uncached symbology is left uncached rather than downloaded — the site
    // then renders without mana symbols, which the warning says out loud.
    console.log(t('cli.buildSite.fetchingSymbols'))
    const symbologyNetwork = refreshStaleAllowed(mode)
    let symbols = await fetchSymbology({ network: symbologyNetwork })
    if (symbols.length === 0 && !symbologyNetwork) {
      console.warn(t('cli.buildSite.noSymbology'))
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
            console.error(t('cli.buildSite.symbolDownloadFailed', { symbol: s.symbol }), e)
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
        console.log(t('cli.buildSite.refreshingSymbology'))
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

    /**
     * Take a loaded deck into the build and harvest every card name it mentions
     * — sections, primer, and changelog, through the collector the live server
     * warms from and the detail builders resolve against.
     */
    const collectDeck = async (loaded: LoadedDeck): Promise<void> => {
      loadedDecks.push(loaded)
      console.log(t('cli.buildSite.loadedDeck', { name: loaded.data.name }))
      for (const name of await deckCardNames(loaded)) allCardNames.add(name)
    }

    // Phase 1: Load Decks
    if (deckUrls.length + deckCategory.buildable.length > 0) {
      console.log(t('cli.buildSite.loadingDecks'))
    }
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
      await collectDeck({ data: result, changelog: [], warnings: [], fileMtime: undefined })
    }
    for (const source of deckCategory.buildable) {
      const result = await loadDeckSource(decksDir, source.basename)
      if (typeof result === 'string') {
        skipSource('deck', source.displayName, result, deckSelection.explicit)
        continue
      }
      for (const warning of result.warnings) {
        console.warn(t('cli.buildSite.sourceWarning', { name: source.displayName, warning }))
      }
      await collectDeck(result)
    }

    // Pre-load wanted list card names so they're fetched along with deck/collection
    // cards. Phase 5 builds from the same resolved selection and the same loader,
    // so the two stay in sync; a list that fails to load here is reported there.
    for (const source of wantedCategory.buildable) {
      const loaded = await loadWantedSource(wantedListsSourceDir, source.basename)
      if (typeof loaded === 'string') continue
      for (const name of await flatListCardNames(loaded)) allCardNames.add(name)
    }

    // Phase 2: Fetch Cards with Progress Bar

    // Purge expired blocklist entries before fetching
    await cardCache.purgeExpiredBlocklist()

    const uniqueCards = Array.from(allCardNames)
    const totalCards = uniqueCards.length
    console.log(`\n${t('cli.buildSite.uniqueCards', { count: totalCards })}`)

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
      console.error(t('cli.buildSite.cacheDownloadFailed', { reason: getErrorMessage(e) }))
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
        console.log(t('cli.buildSite.fetchListHeader', { count: missingCards.length }))
        for (const name of missingCards) {
          console.log(t('cli.buildSite.fetchListEntry', { name }))
        }
      } else {
        console.log(t('cli.buildSite.allCardsCached'))
      }
    }

    const lastBulkRefresh = await cardCache.getLastRefreshedAt?.()
    await offerBulkPriceRefresh(uniqueCards, mode, cacheJustRefreshed)

    console.log(t('cli.buildSite.fetchingData'))

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
            compareData(b.released_at ?? '', a.released_at ?? ''),
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
            console.warn(t('cli.buildSite.noPricing', { name, currency: 'USD' }))
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
            console.warn(t('cli.buildSite.noPricing', { name, currency: 'EUR' }))
          }
          globalCheapestCardMapEur[name] = cheap ?? rep ?? card
        }

        if (hasTix) {
          const rep = repPrints.tix?.representative ?? null
          const cheap = repPrints.tix?.cheapest ?? null
          if (!rep) {
            globalMissingCards.tix!.add(name)
            console.warn(t('cli.buildSite.noPricing', { name, currency: 'TIX' }))
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
      // The bake into the cache happens inside; the returned index tags the
      // cards already loaded for this build, without a second download.
      const tagIndex = await offerTagDownload(mode)
      if (tagIndex) {
        for (const card of buildCards) attachTags(card, tagIndex)
      }
    }

    if (latestPriceTimestamp == null) {
      // Two very different causes wore the same message: an unusable cache, and a
      // workspace whose lists priced nothing because there are no cards in them.
      console.error(
        totalCards === 0
          ? t('cli.buildSite.noCardsToPrice')
          : emptyCacheAdvice(t('cli.buildSite.noPriceData')),
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

    // Sell mode's buy prices are baked into each list's data, so a build that
    // offers sell mode needs a current buyer feed — under this run's --refresh
    // policy, the same one the card cache answered to. Never fatal: a build that
    // cannot get a buylist is a site without buy prices, not a failed build.
    let bakedFeed: LoadedCardKingdomFeed | undefined
    if (wantsCardKingdomFeed()) {
      const feed = await ensureCardKingdomFeed(mode)
      if (typeof feed === 'string') {
        console.warn(t('cli.buildSite.buylistUnavailable', { reason: feed }))
      } else {
        // Adopting what this run holds, never re-reading the file it was just
        // handed — see `loadEnsuredFeed`, which both this and the servers' warm
        // share so the memo rule lives in one place.
        bakedFeed = await loadEnsuredFeed(feed)
        console.log(
          t('cli.buildSite.buylistReady', {
            counted: t('domain.count.items', { count: bakedFeed.file.feed.products.length }),
          }),
        )
      }
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
      // Absent when sell mode is off or no feed could be had: every detail then
      // ships without a `buylist` field, which the site reads as "not baked".
      ...(bakedFeed ? { buylist: detailBuylistContext(bakedFeed) } : {}),
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

    // Phase 3: Generate JSON data files and SPA bundle
    console.log(t('cli.buildSite.generatingData'))
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

    if (collectionCategory.buildable.length > 0) console.log(t('cli.buildSite.loadingCollections'))

    for (const source of collectionCategory.buildable) {
      const loaded = await loadCollectionSource(collectionsDir, source.basename)
      if (typeof loaded === 'string') {
        skipSource('collection', source.displayName, loaded, collectionSelection.explicit)
        continue
      }
      for (const w of loaded.warnings) {
        console.warn(t('cli.buildSite.sourceWarning', { name: source.displayName, warning: w }))
      }
      if (loaded.entries.length === 0) {
        console.log(t('cli.buildSite.noValidEntries', { name: source.displayName }))
        continue
      }

      const { slug, detail, summary } = await buildCollectionArtifacts(loaded, detailCtx)
      await Bun.write(path.join(collectionsDataDir, `${slug}.json`), JSON.stringify(detail))
      collectionsSummaries.push(summary)
      console.log(
        t('cli.buildSite.loadedList', {
          name: summary.name,
          counted: t('domain.count.cards', { count: summary.cardCount }),
          price: summary.totalPrice.toFixed(2),
        }),
      )
    }

    // Phase 5: Load and process wanted lists, from the selection resolved up front
    // (the card pre-load used the same one, so both stay in sync).
    const wantedListsSummaries: WantedListSummary[] = []
    const wantedListsDataDir = path.join(buildDir, 'wanted')
    await fs.mkdir(wantedListsDataDir, { recursive: true })

    if (wantedCategory.buildable.length > 0) console.log(t('cli.buildSite.loadingWantedLists'))

    for (const source of wantedCategory.buildable) {
      const loaded = await loadWantedSource(wantedListsSourceDir, source.basename)
      if (typeof loaded === 'string') {
        skipSource('wanted list', source.displayName, loaded, wantedSelection.explicit)
        continue
      }
      for (const w of loaded.warnings) {
        console.warn(t('cli.buildSite.sourceWarning', { name: source.displayName, warning: w }))
      }
      if (loaded.entries.length === 0) {
        console.log(t('cli.buildSite.noValidEntries', { name: source.displayName }))
        continue
      }

      const { slug, detail, summary } = await buildWantedArtifacts(loaded, detailCtx)
      await Bun.write(path.join(wantedListsDataDir, `${slug}.json`), JSON.stringify(detail))
      wantedListsSummaries.push(summary)
      console.log(
        t('cli.buildSite.loadedList', {
          name: summary.name,
          counted: t('domain.count.cards', { count: summary.cardCount }),
          price: summary.totalPrice.toFixed(2),
        }),
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
      defaultLanguage: getDefaultLanguage(),
      // The interface language, not the card language: `defaultLanguage` above
      // decides which printing of a card is shown, this decides what Ritual's
      // own text says. The two are orthogonal on purpose.
      uiLocale: localePlan.locale,
      availableLocales: localePlan.emitted.map((entry) => entry.tag),
      // Present only for split deployments (static site on a CDN + separately
      // hosted `ritual serve --api`); `serve --api` itself serves index.json
      // dynamically and shadows this value with a same-origin marker.
      apiBaseUrl: getSiteApiBaseUrl(),
      // The flag alone decides whether the site offers the sell toggle: each
      // list's detail carries its own baked quotes, so a fully static build
      // offers sell mode too, with no API base and no quote round trip.
      sellMode: getSiteSellMode(),
      // Which stores the site offers prices from. Empty means the site shows
      // no prices at all; `cardkingdom` reads its retail prices off the same
      // baked buylist quotes sell mode uses.
      priceSources: getPriceSources(),
    }
    await Bun.write(path.join(buildDir, 'index.json'), JSON.stringify(siteIndex))

    // Write pre-built SPA
    console.log(t('cli.buildSite.writingApp'))
    await Bun.write(path.join(buildDir, 'app.js'), siteSpaAssets.appJs)

    // Dictionaries as data, next to the one JS bundle. English is inline in the
    // bundle and never fetched; it is written anyway so a static host serves a
    // complete, self-describing `availableLocales` set.
    const localesDir = path.join(buildDir, 'locales')
    await fs.mkdir(localesDir, { recursive: true })
    for (const entry of localePlan.emitted) {
      await Bun.write(path.join(localesDir, `${entry.tag}.json`), JSON.stringify(entry.catalog))
    }
    console.log(
      t('cli.buildSite.writingLocales', {
        counted: t('domain.count.files', { count: localePlan.emitted.length }),
        locale: localePlan.locale,
      }),
    )

    // Theme *and* locale bootstrap, external so a `script-src 'self'` policy
    // accepts it — the public site has no such header today, but the admin does
    // and both shells are now the same code.
    await Bun.write(path.join(buildDir, BOOT_SCRIPT_FILE), appBootScript)
    await Bun.write(
      path.join(buildDir, 'index.html'),
      renderAppShell({
        lang: localePlan.locale,
        // i18n-exempt: the product name, a proper noun that is the same in every locale
        title: 'Ritual',
        initialTheme: initialThemeName,
        viewport: 'width=device-width, initial-scale=1.0, viewport-fit=cover',
      }),
    )

    // Write bundled CSS — emit every built-in theme as a `:root[data-theme=...]`
    // block so the runtime can switch by toggling the html attribute, plus
    // any custom themes from --theme-file.
    console.log(
      customThemes.length > 0
        ? t('cli.buildSite.writingCssCustom', {
            theme: initialThemeName,
            count: customThemes.length,
          })
        : t('cli.buildSite.writingCss', { theme: initialThemeName }),
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
  if (published) console.log(t('cli.buildSite.done', { dir: distDir }))
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

/** What {@link resolveBuildLocale} reads off the command tree. */
type GlobalLocaleOption = {
  locale?: string
}

/**
 * The `--locale <tag>` this build was given, from either flag position.
 *
 * `--locale` is declared twice: on the root program (the language Ritual's own
 * output speaks) and on the build surface (the locale baked into the generated
 * site). Commander resolves a flag against the *root* command while it scans
 * for the subcommand's operands, so the root consumes `build-site --locale de`
 * before the subcommand ever sees it and `options.locale` here is always
 * undefined. `optsWithGlobals()` is where the value actually lands.
 *
 * Read it rather than renaming the flag, so both documented spellings —
 * `ritual build-site --locale de` and `ritual --locale de build-site` — bake the
 * locale they name. The root's `argParser` has already rejected a malformed tag
 * with exit 2 by this point.
 */
export function resolveBuildLocale(
  command: Command,
  options: BuildSiteOptions,
): string | undefined {
  return options.locale ?? command.optsWithGlobals<GlobalLocaleOption>().locale
}

export function registerBuildSiteCommand(program: Command): void {
  const command = applyBuildSiteOptions(
    program.command('build-site').description(t('help.buildSite.description')),
  )
  command.action(async (options: BuildSiteOptions) => {
    await runBuildSite({ ...options, locale: resolveBuildLocale(command, options) })
  })
}
