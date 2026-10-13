/**
 * The HTTP plumbing every Ritual route shares: the refusal envelope, the JSON
 * body prologue, and the measured body-size cap.
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
import { apiMessageOf, plainMessage, type ApiMessage } from './result'
import { CardCommandError, ExitCode, getErrorMessage, isCancellation } from '../util/errors'
import type { SyncMessage } from '../sync/message'

/**
 * The body size (bytes) allowed on routes whose body is bounded by its own
 * shape — credentials, a config object, a list name. It is also what
 * {@link readBodyText}/{@link readJsonObjectBody} apply when a route passes no
 * budget of its own, so a route that needs more has to say so.
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
 * Takes the whole {@link ApiMessage} triple, which is how a keyed refusal keeps
 * its key on the way out. Text with no catalog entry (an engine's refusal not
 * yet converted) goes through `plainMessage`, so a keyless refusal is a visible
 * choice at the call site rather than the default.
 */
export function apiError(reason: ApiMessage, status: number): Response {
  const body: ApiErrorResponse = { success: false, ...reason }
  return Response.json(body, { status })
}

/** {@link apiError} at the status a refusal almost always carries. */
export function badRequest(reason: ApiMessage): Response {
  return apiError(reason, 400)
}

/**
 * The shared refusal body for a message whose params nest — a list that did not
 * resolve, whose ambiguous matches are a list of messages of their own. Same
 * fields as {@link ApiErrorResponse}; only `messageParams` may hold more than
 * strings and numbers (see `src/sync/message.ts`).
 */
export type NestedRefusalResponse = SyncMessage & { success: false }

/** {@link apiError} for a message whose params nest; see {@link NestedRefusalResponse}. */
export function nestedRefusal(reason: SyncMessage, status: number = 400): Response {
  const body: NestedRefusalResponse = { success: false, ...reason }
  return Response.json(body, { status })
}

/**
 * HTTP status for an error that reached the top of a handler. A
 * {@link CardCommandError} classifies itself — a client-correctable refusal
 * (e.g. an import conflict that needs `overwrite`) is a 400 or 404, not the 500
 * every unexpected throw gets — so the admin UI and the MCP tools that share
 * these handlers can tell "you asked wrong" from "the server broke". A
 * cancellation is neither: it answers 499 (the client closed the request), the
 * status the site build already used for the same outcome.
 */
export function statusForError(error: unknown): number {
  if (isCancellation(error)) return 499
  if (!(error instanceof CardCommandError)) return 500
  if (error.exitCode === ExitCode.NotFound) return 404
  if (error.exitCode === ExitCode.UsageError) return 400
  return 500
}

/**
 * An error that reached the top of a handler, as the refusal's message. A
 * {@link CardCommandError} raised from a catalog key (`localizedCommandError`)
 * was worded in the process's locale; the response re-renders its key in
 * English and carries the key, as every keyed refusal does, so MCP and scripts
 * read English and the admin page reads its own language. Anything else is
 * reported as the text it was raised with.
 */
export function caughtMessage(error: unknown): ApiMessage {
  if (error instanceof CardCommandError && error.messageRef !== undefined) {
    return apiMessageOf(error.messageRef.key, error.messageRef.params)
  }
  return plainMessage(getErrorMessage(error))
}

/**
 * An error that reached the top of a handler, as the shared refusal: its
 * message per {@link caughtMessage}, at {@link statusForError}'s status. Every
 * route's last-resort `catch` answers through this, so a keyed refusal thrown
 * deep in an engine reaches the client as English plus its key whichever route
 * it surfaced through.
 */
export function errorResponse(error: unknown): Response {
  return apiError(caughtMessage(error), statusForError(error))
}

/** The outcome of {@link readBodyText}: the body as text, or the response to return. */
export type BodyText = { ok: true; text: string } | { ok: false; response: Response }

/** The outcome of {@link readJsonObjectBody}: the parsed object, or the response to return. */
export type JsonObjectBody =
  { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }

function tooLarge(maxBytes: number): Response {
  return apiError(plainMessage(`Request body too large (limit ${maxBytes} bytes)`), 413)
}

/**
 * Read a request body as text, refusing with 413 once it passes `maxBytes`.
 *
 * The bytes are counted as they arrive, so the budget holds whatever the request
 * declares: a chunked upload, a lying `Content-Length`, or an in-process caller
 * that builds its `Request` directly (the MCP dispatcher, `import-changes`). A
 * declared size over the budget is refused before anything is read. The
 * servers also set a hard `maxRequestBodySize` ceiling; this is the per-route
 * budget beneath it.
 */
export async function readBodyText(
  req: Request,
  maxBytes: number = MAX_BODY_SIZE,
): Promise<BodyText> {
  const declared = req.headers.get('Content-Length')
  // A header that is present but unparseable is refused rather than waved
  // through: `Number('abc') > maxBytes` is false, so NaN would read as "fits".
  if (declared !== null) {
    const contentLength = Number(declared)
    if (!Number.isFinite(contentLength) || contentLength > maxBytes) {
      return { ok: false, response: tooLarge(maxBytes) }
    }
  }
  if (req.body === null) return { ok: true, text: '' }
  const reader = req.body.getReader()
  // Decoded as it arrives (`stream: true` holds a multi-byte character split
  // across two chunks until its second half comes), so nothing is copied twice.
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false, response: tooLarge(maxBytes) }
    }
    text += decoder.decode(value, { stream: true })
  }
  return { ok: true, text: text + decoder.decode() }
}

/**
 * The shared route prologue for a JSON body: size cap, parse, object guard, one
 * error envelope. Folds the three steps every mutating handler opened with.
 *
 * This is the rule: every route that reads a JSON body goes through it, the
 * auth routes included — they keep envelopes of their own only for the
 * refusals that come after the body is read. The one route that reads its
 * body raw is `import-changes`, whose body is a bundle `parseChangeBundle`
 * validates itself; it calls {@link readBodyText} for the cap.
 */
export async function readJsonObjectBody(req: Request, maxBytes?: number): Promise<JsonObjectBody> {
  const read = await readBodyText(req, maxBytes)
  if (!read.ok) return read
  let raw: unknown
  try {
    raw = JSON.parse(read.text)
  } catch {
    return { ok: false, response: apiError(plainMessage('Request body must be JSON.'), 400) }
  }
  if (!isRecord(raw)) {
    return {
      ok: false,
      response: apiError(plainMessage('Request body must be a JSON object.'), 400),
    }
  }
  return { ok: true, body: raw }
}
