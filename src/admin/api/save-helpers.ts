import { rewriteRefusal, type ParsedListContent } from '../../list/unreadable-content'
import { cardCache } from '../../cache'
import { computeHash, hashPath, writeFileWithHash } from '../../changes/content-hash'
import type { CardArtMap, CardArtRef, CardArtReconcileInput } from '../../list/card-art'
import { reconcileListRefs } from '../../list/list-refs'
import { appendChangelog } from '../../changes/changelog-writer'
import { removedArtCardIds, type LineQuantities } from '../../changes/line-copies'
import { workspaceListTypeNoun, type ListType } from '../../list/list-type'
import { dirForType } from '../../list/resolve-list'
import { loadDefaultCategories, loadRitualConfig } from '../../config/ritual-config'
import { foldedCardNameSet } from '../../list/card-names'
import { commitCategoryChanges, isCategoryChange } from '../../list/card-categories-sidecar'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { apiError, badRequest, nestedRefusal, type ApiConflictResponse } from '../../api/http'
import type { ChangeEvent } from '../../changes/change-event'
import type { DroppedNote } from '../../list/move-staging'
import type { SaveEffect } from '../../changes/save-effects'
import type { SelectBranch } from '../../i18n/t'
import { apiMessage, apiText } from '../../api/result'
import type { SyncMessage } from '../../sync/message'
import { findLineBreak } from '../../util/single-line'
import type { ListSaveResponse } from './list-save'
import type { MovesOutcome } from '../../list/move-prepare'

/** What a cache-only route needs the card cache for — the refusal's wording follows it. */
export type CardCacheNeed = SelectBranch<'admin.api.cache.empty'>

/**
 * 503 when the card cache is empty, null when the handler may proceed. The
 * shared guard for routes that read strictly from the local cache (`price`,
 * `sell`): a handler must never prompt for or trigger a bulk download the way
 * the CLI freshness gates do. `need` names what the cache is needed for.
 */
export async function requireCardCache(need: CardCacheNeed): Promise<Response | null> {
  if (await cardCache.isEmpty()) return apiError(apiMessage('admin.api.cache.empty', { need }), 503)
  return null
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
 * Read the file, compare its hash against the client-provided hash, and return
 * a 409 conflict response if they differ. On success, returns the file content
 * so callers can reuse it without a second read.
 */
export async function validateContentHash(
  filePath: string,
  clientHash: string,
  listType: ListType,
): Promise<HashValidationResult> {
  const content = await Bun.file(filePath).text()
  // Hashed from the content itself, matching what the load routes handed the
  // client — a stale or absent sidecar must produce neither a spurious 409 nor
  // a missed conflict.
  const existingHash = computeHash(content)
  if (existingHash !== clientHash) {
    const body: ApiConflictResponse = {
      success: false,
      ...apiMessage('admin.api.save.conflict', { listType }),
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
  const refusal = rewriteRefusal(filePath, parsed, 'saving')
  return refusal === undefined ? null : nestedRefusal(refusal)
}

/**
 * Refuse a request whose card data holds a line break.
 *
 * Every string in these parts — card names, set codes, collector numbers,
 * sections, list names — is written into a card line, a heading, or a changelog
 * prose line, and every one of those is a single line, so a name like
 * `"Sol Ring\n- 1 Black Lotus &3"` would otherwise write a forged card line.
 * The save and move routes run this over their raw bodies first, so the refusal
 * carries a message key and the JSON path. Refused rather than folded: a card name is the
 * card's identity, and folding it would quietly write a different one.
 *
 * `parts` maps each request field name to its value, so the refusal names the
 * offending path (`changes[2].cardName`). Pass only the card-data parts: front
 * matter (a deck's multi-line `description:`) has its own grammar.
 */
export function refuseLineBreaks(parts: Record<string, unknown>): Response | null {
  for (const [name, value] of Object.entries(parts)) {
    const field = findLineBreak(value, name)
    if (field !== null) return badRequest(apiMessage('admin.api.save.lineBreak', { field }))
  }
  return null
}

/** Everything the shared save tail needs; see {@link finishListSave}. */
export interface ListSaveTail {
  /**
   * Which list this is. The commit directory, the commit message, and the
   * response's wording all follow from it, so they cannot drift apart.
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
 * The shared tail of the list save route: write the list file, append the
 * changelog, auto-commit.
 *
 * **Ordering is deliberate — file first, changelog second.** Neither order is
 * atomic. A crash between the two leaves either a phantom history entry
 * describing an edit the file never received, or a correct file with an
 * incomplete audit trail. `ritual history`, the change-bundle export, the
 * editors' undo, and the sync flows all *act on* changelog entries, so a phantom
 * propagates while a gap does not. The deck-sync engine writes in the same order.
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
    `Edit ${workspaceListTypeNoun(tail.listType)}: ${tail.changelogName} (${loggable.length} changes)`,
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
export function unreconciledArtWarning(reason: SyncMessage): string {
  return apiText('admin.api.save.artUnreconciled', { reason: reason.message })
}

/**
 * A categories sidecar a save could not read or write, as the response's
 * warning. Like {@link unreconciledArtWarning}, the card lines were written
 * first, so this is news to report rather than a save to undo.
 */
export function categoriesUnreconciledWarning(reason: SyncMessage): string {
  return apiText('admin.api.save.categoriesUnreconciled', { reason: reason.message })
}

/**
 * The success body the list save route returns, built from the same tail they
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
