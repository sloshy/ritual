import path from 'node:path'
import { compareData } from '../i18n/collate'
import fs from 'node:fs/promises'
import {
  extractChangelogCardNames,
  parseChangelog,
  type ChangelogPage,
} from '../changes/changelog-parser'
import { computeRepresentativePrints } from '../scryfall'
import { getErrorMessage } from '../util/errors'
import { t } from '../i18n/t'
import { buylistRequestFor, quoteKey, type BuylistQuote } from '../buylist'
import { loadCardArt, type CardArtMap, type CardArtRef } from '../list/card-art'
import {
  cardCategoriesOf,
  cardCategoriesToJson,
  emptyCardCategoriesRecord,
  isEmptyCardCategoriesRecord,
  loadCardCategories,
  type CardCategoriesJson,
  type CardCategoriesRecord,
} from '../list/card-categories-sidecar'
import { loadDefaultCategories } from '../config/ritual-config'
import type { CardCategoriesOverlay } from '../card/card-categories'
import {
  isListImageCardRef,
  isListImageUrlRef,
  readListImage,
  type ListImageRef,
} from '../list/list-image'
import { readListDescription } from '../list/list-description'
import { foldedCardNameSet } from '../list/card-names'
import { readFrontMatterMapping } from '../list/front-matter-write'
import { printingFinishPairs } from '../card/card-printing'
import { siteArtUrl } from '../list/art-url'
import { resolveCardImageSources } from '../card/image-sources'
import type { CardLanguage } from '../card/card-language'
import type { Finish } from '../card/finish-condition'
import type { ScryfallCard } from '../scryfall/types'
import type { BakedBuylist } from '../list/site-data'
import type { ListType } from '../list/list-type'
import type { CardLabel } from '../card/card-labels'
import type { FlatListEntry, ParsedFlatListFile } from '../list/flat-list-read'
import { parseTitleFromContent } from '../list/section-format'
import type { SiteDetailContext } from './types'

/**
 * Why a list file could not be read, as the `Failed to load <kind> '<name>':`
 * lead-in's reason. An absent file gets the friendly wording; everything else
 * (`EACCES`, `EISDIR`, `EIO`, a parse failure) reports what actually happened,
 * since telling a user their present-but-unreadable file is "not found" sends
 * them looking for the wrong problem.
 */
export function listReadErrorMessage(error: unknown, filePath: string): string {
  if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
    return t('site.detail.fileNotFound', { path: filePath })
  }
  return getErrorMessage(error)
}

/** The front-matter keys a flat list's detail bakes, and what their bad values cost. */
export type ListFrontMatterRead = {
  /** The list's prose blurb, when it declares a usable one. */
  description?: string
  /** The list's cover override, when it declares a usable one. */
  image?: ListImageRef
  /**
   * Localized build warnings for the values the grammars refused. Advisories by
   * nature — the block round-trips verbatim, so the list still loads — but the
   * user hears about every one of them through the same channel.
   */
  warnings: string[]
}

/**
 * Read the keys a flat list's detail interprets out of its already-parsed
 * front-matter mapping. One reader for both flat list types, so a key added
 * here reaches a collection and a wanted list at once — the drift the per-loader
 * copies of this block invited.
 *
 * Deliberately *not* the deck path: a deck's front matter is validated into a
 * typed shape by `parseDeckFrontMatter`, which drops what it cannot read before
 * a loader ever sees it (see {@link readDroppedFrontMatterAdvisories}).
 */
export function readListFrontMatter(data: Record<string, unknown>): ListFrontMatterRead {
  const description = readListDescription(data)
  const image = readListImage(data)
  return {
    ...(description.description ? { description: description.description } : {}),
    ...(image.image ? { image: image.image } : {}),
    warnings: [
      ...(description.advisory
        ? [t('site.detail.listDescriptionInvalid', { reason: description.advisory })]
        : []),
      ...(image.advisory ? [t('site.detail.listImageInvalid', { reason: image.advisory })] : []),
    ],
  }
}

