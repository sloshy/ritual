import { loadHash, computeHash, hashPath, writeFileWithHash } from '../../content-hash'
import { appendChangelog } from '../../changelog-writer'
import { isRecord } from '../../json'
import { listTypeLabel, type ListType } from '../../list-type'
import { dirForType } from '../../resolve-list'
import { loadRitualConfig } from '../../ritual-config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { MAX_BODY_SIZE } from '../validation'
import { normalizeNote } from '../../note-helpers'
import type { ChangeEvent } from '../../change-event'
import type { DroppedNote } from '../../commands/move-io'
import type { SaveEffect } from '../../editor/save-effects'
import type { ListSaveResponse } from './move-save'

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
 * Refuse a save whose **baseline** — the file as it stands on disk — holds lines
 * the parser could not read.
 *
 * Every save re-serializes the whole list from parsed entries, so a line the
 * parse dropped is a line the write deletes, and the `&N` it carried goes back
 * into the reuse pool to be handed to some other card. Surfacing the warnings on
 * the load routes only closed half of that: a client is free not to look, and
 * the file is destroyed either way. Refusing here is the other half — the file is
 * left exactly as it was, and the message says which lines to fix.
 *
 * The refusal is a 400: the request is fine, but this list cannot be saved until
 * its file is readable. MCP mutations surface it as a tool error unchanged.
 *
 * @param filePath The list file, named in the refusal so the fix is obvious.
 * @param warnings The baseline parse's warnings; empty means the save may proceed.
 */
export function refuseUnreadableBaseline(
  filePath: string,
  warnings: readonly string[],
): Response | null {
  if (warnings.length === 0) return null
  return apiError(
    `${filePath} has ${warnings.length} line(s) the parser cannot read, and saving would delete them ` +
      `(releasing their &N ids). Fix the file first — ${warnings.join('; ')}`,
    400,
  )
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

/** Everything the shared save tail needs; see {@link finishListSave}. */
export interface ListSaveTail {
  /**
   * Which list this is. The commit directory, the commit message, and the
   * response's wording all follow from it — the three routes used to spell each
   * of those out, which is three chances for them to drift.
   */
  listType: ListType
  /** The list file to write. */
  filePath: string
  /** Serialized markdown, ids already assigned. */
  content: string
  /**
   * The subject of this save: a deck's display name, a flat list's slug. Names
   * the changelog entry, the commit message, and the response message, which are
   * the same subject said three times.
   */
  changelogName: string
  changes: readonly ChangeEvent[]
  /** Merge into the session's existing changelog entry instead of a new one. */
  continueSession?: boolean
  /**
   * Files to commit **beyond** the ones this tail already knows about: the list
   * file, its hash sidecar, and the changelog are seeded here, so a caller passes
   * only what is genuinely its own — the destination files of its cross-list
   * moves.
   */
  extraFiles?: readonly string[]
}

/** The list file's new content hash, which the save response returns. */
export interface ListSaveTailResult {
  contentHash: string
}

/** What a save learned that {@link ListSaveTail} does not already say. */
export interface ListSaveOutcome extends ListSaveTailResult {
  /** Notes the destination side of a cross-list move could not keep. */
  droppedNotes: DroppedNote[]
  /** What the save did to individual entries, with the `&N` ids it allocated. */
  effects: SaveEffect[]
}

/**
 * The shared tail of the three save routes: write the list file, append the
 * changelog, auto-commit.
 *
 * **Ordering is deliberate — file first, changelog second.** Neither order is
 * atomic. A crash between the two leaves either a phantom history entry
 * describing an edit the file never received, or a correct file with an
 * incomplete audit trail. `ritual history`, the change-bundle export, the
 * editors' undo, and the sync flows all *act on* changelog entries, so a phantom
 * propagates while a gap does not. The deck route used to write the changelog
 * first and now matches the other two (as does the deck-sync engine).
 */
export async function finishListSave(tail: ListSaveTail): Promise<ListSaveTailResult> {
  const contentHash = await writeFileWithHash(tail.filePath, tail.content)

  const filesToCommit = [tail.filePath, hashPath(tail.filePath), ...(tail.extraFiles ?? [])]
  if (tail.changes.length > 0) {
    const changelogPath = await appendChangelog(tail.filePath, tail.changelogName, tail.changes, {
      continueSession: tail.continueSession,
    })
    filesToCommit.push(changelogPath)
  }

  await autoCommitAndPush(
    dirForType(tail.listType),
    filesToCommit,
    `Edit ${listTypeLabel(tail.listType)}: ${tail.changelogName} (${tail.changes.length} changes)`,
  )

  return { contentHash }
}

/**
 * The success body all three save routes return, built from the same tail they
 * were saved with so the message and the subject cannot disagree with the
 * changelog and the commit.
 */
export function listSaveResponse(tail: ListSaveTail, outcome: ListSaveOutcome): ListSaveResponse {
  return {
    success: true,
    message: `Saved ${tail.changes.length} changes to ${tail.changelogName}`,
    contentHash: outcome.contentHash,
    droppedNotes: outcome.droppedNotes,
    effects: outcome.effects,
  }
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
