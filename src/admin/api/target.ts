import { isListType, type ListType } from '../../list/list-type'
import { apiMessage, type ApiMessage } from '../../api/result'

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
export function parseListTarget(req: Request): ListTarget | ApiMessage {
  const parts = new URL(req.url).pathname.split('/')
  const rawType = parts[3]
  const rawSlug = parts[4]
  if (!rawType || !isListType(rawType)) return apiMessage('admin.api.target.typeInvalid')
  if (!rawSlug) return apiMessage('admin.api.target.slugRequired')
  const slug = decodeURIComponent(rawSlug)
  if (!isValidListSlug(slug)) return apiMessage('admin.api.target.slugInvalid')
  return { type: rawType, slug }
}

/**
 * The outcome of {@link parseSlugFromUrl}: the slug, or the message refusing it.
 * Structured rather than a `string | ApiMessage` union so the caller branches on
 * `ok` instead of on the shape of what it was handed.
 */
export type SlugParse = { ok: true; slug: string } | { ok: false; refusal: ApiMessage }

/**
 * Parse the `:slug` path segment of a `/api/<area>/:slug` route (path
 * segment 3), shared by the deck/collection/wanted rename and delete handlers.
 * Applies the same {@link isValidListSlug} rule {@link parseListTarget} does, so
 * a slug carrying path separators is refused on every route that takes one.
 */
export function parseSlugFromUrl(req: Request): SlugParse {
  const raw = new URL(req.url).pathname.split('/')[3]
  if (!raw) return { ok: false, refusal: apiMessage('admin.api.target.slugRequired') }
  const slug = decodeURIComponent(raw)
  if (!isValidListSlug(slug))
    return { ok: false, refusal: apiMessage('admin.api.target.slugInvalid') }
  return { ok: true, slug }
}