/**
 * The deck counterpart of {@link readListFrontMatter}'s warnings: `description`
 * and `image` values `validateDeckFrontMatter` dropped, read back off the raw
 * block so the drop is audible. A deck's next whole-file save deletes the key
 * outright, so silence here would lose a user's value without a word.
 *
 * Paid only by a deck that ended up with neither key — which is every deck that
 * set neither, so the read is cheap and the file is already warm.
 */
export async function readDroppedFrontMatterAdvisories(filePath: string): Promise<string[]> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    // The deck itself loaded, so an unreadable file here is a race, not a
    // condition the user can act on.
    return []
  }
  const mapping = readFrontMatterMapping(content)
  if (!mapping.ok) return []
  return readListFrontMatter(mapping.data).warnings
}

/** URL-safe slug for a list's display name (also the detail JSON's basename). */
export function slugifyListName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Printings sorted newest-first by release date (input is not mutated). */
export function sortPrintingsByRelease(printings: ScryfallCard[]): ScryfallCard[] {
  return [...printings].sort((a, b) => compareData(b.released_at ?? '', a.released_at ?? ''))
}

export type ListSidecars = {
  changelog: ChangelogPage[]
  /** ISO mtime of the list file, or undefined when it can't be statted. */
  fileMtime?: string
  /** Custom art from the `.art.json` sidecar; empty when the list has none. */
  art: CardArtMap
  /**
   * What was wrong with the art sidecar, already phrased for the caller's
   * warning channel. A sidecar that cannot be parsed yields no art at all.
   */
  artWarnings: string[]
  /** The list's categories from the `.categories.json` sidecar; the empty record when it has none. */
  cardCategories: CardCategoriesRecord
  /** What was wrong with the categories sidecar, phrased for the caller's warning channel. */
  categoryWarnings: string[]
}

export type ListSidecarOptions = {
  /**
   * The card ids the list currently has. Art entries pointing outside it are
   * reported (by raw id — the cards they named are gone) and still loaded.
   */
  knownCardIds?: ReadonlySet<number>
  /**
   * Every card name the list holds, folded through `foldCategoryCardName`
   * (`foldedCardNameSet` in `../list/card-names`). Sidecar entries outside it are
   * reported stale and still loaded. Omitted when the parse was lossy — a line
   * the grammar refused still holds a card (the `listCategories` gate, phase 3).
   */
  knownCardNames?: ReadonlySet<string>
}

/**
 * Read a list's optional sidecars — `.changes.md` and `.art.json`, absence is
 * normal for both — and the list file's mtime. Shared by all three list loaders.
 */
export async function loadListSidecars(
  dir: string,
  baseName: string,
  listFilePath: string,
  options: ListSidecarOptions = {},
): Promise<ListSidecars> {
  let changelog: ChangelogPage[] = []
  try {
    const changelogContent = await fs.readFile(path.join(dir, `${baseName}.changes.md`), 'utf-8')
    changelog = parseChangelog(changelogContent).pages
  } catch {
    // No changelog file, that's fine
  }

  let fileMtime: string | undefined
  try {
    const stat = await fs.stat(listFilePath)
    fileMtime = stat.mtime.toISOString()
  } catch {
    // The caller already loaded the list file; ignore stat errors.
  }

  const loadedArt = await loadCardArt(listFilePath, { knownCardIds: options.knownCardIds })
  const artWarnings: string[] = []
  if (!loadedArt.ok) {
    artWarnings.push(t('site.detail.artUnreadable', { reason: loadedArt.message }))
  } else {
    for (const warning of loadedArt.warnings) {
      artWarnings.push(t('site.detail.artUnknownCards', { ids: warning.ids.join(', ') }))
    }
  }

  const loadedCategories = await loadCardCategories(listFilePath, {
    ...(options.knownCardNames === undefined ? {} : { knownCardNames: options.knownCardNames }),
  })
  const categoryWarnings: string[] = []
  if (!loadedCategories.ok) {
    categoryWarnings.push(
      t('site.detail.categoriesUnreadable', { reason: loadedCategories.message }),
    )
  } else {
    for (const warning of loadedCategories.warnings) {
      categoryWarnings.push(
        t('site.detail.categoriesUnknownCards', { names: warning.names.join(', ') }),
      )
    }
  }

  return {
    changelog,
    fileMtime,
    art: loadedArt.ok ? loadedArt.art : new Map(),
    artWarnings,
    // Exactly the art branch's shape: an unreadable sidecar yields no categories
    // at all, and the warning above is the only report.
    cardCategories: loadedCategories.ok ? loadedCategories.categories : emptyCardCategoriesRecord(),
    categoryWarnings,
  }
}

