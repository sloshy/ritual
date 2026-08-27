import { computeHash } from '../../changes/content-hash'
import { collectExistingIds } from '../../card/card-id'
import { apiHandler } from '../utils'
import { addChangelogCardNames, fetchSymbolMap, loadEntryCardData } from './card-data-loader'
import {
  LIST_LOAD_NOT_FOUND_HINT,
  resolveFlatListFile,
  resolveListFileOrRefuse,
  type ResolveListFile,
} from './list-file'
import {
  countEntries,
  filterEntries,
  isNarrowedLoad,
  parseListLoadParams,
  toCountParams,
  type ListLoadParams,
} from './list-load-params'
import type { CardLabel } from '../../card/card-labels'
import type { ListImageRef } from '../../list/list-image'
import type {
  FlatCardsLoadResult,
  FlatFullLoadResult,
  ListLoadStamp,
  ListSummaryLoadResult,
} from './load-results'
import { listArtRecord } from './art'
import { apiError } from '../../api/http'
import { parseSlugFromUrl } from './target'

/**
 * The shared half of `GET /api/{deck,collection,wanted}/:slug`.
 *
 * All three routes open the same way — parse the slug, resolve the file, parse
 * the view/filter query — and all three stamp the same mutually exclusive
 * `partial` / `contentHash` pair onto every body they return, summaries
 * included. That prologue and that stamping live here. Collections and wanted lists differ only in the directory,
 * the parser, and the wording of a refusal, so they share a whole handler
 * ({@link handleFlatListLoad}); decks keep their own body because front matter,
 * `filterDeck`, and the deck card-data load differ in ways a config could only
 * express as a bag of functions.
 */

/** What every list-load handler resolves before it can read anything. */
export interface ListLoadPrologue {
  slug: string
  filePath: string
  params: ListLoadParams
}

/** {@link readListLoadRequest}'s outcome: the prologue, or the response to return. */
export type ListLoadPrologueResult =
  | { ok: true; value: ListLoadPrologue }
  | { ok: false; response: Response }

/** Slug parse → file resolution → `?view/section/nameContains/limit/offset` parse. */
export async function readListLoadRequest(
  req: Request,
  dir: string,
  label: string,
  resolveFile: ResolveListFile,
): Promise<ListLoadPrologueResult> {
  const parsedSlug = parseSlugFromUrl(req)
  if (!parsedSlug.ok) return { ok: false, response: apiError(parsedSlug.message, 400) }
  const { slug } = parsedSlug

  const resolved = await resolveListFileOrRefuse(resolveFile, {
    slug,
    dir,
    label,
    notFoundHint: LIST_LOAD_NOT_FOUND_HINT,
  })
  if (!resolved.ok) return { ok: false, response: resolved.response }

  const params = parseListLoadParams(new URL(req.url).searchParams)
  if (typeof params === 'string') return { ok: false, response: apiError(params, 400) }

  return { ok: true, value: { slug, filePath: resolved.filePath, params } }
}

/**
 * Stamp the mutually exclusive `partial` / `contentHash` pair onto a load body.
 *
 * A narrowed body describes a slice, so it deliberately carries no hash: the
 * save routes require one, which is what makes saving a slice back impossible
 * rather than merely ill-advised. Every view goes through here, summaries
 * included — a filtered summary's counts are no more the whole file than a
 * filtered page of cards is.
 */
export function stampLoadBody<T extends ListLoadStamp>(
  body: T,
  partial: boolean,
  contentHash: string,
): T {
  if (partial) body.partial = true
  else body.contentHash = contentHash
  return body
}

/** A flat-list parser's output, as {@link handleFlatListLoad} consumes it. */
export interface FlatListParseResult<T> {
  entries: T[]
  sectionOrder: string[]
  /**
   * The list's prose blurb from its front matter, when it declares one. Read
   * here for the same reason {@link FlatListParseResult.image} is.
   */
  description?: string
  /** The list's default card labels from its front matter — collections only. */
  labels?: CardLabel[]
  /**
   * The list's cover image override from its front matter, when it declares a
   * usable one. Read here rather than in the handler because only the per-type
   * parser hands back the front-matter block it came from.
   */
  image?: ListImageRef
  /**
   * Lines the parser could not read. Carried through to every load body, so a
   * list holding an unreadable line no longer loads as merely shorter.
   */
  warnings: string[]
}

