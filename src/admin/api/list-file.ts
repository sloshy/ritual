import path from 'node:path'
import { resolveDeckFilePath } from '../../list/deck-file'
import { isPathWithinDir } from '../../util/path-validation'
import { capitalize } from '../../util/strings'
import { apiError } from './save-helpers'

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
  /** Singular lowercase label, e.g. `deck`, `collection`, `wanted list`. */
  label: string
  /**
   * Appended to the not-found message. The load routes point at `GET /api/lists`;
   * the lifecycle routes say only that the list is not there.
   */
  notFoundHint?: string
}

/** A resolved list file, or the refusal (status + message) that replaces it. */
export type ResolvedListFile =
  | { ok: true; filePath: string }
  | { ok: false; status: number; message: string }

/** How one list type turns a slug into a file path. */
export type ResolveListFile = (lookup: ListFileLookup) => Promise<ResolvedListFile>

function notFound(lookup: ListFileLookup): ResolvedListFile {
  const hint = lookup.notFoundHint ? `. ${lookup.notFoundHint}` : ''
  return {
    ok: false,
    status: 404,
    message: `${capitalize(lookup.label)} '${lookup.slug}' not found${hint}`,
  }
}

/** Collections and wanted lists: `<dir>/<slug>.md`, guarded against traversal. */
export const resolveFlatListFile: ResolveListFile = async (lookup) => {
  const filePath = path.join(lookup.dir, `${lookup.slug}.md`)
  if (!isPathWithinDir(filePath, lookup.dir)) {
    return { ok: false, status: 400, message: `Invalid ${lookup.label} slug` }
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

/** The not-found suffix the three list load routes append. */
export const LIST_LOAD_NOT_FOUND_HINT = 'Use GET /api/lists to see the available slugs.'

/** A resolved file path, or the response refusing the lookup. */
export type ListFileResult = { ok: true; filePath: string } | { ok: false; response: Response }

/**
 * {@link ResolveListFile} with the refusal already wrapped in the shared error
 * envelope — what every caller but one wants, since {@link ResolvedListFile}'s
 * `status`/`message` pair exists only to be turned into exactly this response.
 */
export async function resolveListFileOrRefuse(
  resolve: ResolveListFile,
  lookup: ListFileLookup,
): Promise<ListFileResult> {
  const resolved = await resolve(lookup)
  if (!resolved.ok) return { ok: false, response: apiError(resolved.message, resolved.status) }
  return { ok: true, filePath: resolved.filePath }
}