/** Anything carrying a card line's `&N` id — every list type's entry shape. */
export type CardIdBearing = {
  cardId?: number
}

/** The one thing the categories join needs of a flat-list entry: its card name. */
export type NamedFlatListEntry = FlatListEntry & { name: string }

/**
 * A loaded collection or wanted list: the parsed file plus its sidecars. The
 * front-matter fields (`description`, `image`, and `labels` — which only the
 * collection grammar can produce) are present when declared and usable; an
 * unreadable value is a warning.
 */
export type LoadedFlatList<Entry> = {
  /** The `# Title`, falling back to the file's base name. */
  displayName: string
  entries: Entry[]
  /** Section names in file order, including empty sections. */
  sectionOrder: string[]
  labels?: CardLabel[]
  description?: string
  image?: ListImageRef
  /** Custom art from the `.art.json` sidecar, keyed by card id. */
  art?: CardArtMap
  /** The list's categories from the `.categories.json` sidecar; absent when it has none. */
  cardCategories?: CardCategoriesRecord
  /** What was wrong with the categories sidecar; absent/empty when clean. */
  categoryWarnings?: string[]
  warnings: string[]
  changelog: ChangelogPage[]
  fileMtime?: string
}

/** What the loader reads off either flat-list parser's result. */
export type FlatListParseResult<Entry extends FlatListEntry> = Pick<
  ParsedFlatListFile<Entry>,
  'entries' | 'sectionOrder' | 'frontMatter' | 'warnings' | 'advisories'
> & { labels?: CardLabel[] }

/**
 * Load a collection or wanted list markdown file plus its sidecars through
 * the given parser. Returns an error message string when the file can't be
 * read.
 */
export async function loadFlatListSource<Entry extends NamedFlatListEntry>(
  dir: string,
  name: string,
  parse: (content: string) => FlatListParseResult<Entry>,
): Promise<LoadedFlatList<Entry> | string> {
  const baseName = name.endsWith('.md') ? name.slice(0, -3) : name
  const filePath = path.join(dir, `${baseName}.md`)

  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    // Just the reason: the caller owns the "Failed to load <kind> '<name>'"
    // lead-in, so all three list types report a failed read identically.
    return listReadErrorMessage(error, filePath)
  }

  const { entries, sectionOrder, labels, warnings, advisories, frontMatter } = parse(content)
  // The block is carried verbatim by the flat parser, so the keys the site
  // interprets are read off its mapping here rather than during the parse. A
  // value a grammar cannot read degrades to a warning — the list still loads.
  const {
    description,
    image,
    warnings: frontMatterWarnings,
  } = readListFrontMatter(frontMatter?.data ?? {})
  // The lossless gate (phase 3's `listCategories`): a line the grammar refused
  // still holds a card, so an incomplete name set would malign live assignments.
  const parsedLosslessly = warnings.length === 0 && advisories.length === 0
  const { changelog, fileMtime, art, artWarnings, cardCategories, categoryWarnings } =
    await loadListSidecars(dir, baseName, filePath, {
      knownCardIds: cardIdsOf(entries),
      ...(parsedLosslessly
        ? { knownCardNames: foldedCardNameSet(entries.map((entry) => entry.name)) }
        : {}),
    })
  return {
    displayName: parseTitleFromContent(content) ?? name,
    entries,
    sectionOrder,
    labels,
    description,
    image,
    art,
    cardCategories,
    categoryWarnings,
    // The parser's own advisories ride the same channel as its warnings and the
    // sidecar's: an ignored `labels:` and an ignored `image:` are both things
    // the user must hear about, and reporting one but not the other would be an
    // inconsistency with no reason behind it.
    warnings: [
      ...warnings,
      ...advisories,
      ...frontMatterWarnings,
      ...artWarnings,
      ...categoryWarnings,
    ],
    changelog,
    fileMtime,
  }
}

