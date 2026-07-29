import { isListType, type ListType } from '../../list-type'

/** The validated `:type` / `:slug` path target of a `/api/<area>/:type/:slug` route. */
export type ListTarget = { type: ListType; slug: string }

/**
 * Whether a string is usable as a list slug: a single file basename, with no
 * path separators and no NUL bytes. The one place that rule lives, shared by
 * every surface that accepts a slug (path segment or query parameter);
 * `resolveListFile` also guards traversal, but rejecting here gives a clear 400.
 * Callers own their own error wording.
 */
export function isValidListSlug(slug: string): boolean {
  return !/[/\\\0]/.test(slug)
}

/**
 * Parse and validate the `:type` / `:slug` path segments of a
 * `/api/<area>/:type/:slug` route (path segments 3 and 4), shared by the
 * history and price routes. Reports a refusal as the message explaining it, per
 * the project's parser convention; the caller owns the status and envelope.
 */
export function parseListTarget(req: Request): ListTarget | string {
  const parts = new URL(req.url).pathname.split('/')
  const rawType = parts[3]
  const rawSlug = parts[4]
  if (!rawType || !isListType(rawType)) return 'Invalid or missing list type'
  if (!rawSlug) return 'List slug is required'
  const slug = decodeURIComponent(rawSlug)
  if (!isValidListSlug(slug)) return 'Invalid list slug'
  return { type: rawType, slug }
}

/**
 * The outcome of {@link parseSlugFromUrl}. Structured rather than a
 * `string | string` union because the slug and the message refusing it are both
 * strings — the caller must not have to guess which it was handed.
 */
export type SlugParse = { ok: true; slug: string } | { ok: false; message: string }

/**
 * Parse the `:slug` path segment of a `/api/<area>/:slug` route (path
 * segment 3), shared by the deck/collection/wanted rename and delete handlers.
 * Applies the same {@link isValidListSlug} rule {@link parseListTarget} does, so
 * a slug carrying path separators is refused on every route that takes one.
 */
export function parseSlugFromUrl(req: Request): SlugParse {
  const raw = new URL(req.url).pathname.split('/')[3]
  if (!raw) return { ok: false, message: 'List slug is required' }
  const slug = decodeURIComponent(raw)
  if (!isValidListSlug(slug)) return { ok: false, message: 'Invalid list slug' }
  return { ok: true, slug }
}
