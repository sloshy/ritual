import { computeHash } from '../../content-hash'
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
import type { CardLabel } from '../../card-labels'
import type {
  FlatCardsLoadResult,
  FlatFullLoadResult,
  ListLoadStamp,
  ListSummaryLoadResult,
} from './load-results'
import { apiError } from './save-helpers'
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
  /** The list's default card labels from its front matter — collections only. */
  labels?: CardLabel[]
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
}

/** Everything a flat (collection | wanted) load differs by. */
export interface FlatListLoadConfig<T extends FlatLoadEntry> {
  /** Singular lowercase label, used verbatim in refusals. */
  label: string
  getDir: () => string
  /** The list type's file parser. The collection's implementation lowercases `set`. */
  parse: (content: string) => FlatListParseResult<T>
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
    const { entries: allEntries, sectionOrder, labels, warnings } = cfg.parse(content)
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

    if (params.view === 'cards') {
      const body: FlatCardsLoadResult<T> = {
        success: true,
        slug,
        view: 'cards',
        entries,
        sectionOrder,
        labels,
        totalCount,
        warnings,
      }
      return Response.json(stampLoadBody(body, partial, contentHash))
    }

    const cardNames = new Set<string>()
    for (const entry of entries) cardNames.add(entry.name)

    await addChangelogCardNames(filePath, cardNames)

    const { cards, printings } = await loadEntryCardData(cardNames)
    const symbolMap = await fetchSymbolMap()

    const body: FlatFullLoadResult<T> = {
      success: true,
      view: 'full',
      entries,
      totalCount,
      sectionOrder,
      labels,
      cards,
      printings,
      symbolMap,
      slug,
      warnings,
    }
    return Response.json(stampLoadBody(body, partial, contentHash))
  })
}