/** The ids a list currently has, which an art sidecar's keys are checked against. */
export function cardIdsOf(entries: Iterable<CardIdBearing>): Set<number> {
  const ids = new Set<number>()
  for (const entry of entries) {
    if (entry.cardId !== undefined) ids.add(entry.cardId)
  }
  return ids
}

/**
 * What one card's custom art bakes to: the image to display, and whether the
 * list's sidecar names the card at all. The two answers are deliberately
 * separate — a reference whose file the build could not deploy has no image to
 * show, but the copy in hand still wears custom art, so it is still priceless.
 */
export type BakedCardArt = {
  /**
   * The display URL, or absent when there is nothing to show: no reference at
   * all, or one naming a file the build could not deploy (the card then falls
   * back to its real printing's image rather than pointing at a 404).
   */
  customArt?: string
  /**
   * Whether the sidecar gives this card custom art — the pricelessness fact,
   * true even when {@link BakedCardArt.customArt} is absent. Left off entirely
   * for the overwhelming majority of cards, which have no art reference.
   */
  hasCustomArt?: boolean
}

/** The custom-art fields a baked entry carries, by card id. */
export type CustomArtLookup = (cardId: number | undefined) => BakedCardArt

/** Shared so every art-less card spreads the same empty object. */
const NO_CARD_ART: BakedCardArt = {}

/**
 * The display URL one art reference bakes to: a URL verbatim, a file as the
 * site-relative `art/<relpath>` that both the built site and `serve --api`'s
 * `/art/*` route answer for — and `undefined` for a file the build referenced
 * but could not deploy, which is what makes the caller fall back rather than
 * point at a 404.
 *
 * `missing` is the build's undeployed set; passing `undefined` (the live
 * server, which deploys nothing and serves the art directory itself) bakes
 * every reference and lets the art route answer for the file. That is
 * deliberate: a live `file` reference naming a path that is not there 404s in
 * the browser rather than falling back, exactly as a card's custom art does,
 * and no `stat()` is added to the request path to "fix" it.
 *
 * Shared by {@link customArtLookup} (a card's art) and {@link resolveListCover}
 * (a list's cover), so the deploy-awareness rule is stated exactly once.
 */
export function artRefUrl(
  ref: CardArtRef,
  missing: ReadonlySet<string> | undefined,
): string | undefined {
  if ('url' in ref) return ref.url
  if (missing?.has(ref.file)) return undefined
  return siteArtUrl(ref.file)
}

/**
 * Resolve a list's custom art into the fields baked onto each entry: the
 * display URL from {@link artRefUrl}, and whether the sidecar names the card.
 *
 * References whose file the build could not deploy bake no display URL, so the
 * card falls back to its real art — the build already warned about each of
 * those (`deployCardArt`), so nothing is said here. They still report
 * `hasCustomArt`, which is what keeps the site's pricing in step with
 * `ritual price`: both judge the copy by the *reference* the list wrote, never
 * by whether an image happened to make it into `dist/`.
 */
export function customArtLookup(
  art: CardArtMap | undefined,
  ctx: SiteDetailContext,
): CustomArtLookup {
  if (!art || art.size === 0) return () => NO_CARD_ART
  const missing = ctx.missingArtFiles
  return (cardId) => {
    if (cardId === undefined) return NO_CARD_ART
    const ref = art.get(cardId)
    if (!ref) return NO_CARD_ART
    const url = artRefUrl(ref, missing)
    return url === undefined ? { hasCustomArt: true } : { customArt: url, hasCustomArt: true }
  }
}

