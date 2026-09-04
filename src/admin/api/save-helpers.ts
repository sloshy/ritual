import {
  unreadableContentMessage,
  unreadableLines,
  type ParsedListContent,
} from '../../list/markdown-fence'
import { cardCache } from '../../cache'
import { CACHE_REFRESH_REMEDY } from '../../cache/status'
import { computeHash, hashPath, writeFileWithHash } from '../../changes/content-hash'
import type { CardArtMap, CardArtRef, CardArtReconcileInput } from '../../list/card-art'
import { reconcileListRefs } from '../../list/list-refs'
import { appendChangelog } from '../../changes/changelog-writer'
import { removedArtCardIds, type LineQuantities } from '../../changes/line-copies'
import { listTypeLabel, type ListType } from '../../list/list-type'
import { dirForType } from '../../list/resolve-list'
import { loadDefaultCategories, loadRitualConfig } from '../../config/ritual-config'
import { parseCardCategoriesValue, parseCardCategory } from '../../card/card-categories'
import { foldedCardNameSet } from '../../list/card-names'
import { commitCategoryChanges, isCategoryChange } from '../../list/card-categories-sidecar'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { apiError, badRequest, type ApiConflictResponse } from '../../api/http'
import { normalizeNote } from '../../card/note-helpers'
import {
  checkLabelsForListType,
  normalizedOverride,
  parseCardLabelsValue,
  unsupportedLabelsMessage,
  type CardLabel,
} from '../../card/card-labels'
import {
  invalidLanguageMessage,
  isCardLanguage,
  storedLanguage,
  type CardLanguage,
} from '../../card/card-language'
import {
  normalizedTags,
  parseCardTag,
  parseCardTagsValue,
  type CardTag,
} from '../../card/card-tags'
import type { ChangeEvent, MoveReplacement } from '../../changes/change-event'
import { isFinish } from '../../card/finish-condition'
import type { DroppedNote } from '../../list/move-staging'
import type { SaveEffect } from '../../changes/save-effects'
import { t } from '../../i18n/t'
import { apiMessage } from '../../api/result'
import type { ListSaveResponse } from './list-save'
import type { MovesOutcome } from '../../list/move-prepare'

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
      change.labels = normalizedOverride(result.labels)
    }
  }
  for (const entry of entries) {
    if (entry.labels === undefined) continue
    const result = normalizeLabelField(entry.labels, type)
    if (!result.ok) return result.response
    entry.labels = normalizedOverride(result.labels)
  }
  return null
}

/**
 * An entry (deck card or wanted row) whose request-supplied tags need
 * validating. `unknown` on purpose, like {@link RequestLabelEntry}: the request
 * body is cast unvalidated, and this is the boundary that proves the value.
 */
type RequestTagEntry = { tags?: unknown }

/** One incoming tag set, canonical (or `undefined` for none), or its 400 refusal. */
type TagsFieldResult = { ok: true; tags: CardTag[] | undefined } | { ok: false; response: Response }

function normalizeTagsField(raw: unknown): TagsFieldResult {
  const result = parseCardTagsValue(raw, 'tags')
  if (!result.ok) return { ok: false, response: badRequest(result.message) }
  // The stored form: file data never carries an empty tag set, so an empty
  // array on the way in is "no tags" on the way out (`normalizedTags`).
  return { ok: true, tags: normalizedTags(result.tags) }
}

/**
 * Validate and canonicalize the tags in a save request — the `tag` of every
 * `add-tag` / `remove-tag` change, the `tags` an `add` / `remove` / `move-from` /
 * `move-to` may carry (a move's land on the other list's line), and
 * the `tags` of every request entry that will be re-serialized (the deck and
 * wanted routes write the entries they are handed) — mutating each in place to
 * the canonical form (trimmed, single-spaced, deduplicated, sorted, no `#` — a
 * typed leading `#` is tolerated and dropped). The request body is cast
 * unvalidated, so this is the boundary that keeps a malformed tag (`a,b`,
 * `R&D`) out of the serializer and the changelog: the tag
 * grammar is a file-format rule, and a line written with a bad one would not
 * re-parse. Returns a 400 Response carrying the parser's refusal for the first
 * offender, or null when every tag is legal.
 */
