import { isListType, type ListType } from '../../list-type'

/** The validated `:type` / `:slug` path target of a `/api/<area>/:type/:slug` route. */
export type ListTarget = { type: ListType; slug: string }

type TargetErrorResponse = { success: false; message: string }

function targetError(message: string): Response {
  const body: TargetErrorResponse = { success: false, message }
  return Response.json(body, { status: 400 })
}

/**
 * Parse and validate the `:type` / `:slug` path segments of a
 * `/api/<area>/:type/:slug` route (path segments 3 and 4), shared by the
 * history and price routes. Returns a 400 Response on an invalid type or slug.
 */
export function parseListTarget(req: Request): ListTarget | Response {
  const parts = new URL(req.url).pathname.split('/')
  const rawType = parts[3]
  const rawSlug = parts[4]
  if (!rawType || !isListType(rawType)) return targetError('Invalid or missing list type')
  if (!rawSlug) return targetError('List slug is required')
  const slug = decodeURIComponent(rawSlug)
  // A slug is a single file basename; reject path separators / null bytes outright
  // (resolveListFile also guards traversal, but this gives a clearer 400).
  if (/[/\\\0]/.test(slug)) return targetError('Invalid list slug')
  return { type: rawType, slug }
}

/**
 * Decode the `:slug` path segment of a `/api/<area>/:slug` route (path
 * segment 3), shared by the deck/collection/wanted rename and delete
 * handlers. Returns null when the segment is missing — the caller owns the
 * error response.
 */
export function slugFromUrl(req: Request): string | null {
  const raw = new URL(req.url).pathname.split('/')[3]
  if (!raw) return null
  return decodeURIComponent(raw)
}