/** The categories a baked entry carries, resolved by card name. */
export type CardCategoriesLookup = (cardName: string) => CardCategoriesOverlay

/** Shared so every uncategorized card spreads the same empty object. */
const NO_CARD_CATEGORIES: CardCategoriesOverlay = {}

/**
 * Resolve a list's categories into the field baked onto each entry. Goes through
 * `cardCategoriesOf` — the one per-card resolution — so no bake re-joins
 * `categories.cards` by raw name (the fold is `foldCategoryCardName`).
 */
export function cardCategoriesLookup(
  record: CardCategoriesRecord | undefined,
): CardCategoriesLookup {
  if (!record || record.cards.size === 0) return () => NO_CARD_CATEGORIES
  return (cardName) => {
    const own = cardCategoriesOf(record, cardName)
    return own === undefined ? NO_CARD_CATEGORIES : { categories: own }
  }
}

/** The list-level category fields a baked detail carries. */
export type BakedListCategoryFields = {
  categories?: CardCategoriesJson
  categoryWarnings?: string[]
}

/**
 * The list-level categories bake, stated once for all three list types: the
 * baked `order` is the **resolved** order a Ritual write would persist (which is
 * why the config defaults are passed), and a list with no categories carries no
 * key at all — absent means absent, never `{}`.
 */
export async function bakedListCategoryFields(
  record: CardCategoriesRecord | undefined,
  warnings: readonly string[] | undefined,
): Promise<BakedListCategoryFields> {
  const categories =
    record && !isEmptyCardCategoriesRecord(record)
      ? cardCategoriesToJson(record, await loadDefaultCategories())
      : undefined
  return {
    ...(categories ? { categories } : {}),
    ...(warnings?.length ? { categoryWarnings: [...warnings] } : {}),
  }
}

/**
 * A list's cover image on the site index: the featured entry's own custom art
 * when it wears some, the featured printing's front image otherwise.
 *
 * The art is the *entry's*, not the printing's, so it wins even for an entry
 * whose printing resolved to nothing. A reference the build could not deploy
 * carries no URL (see {@link customArtLookup}), which lands here as `undefined`
 * and leaves the cover on the real printing — the same degraded rendering the
 * list pages get. Empty when there is neither.
 */
export function coverImage(
  card: ScryfallCard | null,
  useScryfallImgUrls: boolean,
  customArt: string | undefined,
): string {
  if (!card) return customArt ?? ''
  return resolveCardImageSources(card, useScryfallImgUrls, customArt).frontImage
}

/**
 * The card a `card:` cover names, as the list's own walk found it: the printing
 * that line displays, plus the custom art the line wears (which wins over the
 * printing, exactly as it does on the list page).
 */
export type ListCoverOverrideEntry = {
  /** The line's displayed printing; null when the build could not resolve one. */
  card: ScryfallCard | null
  /** The line's custom-art display URL, when it has one the build deployed. */
  customArt?: string
}

/**
 * Why a cover override could not be honoured. Returned rather than warned about
 * so each builder reports it through its own channel — the same split
 * {@link loadListSidecars} makes with `artWarnings`.
 */
export type ListCoverIssue =
  /** The `&N` the cover names is not on the list any more. */
  | { kind: 'unknown-card'; id: number }
  /** The cover's file was referenced but not deployed into the build. */
  | { kind: 'undeployed-file'; path: string }

export type ListCoverInput = {
  /** The list's `image:` front-matter override, when it declares one. */
  image?: ListImageRef
  /** Present iff `image` is a card reference whose `&N` the entry walk found. */
  override?: ListCoverOverrideEntry
  /** The built-in pick: the commander, or the list's most expensive printing. */
  featured: ScryfallCard | null
  /** The built-in pick's own custom art, when its line wears some. */
  featuredCustomArt?: string
  useScryfallImgUrls: boolean
  /** The build's undeployed art paths; absent means every reference is baked. */
  missingArtFiles?: ReadonlySet<string>
}

