import {
  unreadableContentMessage,
  unreadableLines,
  type ParsedListContent,
} from '../../markdown-fence'
import { cardCache } from '../../cache'
import { CACHE_REFRESH_REMEDY } from '../../cache/status'
import { computeHash, hashPath, writeFileWithHash } from '../../content-hash'
import { type CardArtMap, type CardArtRef, type CardArtReconcileInput } from '../../card-art'
import { reconcileListRefs } from '../../list-refs'
import { appendChangelog } from '../../changelog-writer'
import type { EntryWithCardId } from '../../card-id'
import type { DeckData } from '../../types'
import { isRecord } from '../../json'
import { listTypeLabel, type ListType } from '../../list-type'
import { dirForType } from '../../resolve-list'
import { loadRitualConfig } from '../../ritual-config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { MAX_BODY_SIZE } from '../validation'
import {
  getCardKingdomFeed,
  missingFeedApiAdvice,
  type LoadedCardKingdomFeed,
} from '../../cardkingdom'
import { normalizeNote } from '../../note-helpers'
import {
  checkLabelsForListType,
  parseCardLabelsValue,
  unsupportedLabelsMessage,
  type CardLabel,
} from '../../card-labels'
import {
  invalidLanguageMessage,
  isCardLanguage,
  storedLanguage,
  type CardLanguage,
} from '../../card-language'
import type { ChangeEvent } from '../../change-event'
import type { DroppedNote } from '../../commands/move-io'
import type { SaveEffect } from '../../editor/save-effects'
import { t } from '../../i18n/t'
import { apiMessage, type ApiMessage } from './result'
import type { ListSaveResponse, MovesOutcome } from './move-save'

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
export interface ApiErrorResponse extends ApiMessage {
  success: false
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

/**
 * 503 when the card cache is empty, null when the handler may proceed. The
 * shared guard for routes that read strictly from the local cache (`price`,
 * `sell`): a handler must never prompt for or trigger a bulk download the way
 * the CLI freshness gates do. `requirement` names what the cache is needed for.
 */
export async function requireCardCache(requirement: string): Promise<Response | null> {
  if (await cardCache.isEmpty()) {
    return apiError(`The card cache is empty; ${requirement}. ${CACHE_REFRESH_REMEDY}.`, 503)
  }
  return null
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
/**
 * The cached buyer feed, or a 503 naming every way to download it. The buylist
 * mirror of {@link requireCardCache}: shared so the admin sell routes and the
 * dual-mounted buylist routes refuse identically.
 */
export async function requireBuylistFeed(): Promise<LoadedCardKingdomFeed | Response> {
  const feed = await getCardKingdomFeed()
  if (feed === null) return apiError(missingFeedApiAdvice(), 503)
  return feed
}

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

export type HashValidationSuccess = {
  valid: true
  content: string
}

export type HashValidationConflict = {
  valid: false
  response: Response
}

export type HashValidationResult = HashValidationSuccess | HashValidationConflict

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
  // Hashed from the content itself, matching what the load routes handed the
  // client — a stale or absent sidecar must produce neither a spurious 409 nor
  // a missed conflict.
  const existingHash = computeHash(content)
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
 * Fenced code blocks count too: the parsers read them as prose and never touch
 * them, but the canonical serializers do not emit them, so a whole-file save
 * would delete the block just as surely as an unreadable line.
 *
 * @param filePath The list file, named in the refusal so the fix is obvious.
 * @param parsed The baseline parse; no warnings and no fenced lines means the save may proceed.
 */
export function refuseUnreadableBaseline(
  filePath: string,
  parsed: ParsedListContent,
): Response | null {
  const lines = unreadableLines(parsed)
  if (lines.length === 0) return null
  return apiError(unreadableContentMessage(filePath, lines, 'saving'), 400)
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
 * An entry (deck card) whose request-supplied labels need validating.
 * `unknown` on purpose: the request body is cast unvalidated, and this is the
 * boundary that exists to *prove* the value, not assume it.
 */
type RequestLabelEntry = { labels?: unknown }

/**
 * Validate one incoming label set against what `type` carries, returning the
 * normalized labels or the 400 refusal naming the offenders.
 */
type LabelFieldResult = { ok: true; labels: CardLabel[] } | { ok: false; response: Response }

function normalizeLabelField(raw: unknown, type: ListType): LabelFieldResult {
  const result = parseCardLabelsValue(raw, 'labels')
  if (!result.ok) return { ok: false, response: badRequest(result.message) }
  // One decision for every surface — the CLI flags, this route, the bundle
  // importer, and the MCP schemas all ask `checkLabelsForListType`, so an empty
  // set (a clear) is accepted and refused in the same places by all of them.
  const check = checkLabelsForListType(type, result.labels)
  if (!check.ok) {
    return { ok: false, response: badRequest(unsupportedLabelsMessage(type, check.unsupported)) }
  }
  return { ok: true, labels: result.labels }
}

/**
 * Validate and normalize the labels on every `set-label` (and label-carrying
 * `add` / `remove`) change in the request payload — and on every request entry that will
 * be re-serialized — mutating each in place to the normalized (deduped,
 * canonically ordered) form. The request body is cast unvalidated, so this is
 * the boundary that keeps an illegal combination (`keep` alongside
 * `sale`/`trade`), an unknown token, or a label the list type does not carry
 * (`sale` on a deck) out of the serializer. Returns a 400 Response naming the
 * first offender, or null when all are legal.
 */
export function normalizeRequestLabels(
  changes: ChangeEvent[],
  type: ListType,
  entries: RequestLabelEntry[] = [],
): Response | null {
  for (const change of changes) {
    if (change.action === 'set-label') {
      const result = normalizeLabelField(change.labels, type)
      if (!result.ok) return result.response
      change.labels = result.labels
    } else if (
      (change.action === 'add' || change.action === 'remove') &&
      change.labels !== undefined
    ) {
      const result = normalizeLabelField(change.labels, type)
      if (!result.ok) return result.response
      change.labels = result.labels.length > 0 ? result.labels : undefined
    }
  }
  for (const entry of entries) {
    if (entry.labels === undefined) continue
    const result = normalizeLabelField(entry.labels, type)
    if (!result.ok) return result.response
    entry.labels = result.labels.length > 0 ? result.labels : undefined
  }
  return null
}

/**
 * An entry (deck card or wanted row) whose request-supplied language needs
 * validating. `unknown` on purpose: the request body is cast unvalidated, and
 * this is the boundary that exists to *prove* the value, not assume it.
 */
type RequestLanguageEntry = { language?: unknown }

/**
 * Lowercase-normalize and validate the incoming value of one `language` field.
 * Returns the canonical code or the 400 refusal naming the offender. The
 * request body is cast unvalidated, so this is the boundary that keeps an
 * unknown code out of the serializer.
 */
type RequiredLanguageFieldResult =
  | { ok: true; language: CardLanguage }
  | { ok: false; response: Response }

/** {@link requireLanguageField}'s shape, with "field absent" as a legal outcome. */
type OptionalLanguageFieldResult =
  | { ok: true; language: CardLanguage | undefined }
  | { ok: false; response: Response }

/** The required variant: the field must be present and name a known language. */
function requireLanguageField(raw: unknown, where: string): RequiredLanguageFieldResult {
  const value = typeof raw === 'string' ? raw.toLowerCase() : null
  if (value === null || !isCardLanguage(value)) {
    return {
      ok: false,
      response: badRequest(invalidLanguageMessage(raw, `on ${where}`)),
    }
  }
  return { ok: true, language: value }
}

/** The optional variant: an absent field is legal (English / leave alone). */
function normalizeLanguageField(raw: unknown, where: string): OptionalLanguageFieldResult {
  if (raw === undefined) return { ok: true, language: undefined }
  return requireLanguageField(raw, where)
}

/**
 * Validate and lowercase-normalize the language on every language-carrying
 * change (`set-language`, `add`, `remove`, `set-printing`, `move-from`,
 * `move-to`) and on every request entry that will be re-serialized, mutating
 * each in place — mirroring {@link normalizeRequestLabels} /
 * {@link normalizeRequestNotes}. A `set-language` change *requires* the field;
 * everywhere else it is optional (absent means English). Returns a 400 Response
 * naming the first offender, or null when all are legal.
 */
export function normalizeRequestLanguages(
  changes: ChangeEvent[],
  entries: RequestLanguageEntry[],
): Response | null {
  for (const change of changes) {
    switch (change.action) {
      case 'set-language': {
        if (change.language === undefined) {
          return badRequest('A set-language change requires a "language".')
        }
        const result = requireLanguageField(
          change.language,
          `set-language change for "${change.cardName}"`,
        )
        if (!result.ok) return result.response
        change.language = result.language
        break
      }
      case 'add':
      case 'remove':
      case 'set-printing':
      case 'move-from':
      case 'move-to': {
        const result = normalizeLanguageField(
          change.language,
          `${change.action} change for "${change.cardName}"`,
        )
        if (!result.ok) return result.response
        change.language = result.language
        break
      }
      default:
        break
    }
  }
  for (const entry of entries) {
    if (entry.language === undefined) continue
    const result = normalizeLanguageField(entry.language, 'a card entry')
    if (!result.ok) return result.response
    // `en` folds back to the written-value shape (a bare line means English).
    entry.language = storedLanguage(result.language)
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
  /**
   * What the save did to individual card lines. Reported to the client, and the
   * only place the tail learns which `&N` ids the write freed or renumbered —
   * which is what the list's custom-art sidecar has to be re-filed against.
   */
  effects: readonly SaveEffect[]
  /**
   * The list as it stood on disk, as copies per `&N` — see {@link LineQuantities}.
   * Only the custom-art reconcile reads it, and only to tell a decremented line
   * from one this save removed and re-created under the same id.
   */
  previousLineQuantities: LineQuantities
  /** Merge into the session's existing changelog entry instead of a new one. */
  continueSession?: boolean
  /**
   * Files to commit **beyond** the ones this tail already knows about: the list
   * file, its hash sidecar, and the changelog are seeded here, so a caller passes
   * only what is genuinely its own — the destination files of its cross-list
   * moves.
   */
  extraFiles?: readonly string[]
  /**
   * Custom art arriving with this save's incoming cross-list moves, keyed by
   * the destination line's `&N` (see `CrossListMovesResult.adoptedArt`). Filed
   * by this tail's reconcile *after* the ids the save freed are dropped, so a
   * copy landing on an id the same save drained keeps its arriving art.
   */
  adoptedArt?: CardArtMap
}

/** The list file's new content hash, which the save response returns. */
export interface ListSaveTailResult {
  contentHash: string
  /**
   * What the custom-art re-file could not do. The card lines were written, so
   * this is never a failed save — but it must not be silent either: a sidecar
   * Ritual could not read still files art under the `&N` ids this save freed,
   * and the next card to take one of those numbers would wear it.
   *
   * Named to match the load routes' channel ({@link
   * import('./load-results').ListLoadBase.artWarnings}), so a client reads
   * sidecar trouble out of the same field whichever direction it was going.
   * Omitted when the reconcile was clean.
   */
  artWarnings?: string[]
}

/** What a save learned that {@link ListSaveTail} does not already say. */
export interface ListSaveOutcome extends ListSaveTailResult {
  /** Notes the destination side of a cross-list move could not keep. */
  droppedNotes: DroppedNote[]
}

/**
 * The save response's outcome, assembled from the two halves that produce one:
 * this list's own save tail and the other side of its cross-list moves.
 * Both can leave a sidecar unreconciled, and the response carries one
 * `artWarnings` list, so the merge lives here rather than in each save route.
 */
export function listSaveOutcome(result: ListSaveTailResult, moves: MovesOutcome): ListSaveOutcome {
  // The move side reports the reconcile's own refusal, so the response's
  // wording is applied here — the same sentence this list's own reconcile
  // failure already carries.
  const artWarnings = [
    ...(result.artWarnings ?? []),
    ...moves.artFailures.map((failure) => unreconciledArtWarning(failure.message)),
  ]
  return {
    contentHash: result.contentHash,
    droppedNotes: moves.droppedNotes,
    ...(artWarnings.length > 0 ? { artWarnings } : {}),
  }
}

/**
 * How many copies each `&N` line held **before** the save, keyed by card id.
 *
 * The art reconcile's one ambiguity lives here: a deck line that lost a copy and
 * a deck line that was removed and re-created under the same reused id look
 * identical once the file is written. Counting the removals against the copies
 * the line started with separates them. Flat lists hold one copy per line, so
 * theirs is simply `1` per entry ({@link entryLineQuantities}).
 */
export type LineQuantities = ReadonlyMap<number, number>

/** {@link LineQuantities} for a deck's on-disk state. */
export function deckLineQuantities(deck: DeckData): LineQuantities {
  const quantities = new Map<number, number>()
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (card.cardId === undefined) continue
      quantities.set(card.cardId, (quantities.get(card.cardId) ?? 0) + card.quantity)
    }
  }
  return quantities
}

/** {@link LineQuantities} for a flat list's on-disk entries — one copy per line. */
export function entryLineQuantities(entries: readonly EntryWithCardId[]): LineQuantities {
  const quantities = new Map<number, number>()
  for (const entry of entries) {
    if (entry.cardId !== undefined) quantities.set(entry.cardId, 1)
  }
  return quantities
}

/** The change kinds that add or take a copy on a line of this list. */
type LineCopyChange = Extract<ChangeEvent, { action: 'add' | 'remove' | 'move-from' | 'move-to' }>

/** One step of {@link replayLineCopies}: the change, the line it touched, and that line's copies before and after. */
export type LineCopyStep = {
  change: LineCopyChange
  cardId: number
  before: number
  after: number
}

/** How {@link replayLineCopies} reads a line the baseline does not know. */
export type ReplayLineCopiesOptions = {
  /**
   * Copies assumed on an id the baseline never had. The art reconcile reads
   * such an id as a single standing line (`1`: art filed under it belonged to
   * something already gone, and a removal empties it); the incoming-move
   * writer reads it as a brand-new line (`0`: the first copy landing on it is
   * fresh).
   */
  unknownIdHolds: number
}

/**
 * Replay a save's copy-changing events against the on-disk copy counts, one
 * line at a time. An `add` or `move-to` is a copy gained on the line its
 * `cardId` names; a `remove` or `move-from` a copy lost. Copies are replayed
 * **in order** rather than netted, because the order is the only thing that
 * tells apart two same-id sequences: a deck line that gains a copy and loses
 * one again never empties, while a line removed and re-added under the id the
 * pool handed straight back *does* empty in between. Changes with no `cardId`
 * say nothing about any line and are skipped. The one ledger behind
 * {@link removedArtCardIds} and the move writer's `freshMoveToChangeIds`.
 */
export function replayLineCopies(
  changes: readonly ChangeEvent[],
  baseline: LineQuantities,
  options: ReplayLineCopiesOptions,
): LineCopyStep[] {
  const steps: LineCopyStep[] = []
  const copies = new Map<number, number>()
  for (const change of changes) {
    if (
      change.action !== 'add' &&
      change.action !== 'remove' &&
      change.action !== 'move-from' &&
      change.action !== 'move-to'
    ) {
      continue
    }
    const { cardId } = change
    if (cardId === undefined) continue
    const before = copies.get(cardId) ?? baseline.get(cardId) ?? options.unknownIdHolds
    const gain = change.action === 'add' || change.action === 'move-to'
    const after = gain ? before + 1 : before - 1
    copies.set(cardId, after)
    steps.push({ change, cardId, before, after })
  }
  return steps
}

/**
 * The ids whose custom art this save drops, read from the **changes** rather
 * than from the file it produced.
 *
 * An explicit removal always takes the card's art with it (`Part 4.3`): art
 * returns only through an undo — which takes the removal out of this very list —
 * or through a re-add that names art of its own. The written file cannot answer
 * this on its own, because the id pool hands a removed line's `&N` straight to
 * the next card added, and the effects diff then reports one `updated` line that
 * kept its number. Reading the removals instead is what stops a same-name
 * remove + re-add from silently inheriting the old card's art.
 *
 * A line that merely lost copies keeps its art: the removals only add up to a
 * removed *line* once they meet the copies it had.
 *
 * Copies are replayed **in order** rather than netted, because the order is the
 * only thing that tells the two same-id sequences apart. A deck line that gains
 * a copy and loses one again (add, then remove — which no longer cancel each
 * other out, since labels joined a change's identity) never empties, so its art
 * stays. A line that is removed and then re-added under the id the pool handed
 * straight back *does* empty in between, and the art of the card that left goes
 * with it — the same-name remove + re-add must not silently inherit it.
 */
export function removedArtCardIds(
  changes: readonly ChangeEvent[],
  baseline: LineQuantities,
): Set<number> {
  const removed = new Set<number>()
  // An id the baseline does not know is a line this save created; art filed
  // under it belonged to something that is already gone.
  for (const step of replayLineCopies(changes, baseline, { unknownIdHolds: 1 })) {
    if (step.after <= 0) removed.add(step.cardId)
  }
  return removed
}

/**
 * Read a save as an art-sidecar reconcile: the lines its changes removed
 * ({@link removedArtCardIds}), plus the lines its `updated` effects renumbered.
 * An `added` line is new — nothing the save kept can have been filed under an id
 * it had to allocate.
 */
function artReconcile(tail: ListSaveTail): CardArtReconcileInput {
  const removed = removedArtCardIds(tail.changes, tail.previousLineQuantities)
  const renumbered = new Map<number, number>()
  for (const effect of tail.effects) {
    if (effect.action === 'removed') removed.add(effect.cardId)
    else if (effect.previousCardId !== undefined)
      renumbered.set(effect.previousCardId, effect.cardId)
  }
  // Arriving art is keyed by the id the client gave the line; if the write
  // renumbered that line, the art follows it to the number it actually got.
  const added = new Map<number, CardArtRef>()
  for (const [cardId, ref] of tail.adoptedArt ?? []) {
    added.set(renumbered.get(cardId) ?? cardId, ref)
  }
  return { removed, renumbered, added }
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
  const written = await writeFileWithHash(tail.filePath, tail.content)

  const filesToCommit = [tail.filePath, hashPath(tail.filePath), ...(tail.extraFiles ?? [])]
  // Custom art and the list's cover image are both filed under a card line's
  // `&N`, and this save may have freed ids (a removed or moved-out line, whose
  // number the pool hands to the next card added) or renumbered them. Re-file
  // before the commit, so both travel with the list file they describe.
  const refs = await reconcileListRefs(tail.filePath, artReconcile(tail))
  const art = refs.art
  filesToCommit.push(...refs.writtenFiles)
  // A cover rewrite re-serializes the front matter, so the hash the client is
  // handed has to be the one *after* it — otherwise the session's next save
  // 409s against a write this save itself performed.
  const contentHash = refs.contentHash ?? written
  if (tail.changes.length > 0) {
    const changelogPath = await appendChangelog(tail.filePath, tail.changelogName, tail.changes, {
      continueSession: tail.continueSession,
    })
    filesToCommit.push(changelogPath)
  }

  await autoCommitAndPush(
    dirForType(tail.listType),
    // A move may already have re-filed this list's own sidecar (an arriving
    // copy's art), so the path can be in `extraFiles` and here — as can the
    // list file itself, which a cover rewrite touches a second time.
    [...new Set(filesToCommit)],
    `Edit ${listTypeLabel(tail.listType)}: ${tail.changelogName} (${tail.changes.length} changes)`,
  )

  return art.ok
    ? { contentHash }
    : { contentHash, artWarnings: [unreconciledArtWarning(art.message)] }
}

/**
 * A sidecar a save could not re-file, as the response's warning. The CLI's
 * equivalent (`warnUnreconciledArt`) prints the same sentence; both exist
 * because the reconcile runs *after* the card lines are written, so its failure
 * is news to report rather than a save to undo.
 */
export function unreconciledArtWarning(reason: string): string {
  return t('admin.api.save.artUnreconciled', { reason })
}

/**
 * The success body all three save routes return, built from the same tail they
 * were saved with so the message and the subject cannot disagree with the
 * changelog and the commit.
 */
export function listSaveResponse(tail: ListSaveTail, outcome: ListSaveOutcome): ListSaveResponse {
  return {
    success: true,
    ...apiMessage('admin.api.save.saved', {
      count: tail.changes.length,
      name: tail.changelogName,
    }),
    contentHash: outcome.contentHash,
    droppedNotes: outcome.droppedNotes,
    effects: [...tail.effects],
    ...(outcome.artWarnings === undefined ? {} : { artWarnings: outcome.artWarnings }),
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