export function normalizeRequestTags(
  changes: ChangeEvent[],
  entries: RequestTagEntry[],
): Response | null {
  for (const change of changes) {
    if (change.action === 'add-tag' || change.action === 'remove-tag') {
      // Refused, never coerced: `String(undefined)` is a perfectly tag-shaped
      // "undefined", and a missing field must not become a `#undefined` token.
      const raw: unknown = change.tag
      if (typeof raw !== 'string') {
        return badRequest(`A ${change.action} change requires a string "tag".`)
      }
      const result = parseCardTag(raw)
      if (!result.ok) return badRequest(result.message)
      change.tag = result.tag
    } else if (
      (change.action === 'add' ||
        change.action === 'remove' ||
        change.action === 'move-from' ||
        change.action === 'move-to') &&
      change.tags !== undefined
    ) {
      const result = normalizeTagsField(change.tags)
      if (!result.ok) return result.response
      change.tags = result.tags
    }
  }
  for (const entry of entries) {
    if (entry.tags === undefined) continue
    const result = normalizeTagsField(entry.tags)
    if (!result.ok) return result.response
    entry.tags = result.tags
  }
  return null
}

/**
 * Validate and canonicalize the categories in a save request — the `categories`
 * of every `set-categories`, the `order` of every `set-category-order`, and the
 * two names of every `rename-category`. The request body is cast unvalidated, so
 * this is the boundary that keeps a malformed category name out of the sidecar
 * and the changelog. Returns a 400 Response carrying the parser's refusal for
 * the first offender, or null when every value is legal.
 *
 * An empty `categories` array is legal and meaningful: it is a *clear*.
 */