/** A resolved cover: the URL to bake, and what went wrong on the way if anything. */
export type ListCoverResult = {
  /** The image to bake; empty when there is nothing to show at all. */
  url: string
  /** Set when an override was declared but not used; the cover fell back. */
  issue?: ListCoverIssue
}

/**
 * Pick the image a list's index tile shows: its `image:` override when it
 * declares a usable one, the built-in rule otherwise.
 *
 * Pure by design — no context, no list name, no `t()`. Every failure falls back
 * to the built-in cover and is *reported* rather than logged, so the three
 * builders (and the live server, which runs the same builders) share one
 * decision and each one words its own warning.
 *
 * The order, and why each branch degrades the way it does:
 *
 * 1. No override — today's behaviour byte for byte.
 * 2. `url` — carried verbatim, never validated. A URL names a resource on
 *    somebody else's server; whether it loads is the browser's problem, and a
 *    build-time fetch to find out would be a network call per list.
 * 3. `file` — deployed like a card's custom art. A file the build could not
 *    deploy has no URL to bake, so the cover falls back and the caller is told;
 *    `build-site` already prints one warning per undeployed path, so that
 *    branch deliberately says nothing more.
 * 4. `card` whose `&N` no entry carried — the reference is stale (the line was
 *    removed outside the reconcile), so the caller warns and the cover falls
 *    back.
 * 5. `card` the walk found — that line's image, custom art included. A line
 *    whose printing did not resolve and which wears no art yields an empty
 *    string and falls back **silently**: the unresolvable-printing warning
 *    already fired on that entry, and a second message here would double-warn
 *    every list holding a pin the cache cannot satisfy.
 */
export function resolveListCover(input: ListCoverInput): ListCoverResult {
  const { image, featured, featuredCustomArt, useScryfallImgUrls } = input
  const fallback = (): string => coverImage(featured, useScryfallImgUrls, featuredCustomArt)
  if (!image) return { url: fallback() }

  if (isListImageCardRef(image)) {
    const override = input.override
    if (!override) return { url: fallback(), issue: { kind: 'unknown-card', id: image.card } }
    const url = coverImage(override.card, useScryfallImgUrls, override.customArt)
    return { url: url === '' ? fallback() : url }
  }

  // A URL is carried verbatim and cannot fail here; only a file reference can
  // come back undefined, and only because the build did not deploy it — so the
  // URL branch is settled first and the issue always names a real path.
  if (isListImageUrlRef(image)) return { url: image.url }
  const url = artRefUrl(image, input.missingArtFiles)
  if (url !== undefined) return { url }
  return { url: fallback(), issue: { kind: 'undeployed-file', path: image.file } }
}

/**
 * One printing to quote while baking a list's buylist offers: the card object a
 * tile will actually display, plus the entry's own finish and language tokens.
 *
 * Deliberately shaped like the client's `buylistRequestFor` inputs — the baked
 * keys have to be exactly the ones `buylistFieldsFor` looks up, or sell mode
 * shows "not on the buylist" for cards the buyer is happily buying.
 */
export type BuylistBakeSource = {
  /** The displayed card; a null (unresolved) printing is skipped. */
  card: ScryfallCard | null
  /** The entry's `[foil]` token when it has one; resolved through `displayFinish`. */
  finish?: Finish
  /** The entry's `[ja]`-style token; absent means English. */
  language?: CardLanguage
}

/**
 * Quote every displayed printing of one list against `ctx.buylist`, keyed by
 * {@link quoteKey}.
 *
 * Returns `undefined` when the context carries no buylist — the detail then
 * omits the field entirely, which is what tells the client "nothing was quoted"
 * as opposed to "quoted, and none of these cards are wanted" (an empty
 * `quotes` map).
 *
 * Requests are built through the shared `buylistRequestFor` — the same function
 * the client's `buylistFieldsFor` looks its quotes up with, so the keys on both
 * sides can never drift. It also owns the English-only gate: a buyer's feed is
 * English-only and keyed by `set:cn`, which an alternate-language object
 * *shares* with its English twin, so quoting one would price a foreign card at
 * the English offer.
 *
 * That gate deliberately runs *ahead of* the `asked` dedupe below rather than
 * inside it. A leading `[ja]` line would otherwise claim the shared
 * `set:cn:finish` key and leave its English twin unpriced — the behaviour pinned
 * by 'a non-English copy is never quoted, and never suppresses its English twin'
 * in `test/unit/site-build/details.test.ts`.
 */
