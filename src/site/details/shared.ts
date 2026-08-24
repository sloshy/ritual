import path from 'node:path'
import { compareData } from '../../i18n/collate'
import fs from 'node:fs/promises'
import {
  extractChangelogCardNames,
  parseChangelog,
  type ChangelogPage,
} from '../../changelog-parser'
import { computeRepresentativePrints } from '../../scryfall'
import { getErrorMessage } from '../../errors'
import { t } from '../../i18n/t'
import { buylistRequestFor, quoteKey, type BuylistQuote } from '../../buylist'
import { loadCardArt, type CardArtMap, type CardArtRef } from '../../card-art'
import { isListImageCardRef, isListImageUrlRef, type ListImageRef } from '../../list-image'
import { printingFinishPairs } from '../../card-printing'
import { siteArtUrl } from '../art-url'
import { resolveCardImageSources } from '../image-sources'
import type { CardLanguage } from '../../card-language'
import type { Finish, ScryfallCard } from '../../types'
import type { BakedBuylist } from '../data-types'
import type { ListType } from '../../list-type'
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
}

export type ListSidecarOptions = {
  /**
   * The card ids the list currently has. Art entries pointing outside it are
   * reported (by raw id — the cards they named are gone) and still loaded.
   */
  knownCardIds?: ReadonlySet<number>
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
    changelog = parseChangelog(changelogContent)
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

  return { changelog, fileMtime, art: loadedArt.ok ? loadedArt.art : new Map(), artWarnings }
}

/** Anything carrying a card line's `&N` id — every list type's entry shape. */
export type CardIdBearing = {
  cardId?: number
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
 * in `test/unit/site/details.test.ts`.
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
