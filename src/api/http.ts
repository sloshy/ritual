/**
 * The HTTP plumbing every Ritual route shares: the refusal envelope, the JSON
 * body prologue, and the declared-size cap.
 *
 * It lives here rather than beside the admin save routes because `src/api/`
 * means "handlers no server owns" — some of these routes are mounted by both the
 * admin server and `ritual serve --api`, some by one of them — and they all
 * refuse the same way. Anything that reads a list file, talks to git, or knows
 * what a save is stays in `src/admin/api/save-helpers.ts`.
 *
 * Browser-safe: it reaches only `src/util/json` and `src/api/result`, so the
 * SPAs may import these types without dragging a provider in behind them.
 */

import { isRecord } from '../util/json'
import type { ApiMessage } from './result'

/**
 * The declared body size (bytes) allowed on routes whose body is bounded by its
 * own shape — credentials, a config object, a list name. It is also what
 * `validateBodySize`/`readJsonObjectBody` apply when a route passes no budget of
 * its own, so a route that needs more has to say so.
 *
 * Note what this does and does not buy: the check reads `Content-Length` rather
 * than measuring, so it is a courtesy refusal for a well-behaved client, not a
 * defense — see {@link validateBodySize} for the ways past it.
 */
export const MAX_BODY_SIZE = 10 * 1024

/**
 * The one error body a route returns on a refusal, whatever the status.
 *
 * Every route used to declare its own structurally identical alias
 * (`ListsErrorResponse`, `DiffErrorResponse`, ...); they are gone in favour of
 * this. Response types that carry *more* than `success`/`message` on failure
 * (`CardDetailsFailure`'s `card: null`, `CardSearchFailure`'s paging fields,
 * `AutocompleteResponse` and `CardPrintingsResponse`, which fold success and
 * failure into one shape) keep their own declarations — those extra fields are
 * a wire contract, not duplication.
 */
export interface ApiErrorResponse extends ApiMessage {
  success: false
}

/**
 * The 409 body `validateContentHash` (`src/admin/api/save-helpers.ts`) returns:
 * the shared refusal plus the flag that says *why* it is a refusal a client can
 * recover from by reloading.
 *
 * Declared rather than assembled inline, because the flag is a wire contract:
 * the MCP dispatcher reads `conflict` off a failure body to decide between "your
 * call was wrong" and "re-read and retry", and an untyped literal is how that
 * key would quietly become a string or disappear.
 */
export interface ApiConflictResponse extends ApiErrorResponse {
  conflict: true
}

/**
 * Build the shared refusal body at `status`.
 *
 * Takes either bare English — the common case, since most refusals are composed
 * from the caller's own field names and have no catalog entry — or the whole
 * {@link ApiMessage} triple, which is how a keyed refusal keeps its key on the
 * way out.
 */
export function apiError(reason: string | ApiMessage, status: number): Response {
  const body: ApiErrorResponse = {
    success: false,
    ...(typeof reason === 'string' ? { message: reason } : reason),
  }
  return Response.json(body, { status })
}

/** {@link apiError} at the status a refusal almost always carries. */
export function badRequest(reason: string | ApiMessage): Response {
  return apiError(reason, 400)
}

/** The outcome of {@link readJsonObjectBody}: the parsed object, or the response to return. */
export type JsonObjectBody =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }

/**
 * The shared route prologue for a JSON body: size cap, parse, object guard, one
 * error envelope. Folds the three steps every mutating handler opened with.
 *
 * This is the rule: every route that reads a JSON body goes through it. The
 * deliberate hold-outs are the four auth-surface handlers (`setup`,
 * `auth-login`, `login`, `totp`), whose refusal bodies carry their own fields
 * (`retryAfterSeconds`, `loginRequired`) and are a wire contract of their own.
 * They hold out from this prologue and its envelope, not from the cap: all but
 * `login` (Archidekt) call {@link validateBodySize} directly.
 */
export async function readJsonObjectBody(req: Request, maxBytes?: number): Promise<JsonObjectBody> {
  const sizeError = validateBodySize(req, maxBytes)
  if (sizeError) return { ok: false, response: sizeError }
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { ok: false, response: apiError('Request body must be JSON.', 400) }
  }
  if (!isRecord(raw)) {
    return { ok: false, response: apiError('Request body must be a JSON object.', 400) }
  }
  return { ok: true, body: raw }
}

/**
 * Return a 413 Response if the request *declares* more bytes than the cap, or
 * null if it may proceed. `maxBytes` defaults to {@link MAX_BODY_SIZE}; a route
 * whose body has no small bound in its shape passes `MAX_LIST_BODY_SIZE`,
 * and a bulk query route derives one from its own per-request item cap.
 *
 * This trusts `Content-Length` rather than measuring, which is deliberate but
 * narrow: a request that sends no such header — a chunked upload, or any of the
 * in-process callers that build a `Request` directly (the MCP dispatcher via
 * `buildSyntheticRequest`, `import-changes` re-dispatching into the save
 * handlers, every integration test) — is not capped at all. So this is a
 * comprehensible refusal for a well-behaved client, not a defense against a
 * hostile one; bounding memory would mean measuring the stream as it is read.
 */
export function validateBodySize(req: Request, maxBytes: number = MAX_BODY_SIZE): Response | null {
  const declared = req.headers.get('Content-Length')
  // A header that is present but unparseable is refused rather than waved
  // through: `Number('abc') > maxBytes` is false, so NaN would read as "fits".
  if (declared === null) return null
  const contentLength = Number(declared)
  if (!Number.isFinite(contentLength) || contentLength > maxBytes) {
    return apiError(`Request body too large (limit ${maxBytes} bytes)`, 413)
  }
  return null
}
