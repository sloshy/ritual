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
import { loadCardArt, type CardArtMap } from '../../card-art'
import { printingFinishPairs } from '../../card-printing'
import { siteArtUrl } from '../art-url'
import type { CardLanguage } from '../../card-language'
import type { Finish, ScryfallCard } from '../../types'
import type { BakedBuylist } from '../data-types'
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
 * Resolve a list's custom art into the fields baked onto each entry: a file
 * reference becomes the site-relative `art/<relpath>` that both the built site
 * and `serve --api`'s `/art/*` route answer for; a URL is carried verbatim.
 *
 * References whose file the build could not deploy bake no display URL, so the
 * card falls back to its real art — the build already warned about each of
 * those (`deployCardArt`), so nothing is said here. They still report
 * `hasCustomArt`, which is what keeps the site's pricing in step with
 * `ritual price`: both judge the copy by the *reference* the list wrote, never
 * by whether an image happened to make it into `dist/`. A context with no
 * {@link SiteDetailContext.missingArtFiles} (the live server) bakes every
 * reference and lets the art route answer for the file.
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
    if ('url' in ref) return { customArt: ref.url, hasCustomArt: true }
    if (missing?.has(ref.file)) return { hasCustomArt: true }
    return { customArt: siteArtUrl(ref.file), hasCustomArt: true }
  }
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