export function normalizeRequestCategories(changes: ChangeEvent[]): Response | null {
  for (const change of changes) {
    if (isCategoryChange(change)) {
      // The body is cast unvalidated, so a client could smuggle a `cardId` onto
      // a name-keyed event; the file boundary refuses it too. A foreign list's
      // `&N` would otherwise be persisted into this list's changelog prose.
      const raw = change as unknown as Record<string, unknown>
      if (raw.cardId !== undefined) {
        return badRequest(
          `A ${change.action} change is keyed by card name and must not carry a "cardId".`,
        )
      }
      if (change.action !== 'set-categories' && raw.cardName !== undefined) {
        return badRequest(
          `A ${change.action} change targets the list, not a card, and must not carry a "cardName".`,
        )
      }
    }
    if (change.action === 'set-categories') {
      // Refused, never coerced — the same rule the tag normalizer states: a
      // missing field must not become a category-shaped "undefined".
      const result = parseCardCategoriesValue(change.categories, '"categories"')
      if (!result.ok) return badRequest(result.message)
      change.categories = result.categories
    } else if (change.action === 'set-category-order') {
      const result = parseCardCategoriesValue(change.order, '"order"')
      if (!result.ok) return badRequest(result.message)
      change.order = result.categories
    } else if (change.action === 'rename-category') {
      for (const field of ['category', 'newCategory'] as const) {
        const raw: unknown = change[field]
        if (typeof raw !== 'string') {
          return badRequest(`A rename-category change requires a string "${field}".`)
        }
        const parsed = parseCardCategory(raw)
        if (!parsed.ok) return badRequest(parsed.message)
        change[field] = parsed.category
      }
    }
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

/**
 * Validate and lowercase-normalize the `replacement` on every incoming
 * `move-to` change (the printing a source list gets back for the copy a swap
 * took), mutating in place like {@link normalizeRequestLanguages}. The value
 * arrives from an unvalidated request body and is written to the source
 * list's card line, so half a printing — which the line writer would fold to
 * a name-only line — is refused here. Returns a 400 Response naming the first
 * offender, or null when all are legal.
 */
export function normalizeRequestReplacements(changes: ChangeEvent[]): Response | null {
  for (const change of changes) {
    if (change.action !== 'move-to' || change.replacement === undefined) continue
    const raw: unknown = change.replacement
    const where = `move-to change for "${change.cardName}"`
    if (change.replacesCardId === undefined) {
      return badRequest(`The ${where} carries a replacement but pins no line ("replacesCardId").`)
    }
    if (typeof raw !== 'object' || raw === null) {
      return badRequest(`The replacement on the ${where} must be an object.`)
    }
    const fields = raw as Record<string, unknown>
    if (typeof fields.set !== 'string' || typeof fields.collectorNumber !== 'string') {
      return badRequest(`The replacement on the ${where} needs a "set" and "collectorNumber".`)
    }
    if (
      fields.finish !== undefined &&
      (typeof fields.finish !== 'string' || !isFinish(fields.finish))
    ) {
      return badRequest(`The replacement on the ${where} has an unknown finish.`)
    }
    const language = normalizeLanguageField(fields.language, `the replacement on the ${where}`)
    if (!language.ok) return language.response
    const replacement: MoveReplacement = {
      set: fields.set.toLowerCase(),
      collectorNumber: fields.collectorNumber,
    }
    if (fields.finish !== undefined) replacement.finish = fields.finish
    if (language.language !== undefined) replacement.language = language.language
    change.replacement = replacement
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
  /**
   * The card names the written content still holds. The categories sidecar is
   * keyed by name, so this is what tells the tail which of its entries no card
   * backs any more. Omit to skip the prune.
   */
  cardNames?: readonly string[]
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
  /**
   * What the categories sidecar write could not do. The card lines were
   * written, so — like {@link artWarnings} — this is a warning channel and never
   * a failed save. Omitted when the sidecar was written (or left alone) cleanly.
   */
  categoryWarnings?: string[]
  /**
   * Card names whose category entries this save pruned, because the list no
   * longer holds a line of that name. Omitted when nothing was pruned.
   */
  prunedCategories?: string[]
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
  // Both halves can prune: this list's own save tail, and the other lists the
  // moves rewrote (a source that lost its last copy of a name). One field, so
  // the merge is here for the same reason `artWarnings`' is.
  const prunedCategories = [...(result.prunedCategories ?? []), ...moves.prunedCategories]
  return {
    contentHash: result.contentHash,
    droppedNotes: moves.droppedNotes,
    ...(artWarnings.length > 0 ? { artWarnings } : {}),
    ...(result.categoryWarnings === undefined ? {} : { categoryWarnings: result.categoryWarnings }),
    ...(prunedCategories.length > 0 ? { prunedCategories } : {}),
  }
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

  // The categories half. Keyed by card NAME rather than `&N`, so it is a
  // separate commit from the art reconcile above: what it needs is the set of
  // names the written content still holds, not the ids the write freed.
  //
  // Every save reaches this call with a `knownCardNames` set, so the commit's
  // own short-circuit never fires here — which is exactly why
  // `saveCardCategories` is byte-identity-guarded: a save that touches no
  // category loads, replays nothing, serializes, finds the bytes identical and
  // writes nothing, leaving a hand-edited sidecar (and its stale hash) alone.
  const categories = await commitCategoryChanges(tail.filePath, tail.changes, {
    knownCardNames: tail.cardNames === undefined ? undefined : foldedCardNameSet(tail.cardNames),
    defaultCategories: await loadDefaultCategories(),
  })
  filesToCommit.push(...categories.writtenFiles)

  // File first, changelog second — and never a changelog entry for a write that
  // did not happen: when the sidecar could not be read, its events are dropped
  // from the batch rather than recorded as a phantom edit `history --rebuild`,
  // the bundle export and `import-changes` would all replay. The failure itself
  // rides the response as `categoryWarnings`.
  const loggable =
    categories.error === undefined
      ? tail.changes
      : tail.changes.filter((change) => !isCategoryChange(change))
  if (loggable.length > 0) {
    const changelogPath = await appendChangelog(tail.filePath, tail.changelogName, loggable, {
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
    `Edit ${listTypeLabel(tail.listType)}: ${tail.changelogName} (${loggable.length} changes)`,
  )

  return {
    contentHash,
    ...(art.ok ? {} : { artWarnings: [unreconciledArtWarning(art.message)] }),
    ...(categories.error === undefined
      ? {}
      : { categoryWarnings: [categoriesUnreconciledWarning(categories.error)] }),
    ...(categories.pruned.length > 0 ? { prunedCategories: categories.pruned } : {}),
  }
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
 * A categories sidecar a save could not read or write, as the response's
 * warning. Like {@link unreconciledArtWarning}, the card lines were written
 * first, so this is news to report rather than a save to undo.
 */
export function categoriesUnreconciledWarning(reason: string): string {
  return t('admin.api.save.categoriesUnreconciled', { reason })
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
    ...(outcome.categoryWarnings === undefined
      ? {}
      : { categoryWarnings: outcome.categoryWarnings }),
    ...(outcome.prunedCategories === undefined
      ? {}
      : { prunedCategories: outcome.prunedCategories }),
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