export function bakeBuylistQuotes(
  ctx: SiteDetailContext,
  sources: readonly BuylistBakeSource[],
  printings: Record<string, ScryfallCard[]>,
): BakedBuylist | undefined {
  const buylist = ctx.buylist
  if (!buylist) return undefined

  // The displayed printings first, then — under the CK price source — every
  // alternate printing the list carries. Order matters: the `asked` dedupe
  // below keeps the first request for a key, and an entry's own finish/language
  // tokens are the ones sell mode looks its quote up with.
  const all: readonly BuylistBakeSource[] = buylist.quotePrintings
    ? [...sources, ...Object.values(printings).flatMap(printingFinishPairs)]
    : sources

  const quotes: Record<string, BuylistQuote> = {}
  const asked = new Set<string>()
  for (const source of all) {
    const request = buylistRequestFor(source.card, source.finish, source.language)
    if (!request) continue
    const key = quoteKey(request.set, request.collectorNumber, request.finish)
    if (asked.has(key)) continue
    asked.add(key)
    const quote = buylist.quote(request)
    if (quote) quotes[key] = quote
  }

  return {
    [buylist.buyer]: {
      quotes,
      feedCreatedAt: buylist.feedCreatedAt,
      feedRetrievedAt: buylist.feedRetrievedAt,
    },
  }
}

/**
 * Add changelog-referenced cards to a detail's card/printings maps so change
 * history card links resolve at runtime. Mutates `cardMap` and `printingsMap`.
 */
export async function includeChangelogCards(
  changelog: ChangelogPage[],
  cardMap: Record<string, ScryfallCard | null>,
  printingsMap: Record<string, ScryfallCard[]>,
  ctx: SiteDetailContext,
): Promise<void> {
  for (const clName of extractChangelogCardNames(changelog)) {
    const canonical = (await ctx.resolveCardName(clName.toLowerCase())) ?? clName
    if (!cardMap[canonical]) {
      // Find a representative card for this name
      const printingsForCard = await ctx.getPrintings(canonical)
      if (printingsForCard.length > 0) {
        if (!printingsMap[canonical]) {
          printingsMap[canonical] = printingsForCard
        }
        const sorted = sortPrintingsByRelease(printingsForCard)
        const repPrints = computeRepresentativePrints(
          sorted,
          sorted,
          ctx.availableCurrencies,
          ctx.bannedPrintings,
        )
        cardMap[canonical] = repPrints.usd?.representative ?? sorted[0]!
      }
    }
  }
}

/**
 * Report what {@link resolveListCover} could not honour, through the same
 * warning sink the builders use for an unresolvable printing.
 *
 * Exhaustive on purpose: `undeployed-file` deliberately says **nothing**.
 * `build-site` already prints its art-missing warning once for every path in
 * `undeployedArtFiles` — which also covers an unreadable source and a failed
 * copy — so a second "not found in the art directory" line here would be both a
 * duplicate and, for a permission error, wrong about the cause.
 */
export function reportListCoverIssue(
  cover: ListCoverResult,
  listType: ListType,
  listName: string,
  ctx: SiteDetailContext,
): void {
  const issue = cover.issue
  if (!issue) return
  switch (issue.kind) {
    case 'unknown-card':
      ctx.warn?.(
        `  ⚠️  ${t('site.detail.listImageUnknownCard', {
          kind: listType,
          name: listName,
          id: issue.id,
        })}`,
      )
      return
    case 'undeployed-file':
      // Intentionally silent — see this function's doc comment.
      return
    default: {
      const unreachable: never = issue
      throw new Error(`unhandled cover issue: ${JSON.stringify(unreachable)}`)
    }
  }
}