/**
 * The minimum a flat (collection | wanted) entry carries for load purposes: a
 * name (filtered on, and the key the card-data load resolves) and its section.
 */
export interface FlatLoadEntry {
  name: string
  section?: string
  /** The line's `&N`, which its custom art is keyed by. */
  cardId?: number
}

/** Everything a flat (collection | wanted) load differs by. */
export interface FlatListLoadConfig<T extends FlatLoadEntry> {
  /** Singular lowercase label, used verbatim in refusals. */
  label: string
  getDir: () => string
  /** The list type's file parser. The collection's implementation lowercases `set`. */
  parse: (content: string) => FlatListParseResult<T>
  /**
   * Whether this list type has entries that resolve *by card name* — a wanted
   * list's name-only lines. Only those can display a store's own printing pick,
   * so a collection (every entry names its printing) opts out and the load skips
   * the Card Kingdom selection entirely rather than computing a map no client
   * can read.
   */
  resolvesByName?: boolean
}

function sectionOf(entry: FlatLoadEntry): string | undefined {
  return entry.section
}

function nameOf(entry: FlatLoadEntry): string {
  return entry.name
}

/** The whole summary/cards/full body for a flat (collection | wanted) list. */
export function handleFlatListLoad<T extends FlatLoadEntry>(
  req: Request,
  cfg: FlatListLoadConfig<T>,
): Promise<Response> {
  return apiHandler(async () => {
    const prologue = await readListLoadRequest(req, cfg.getDir(), cfg.label, resolveFlatListFile)
    if (!prologue.ok) return prologue.response
    const { slug, filePath, params } = prologue.value

    const content = await Bun.file(filePath).text()
    const {
      entries: allEntries,
      sectionOrder,
      description,
      labels,
      image,
      warnings,
    } = cfg.parse(content)
    // Hashed from the content itself, never the sidecar — see deck-load.ts.
    const contentHash = computeHash(content)

    if (params.view === 'summary') {
      // Counted over the filtered-but-unpaged entries: see `deck-load.ts`.
      const { entries: counted } = filterEntries(
        allEntries,
        toCountParams(params),
        nameOf,
        sectionOf,
      )
      const summary: ListSummaryLoadResult = {
        success: true,
        slug,
        view: 'summary',
        counts: countEntries(counted, sectionOf),
        warnings,
      }
      return Response.json(stampLoadBody(summary, isNarrowedLoad(params), contentHash))
    }

    const { entries, totalCount } = filterEntries(allEntries, params, nameOf, sectionOf)
    const partial = isNarrowedLoad(params)
    // Spread onto the body, never merged into `warnings`: an unreadable art
    // sidecar is display metadata gone wrong, not a line the save would eat.
    const art = await listArtRecord(filePath, {
      cardIds: entries.map((entry) => entry.cardId),
      // The unfiltered entries: an orphan is an id no line in the whole file
      // carries, which a filtered page cannot answer on its own.
      knownCardIds: new Set(collectExistingIds(allEntries)),
    })

    if (params.view === 'cards') {
      const body: FlatCardsLoadResult<T> = {
        success: true,
        slug,
        view: 'cards',
        entries,
        sectionOrder,
        description,
        labels,
        image,
        totalCount,
        warnings,
        ...art,
      }
      return Response.json(stampLoadBody(body, partial, contentHash))
    }

    const cardNames = new Set<string>()
    for (const entry of entries) cardNames.add(entry.name)

    await addChangelogCardNames(filePath, cardNames)

    // Spread whole, like the deck route: the load result type *is* the loader's,
    // so its Card Kingdom picks travel without a per-field restatement.
    const cardData = await loadEntryCardData(cardNames, {
      cardKingdomPicks: cfg.resolvesByName === true,
    })
    const symbolMap = await fetchSymbolMap()

    const body: FlatFullLoadResult<T> = {
      success: true,
      view: 'full',
      entries,
      totalCount,
      sectionOrder,
      description,
      labels,
      image,
      ...cardData,
      symbolMap,
      slug,
      warnings,
      ...art,
    }
    return Response.json(stampLoadBody(body, partial, contentHash))
  })
}
