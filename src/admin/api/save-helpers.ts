import { loadHash, computeHash } from '../../content-hash'
import { isRecord } from '../../json'
import { loadRitualConfig } from '../../ritual-config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { MAX_BODY_SIZE } from '../validation'
import { normalizeNote } from '../../note-helpers'
import type { ChangeEvent } from '../../change-event'

/**
 * The one error body an admin route returns on a refusal, whatever the status.
 *
 * Every route used to declare its own structurally identical alias
 * (`ListsErrorResponse`, `DiffErrorResponse`, ...); they are gone in favour of
 * this. Response types that carry *more* than `success`/`message` on failure
 * (`CardDetailsFailure`'s `card: null`, `CardSearchFailure`'s paging fields,
 * `AutocompleteResponse` and `CardPrintingsResponse`, which fold success and
 * failure into one shape) keep their own declarations — those extra fields are
 * a wire contract, not duplication.
 */
export interface ApiErrorResponse {
  success: false
  message: string
}

/**
 * The 409 body {@link validateContentHash} returns: the shared refusal plus the
 * flag that says *why* it is a refusal a client can recover from by reloading.
 *
 * Declared rather than assembled inline, because the flag is a wire contract:
 * the MCP dispatcher reads `conflict` off a failure body to decide between "your
 * call was wrong" and "re-read and retry", and an untyped literal is how that
 * key would quietly become a string or disappear.
 */
export interface ApiConflictResponse extends ApiErrorResponse {
  conflict: true
}

/** Build the shared refusal body at `status`. */
export function apiError(message: string, status: number): Response {
  const body: ApiErrorResponse = { success: false, message }
  return Response.json(body, { status })
}

/** {@link apiError} at the status a refusal almost always carries. */
export function badRequest(message: string): Response {
  return apiError(message, 400)
}

/**
 * Why a save may have arrived without a `contentHash`, appended to the routes'
 * "required fields" refusal.
 *
 * A filtered or paged load returns `partial: true` and no hash precisely so a
 * slice cannot be saved back over the whole file; a client that stripped the
 * hash on purpose gets the same message, which costs nothing and rescues the
 * client that did not realise its load was narrowed.
 */
export const PARTIAL_LOAD_HINT =
  'A filtered or paged load returns "partial": true and no contentHash, because saving a slice ' +
  'would truncate the file — reload the list without section/nameContains/limit/offset first.'

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
 */
export async function readJsonObjectBody(req: Request): Promise<JsonObjectBody> {
  const sizeError = validateBodySize(req)
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

export type HashValidationSuccess = {
  valid: true
  content: string
}

export type HashValidationConflict = {
  valid: false
  response: Response
}

export type HashValidationResult = HashValidationSuccess | HashValidationConflict

/** Return a 413 Response if the request body exceeds MAX_BODY_SIZE, or null if OK. */
export function validateBodySize(req: Request): Response | null {
  const contentLength = Number(req.headers.get('Content-Length') ?? '0')
  if (contentLength > MAX_BODY_SIZE) {
    return apiError('Request body too large', 413)
  }
  return null
}

/**
 * Read the file, compare its hash against the client-provided hash, and return
 * a 409 conflict response if they differ. On success, returns the file content
 * so callers can reuse it without a second read.
 */
export async function validateContentHash(
  filePath: string,
  clientHash: string,
  entityLabel: string,
): Promise<HashValidationResult> {
  const content = await Bun.file(filePath).text()
  const existingHash = (await loadHash(filePath)) ?? computeHash(content)
  if (existingHash !== clientHash) {
    const body: ApiConflictResponse = {
      success: false,
      message: `${entityLabel} has been modified since you loaded it. Please reload.`,
      conflict: true,
    }
    return { valid: false, response: Response.json(body, { status: 409 }) }
  }
  return { valid: true, content }
}

/**
 * Trim and validate every note found in the request payload (set-note changes
 * and any entry-level `note` fields). Mutates each note in place to the trimmed
 * value. Returns a 400 Response if any note contains control characters.
 */
type RequestNoteEntry = { note?: string }

export function normalizeRequestNotes(
  changes: ChangeEvent[],
  entries: RequestNoteEntry[],
): Response | null {
  for (const change of changes) {
    if (change.action !== 'set-note') continue
    const result = normalizeNote(change.note)
    if (!result.ok) return badRequest(result.error)
    change.note = result.note
  }
  for (const entry of entries) {
    if (entry.note === undefined) continue
    const result = normalizeNote(entry.note)
    if (!result.ok) return badRequest(result.error)
    entry.note = result.note === '' ? undefined : result.note
  }
  return null
}

/**
 * Commit files and push if the config enables auto-commit/auto-push for the
 * given directory. The repo guard, the commit, and the push all run against
 * `dir`, so a list directory configured inside a different git repo than the
 * base dir is committed to consistently.
 */
export async function autoCommitAndPush(
  dir: string,
  files: string[],
  message: string,
): Promise<void> {
  const config = await loadRitualConfig()
  if (shouldAutoCommit(config, dir)) {
    commitFiles(files, message, dir)
    if (shouldAutoPush(config, dir)) {
      pushChanges(dir)
    }
  }
}
