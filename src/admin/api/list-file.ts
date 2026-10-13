import path from 'node:path'
import { resolveDeckFilePath } from '../../list/deck-file'
import type { ListType } from '../../list/list-type'
import { isPathWithinDir } from '../../util/path-validation'
import { apiError } from '../../api/http'
import { apiMessage, type ApiMessage } from '../../api/result'
import type { MessageParams } from '../../i18n/t'

/**
 * Resolving a `:slug` path segment to the markdown file behind it.
 *
 * Decks and flat lists disagree about how: a deck slug is matched against the
 * deck files' names (async, and there is no traversal branch because nothing is
 * joined), while a collection or wanted-list slug is a file basename joined onto
 * its directory and therefore has to be guarded. Every route that takes a slug —
 * the three loads, rename, and delete — needs one of the two, so the pair lives
 * here rather than in whichever handler happened to need it first.
 */

/** What a route needs to know to resolve a slug and to word its refusal. */
export interface ListFileLookup {
  slug: string
  /** The directory the list type's files live in. */
  dir: string
  /** The list type, which the refusals name (one sentence per type in the catalog). */
  listType: ListType
  /**
   * Whether the not-found refusal points at `GET /api/lists`. The load routes
   * do; the lifecycle routes say only that the list is not there.
   */
  pointToListRoute?: boolean
}

/** A resolved list file, or the refusal (status + message) that replaces it. */
export type ResolvedListFile =
  { ok: true; filePath: string } | { ok: false; status: number; refusal: ApiMessage }

/** How one list type turns a slug into a file path. */
export type ResolveListFile = (lookup: ListFileLookup) => Promise<ResolvedListFile>

function notFound(lookup: ListFileLookup): ResolvedListFile {
  const params: MessageParams<'admin.api.list.notFound'> = {
    listType: lookup.listType,
    slug: lookup.slug,
  }
  return {
    ok: false,
    status: 404,
    refusal: lookup.pointToListRoute
      ? apiMessage('admin.api.list.notFoundListRoute', params)
      : apiMessage('admin.api.list.notFound', params),
  }
}

/** Collections and wanted lists: `<dir>/<slug>.md`, guarded against traversal. */
export const resolveFlatListFile: ResolveListFile = async (lookup) => {
  const filePath = path.join(lookup.dir, `${lookup.slug}.md`)
  if (!isPathWithinDir(filePath, lookup.dir)) {
    return {
      ok: false,
      status: 400,
      refusal: apiMessage('admin.api.list.slugInvalid', { listType: lookup.listType }),
    }
  }
  if (!(await Bun.file(filePath).exists())) return notFound(lookup)
  return { ok: true, filePath }
}

/** Decks: name-based lookup through {@link resolveDeckFilePath}. */
export const resolveDeckFile: ResolveListFile = async (lookup) => {
  const filePath = await resolveDeckFilePath(lookup.dir, lookup.slug)
  if (!filePath) return notFound(lookup)
  return { ok: true, filePath }
}

/** A resolved file path, or the response refusing the lookup. */
export type ListFileResult = { ok: true; filePath: string } | { ok: false; response: Response }

/**
 * {@link ResolveListFile} with the refusal already wrapped in the shared error
 * envelope — what every caller but one wants, since {@link ResolvedListFile}'s
 * `status`/`refusal` pair exists only to be turned into exactly this response.
 */
export async function resolveListFileOrRefuse(
  resolve: ResolveListFile,
  lookup: ListFileLookup,
): Promise<ListFileResult> {
  const resolved = await resolve(lookup)
  if (!resolved.ok) return { ok: false, response: apiError(resolved.refusal, resolved.status) }
  return { ok: true, filePath: resolved.filePath }
}
