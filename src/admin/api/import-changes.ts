import path from 'node:path'
import type { ChangeEvent } from '../../changes/change-event'
import type { DeckData } from '../../list/deck'
import type { ListType } from '../../list/list-type'
import {
  dirForType,
  resolveListErrorMessage,
  isResolveListError,
  resolveList,
} from '../../list/resolve-list'
import { isPathWithinDir } from '../../util/path-validation'
import {
  cardNamesById,
  collectDeckCardIds,
  collectExistingIds,
  deckCardNamesById,
} from '../../card/card-id'
import {
  type ChangeBundle,
  type ChangeBundleListRef,
  parseChangeBundle,
} from '../../changes/change-bundle'
import { planImportBatches, type ImportBatch } from './import-batches'
import {
  createRetargetState,
  importConflictReason,
  isProvisionalId,
  provisionalIdAllocator,
  settleRetargetState,
  type ImportConflict,
  type RetargetResult,
  type RetargetState,
  retargetImportedChanges,
} from '../../editor/import-changes'
import { deckMergeLine, replayAssigningIds, type IdReplayOps } from '../../changes/replay-ids'
import { applyChangeToCollection, toCollectionCardEntries } from '../../changes/collection-changes'
import { applyChangeToDeck } from '../../changes/deck-changes'
import { applyChangeToWantedList } from '../../changes/wanted-changes'
import type { CardLabel } from '../../card/card-labels'
import { dedupeDroppedNotes, type DroppedNote } from '../../list/move-staging'
import { toWantedCardEntries } from '../../list/wanted-entries'
import { buildSyntheticRequest } from '../../util/synthetic-request'
import type { CollectionLoadResult, DeckLoadResult, WantedLoadResult } from './load-results'
import { apiMessage } from '../../api/result'
import { ExitCode, localizedCommandError } from '../../util/errors'
import {
  prefixedFields,
  readSyncMessage,
  syncMessage,
  syncRef,
  type PrefixedMessage,
  type SyncMessage,
} from '../../sync/message'
import { apiHandler } from '../utils'
import { nestedRefusal, readBodyText } from '../../api/http'
import { changeProblemMessage } from '../../changes/change-problem-message'
import { handleDeckLoad } from './deck-load'
import { handleCollectionLoad } from './collection-load'
import { handleWantedListLoad } from './wanted-load'
import { handleListSave } from './list-save'
import { listSavePath, listSaveRequest, toWireChange } from '../../changes/wire-changes'
import { MAX_SAVE_CHANGES } from '../../changes/save-limits'
import type { ListSaveResponse } from './list-save'
import type { CollectionCardEntry, WantedListCardEntry } from '../../list/site-data'
import { MAX_EDIT_BODY_SIZE, MAX_UPLOAD_BODY_SIZE } from '../validation'

/** Origin for synthetic in-process request URLs; nothing leaves the process. */
const SYNTHETIC_ORIGIN = 'http://ritual-import'

/**
 * The outcome of applying a bundle's changes to one list — its own entry's
 * changes plus every move arriving in it — aggregated across the batches the
 * timestamp order split them into.
 */
export type ListImportOutcome = {
  kind: ListType
  /**
   * The bundle's slug for the list, or the file basename it resolved to when
   * the bundle only named the list as a move destination (no entry, no slug).
   * Empty when neither is known — the list could not be resolved, or was
   * named only as a move *source* and so never needed resolving.
   */
  slug: string
  name: string
  /**
   * Changes applied to the list (after dropping conflicts), moves included. A
   * list the bundle names only as a move source reports `0`: its copy leaves
   * through the destination's save, so it has no batch of its own — it is
   * listed so the report names every list the import touched.
   */
  applied: number
  /** Changes skipped: target card no longer exists, or the action cannot apply to the list. */
  conflicts: ImportConflict[]
  /**
   * Notes the list's saves discarded: a moved copy that merged onto a deck line
   * already holding a different note keeps the line's note, on this list (a
   * move arriving here) or on a list a move from here landed in. Each save
   * route's own `droppedNotes`, gathered across the list's batches.
   */
  droppedNotes: DroppedNote[]
}

/**
 * The failure of a list that could not be resolved, loaded, or saved: English
 * `error`, plus `errorKey` / `errorParams` when it has a catalog entry. The
 * failing batch applied nothing and the list's later batches were skipped (they
 * would replay onto a file the earlier batch left unchanged); batches already
 * applied stay applied and are counted.
 */
export type ListImportFailure = PrefixedMessage<'error'>

/** A list's outcome: what applied, plus its failure fields when it failed. */
export type ListImportResult = ListImportOutcome & ListImportFailure

/** The outcome of applying a whole change bundle. */
export type BundleImportResult = {
  /**
   * Lists that could not be loaded or saved (conflicts are not errors). Each
   * one's reason is on its own {@link ListImportResult.error}; this is the count
   * a caller branches on. It is deliberately **not** a `success: false` flag on
   * the response: a partially-failed import is still a processed request whose
   * per-list report is the whole point, and folding it into the envelope is what
   * made every client that treats `success: false` as "throw" discard that
   * report exactly when it mattered.
   */
  failedCount: number
  lists: ListImportResult[]
}

/**
 * `POST /api/import-changes` body: the engine's result plus its summary line.
 *
 * Declared rather than assembled inline at the `return`, so the CLI's
 * `--output json` payload and the MCP `import_change_bundle` result can be typed
 * against the same shape instead of each restating it. `success` is the envelope
 * flag every admin route carries and is always `true` here — read `failedCount`
 * (and each list's `error`) to tell a clean import from a partial one.
 */
export type BundleImportResponse = BundleImportResult & SyncMessage & { success: true }

type ApiCallResult<T> = { ok: true; data: T } | { ok: false; error: SyncMessage }

/**
 * Invoke an admin route handler in-process with a synthetic request and return
 * its parsed JSON body, normalizing HTTP failures and `success: false` bodies to
 * an error string. This reuses the exact load/save code paths the admin editors
 * (and the MCP server) go through — content hashing, changelogs, and cross-list
 * moves behave identically. Git auto-commit depends on the surface: the admin
 * route and the MCP `import_change_bundle` tool honor the `admin.git*` keys, while the
 * `ritual import-changes` CLI wraps its apply in `suppressAutoCommit` so the CLI
 * never creates commits.
 */
async function call<T>(
  handler: (req: Request) => Promise<Response>,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiCallResult<T>> {
  const response = await handler(buildSyntheticRequest(SYNTHETIC_ORIGIN, method, path, body))
  const data = (await response.json()) as Record<string, unknown>
  if (!response.ok || data.success === false) {
    const error =
      readSyncMessage(data) ??
      apiMessage('admin.api.importChanges.requestFailed', { status: response.status })
    return { ok: false, error }
  }
  return { ok: true, data: data as T }
}

/**
 * Re-aim a list's imported changes at its current card IDs: adds get
 * placeholder ids (the replay in {@link splitApplicable} gives them real ones),
 * other changes resolve by ID then by card name, and unresolvable ones become
 * conflicts.
 */
function retarget(
  changes: ChangeEvent[],
  currentNames: ReadonlyMap<number, string>,
  state: RetargetState,
): RetargetResult {
  return retargetImportedChanges({
    changes,
    currentNames,
    allocateId: provisionalIdAllocator(),
    state,
  })
}

type ApplyOutcome = {
  retargeted: ChangeEvent[]
  conflicts: ImportConflict[]
  /** What the batch's saves reported in `droppedNotes`. */
  droppedNotes: DroppedNote[]
  error?: SyncMessage
}

type SplitApplicableResult<TData> = {
  updated: TData
  applicable: ChangeEvent[]
  missConflicts: ImportConflict[]
}

/**
 * Replay the retargeted changes with the save route's own reducer, giving each
 * new line its real id (`replayAssigningIds`) and demoting any change that
 * still does not apply to a conflict instead of silently counting it as
 * applied. Retargeting only guarantees the target *card* resolves — a change
 * can still miss at apply time (an `unset-commander` on a card outside the
 * commander section, or a commander action aimed at a flat list). Misses no-op
 * inside the engines, so `updated` computed over the full list equals applying
 * only the applicable changes; the split exists so the save's changelog names
 * only real edits.
 *
 * The ids are given out in apply order, the way an editor's pool does: a line
 * an earlier change in the batch removed has released its id for a later add,
 * and a deck copy that folds onto a line it already has takes that line's id
 * and draws none. The re-target state follows, so a later batch's reference to
 * a copy this one added resolves to its real id.
 */
function splitApplicable<TData>(
  data: TData,
  retargeted: ChangeEvent[],
  ops: IdReplayOps<TData>,
  state: RetargetState,
  listLabels: readonly CardLabel[] | undefined,
): SplitApplicableResult<TData> {
  const replayed = replayAssigningIds(data, retargeted, ops, {
    listLabels,
    isProvisional: isProvisionalId,
  })
  settleRetargetState(state, replayed.resolved)
  const missed = new Set(replayed.unmatched.map((item) => item.change))
  return {
    updated: replayed.data,
    applicable: replayed.changes.filter((change) => !missed.has(change)),
    // The engine's reason travels through: `no-target` really is "card not
    // found", but `needs-printing` names a card that is present and only needs
    // a printing pinned first, and reporting that as "not found" would send the
    // user hunting for a card they can see.
    missConflicts: replayed.unmatched.map((item) => ({
      change: item.change,
      reason: importConflictReason(item.reason),
    })),
  }
}

/** How many of a list's changes landed, the notes their saves dropped, and why the rest did not. */
type SaveChangesOutcome = { applied: number; droppedNotes: DroppedNote[]; error?: SyncMessage }

/**
 * Split `changes` into save-sized batches: no more events than one save may
 * carry, and no more bytes than its body budget (less room for the envelope).
 * Exported for its unit test: its limits are too large to reach through a real import cheaply.
 */
export function saveChunks(changes: readonly ChangeEvent[]): ChangeEvent[][] {
  const byteLimit = MAX_EDIT_BODY_SIZE - 64 * 1024
  const chunks: ChangeEvent[][] = []
  let chunk: ChangeEvent[] = []
  let bytes = 0
  for (const change of changes) {
    // Bytes, not string length: the budget is measured in UTF-8, and a note in
    // Japanese is three bytes a character.
    const size = Buffer.byteLength(JSON.stringify(toWireChange(change))) + 1
    if (chunk.length > 0 && (chunk.length >= MAX_SAVE_CHANGES || bytes + size > byteLimit)) {
      chunks.push(chunk)
      chunk = []
      bytes = 0
    }
    chunk.push(change)
    bytes += size
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

/**
 * Post one list's applicable changes to its save route — the changes alone: the
 * route replays them over the file it reads, so neither the list nor its
 * section order travels. A batch larger than one save may carry goes as
 * several, in order, each continuing the last one's changelog entry, so the
 * list still gets one entry. A failed batch stops the rest; what landed before
 * it is reported as applied, since it is on disk.
 */
async function saveChanges(
  type: ListType,
  slug: string,
  changes: readonly ChangeEvent[],
  contentHash: string | undefined,
): Promise<SaveChangesOutcome> {
  let hash = contentHash
  let applied = 0
  const droppedNotes: DroppedNote[] = []
  for (const chunk of saveChunks(changes)) {
    const saved = await call<ListSaveResponse>(
      (req) => handleListSave(req, type),
      'POST',
      listSavePath(type, slug),
      // A list loaded without a hash is posted without one, for the route to
      // refuse with its partial-load hint.
      hash === undefined
        ? { changes: chunk.map(toWireChange) }
        : listSaveRequest(chunk, hash, { continueSession: applied > 0 }),
    )
    if (!saved.ok) return { applied, droppedNotes, error: saved.error }
    hash = saved.data.contentHash
    applied += chunk.length
    droppedNotes.push(...saved.data.droppedNotes)
  }
  return { applied, droppedNotes }
}

/** A list as the import engine reads it: its data, its names by id, its hash. */
type LoadedForImport<TData> = {
  data: TData
  namesById: ReadonlyMap<number, string>
  contentHash: string | undefined
  /** The list's front-matter default labels, which the save route replays an arriving move against. */
  listLabels?: CardLabel[]
}

/**
 * What the import engine needs to know about one list type: how to load it,
 * plus the save route's own reducer and id probes (`apply`, `cardIds`,
 * `mergeLine`), so the dry run applies — and numbers — exactly what the save
 * will.
 */
type ImportTarget<TData> = IdReplayOps<TData> & {
  type: ListType
  load: (slug: string) => Promise<ApiCallResult<LoadedForImport<TData>>>
}

/**
 * Load a list through its load route. `view=cards` for the same reason the MCP
 * mutations use it: this reads only the lines and the content hash, never the
 * Scryfall payload.
 */
async function loadForImport<TBody, TData>(
  handler: (req: Request) => Promise<Response>,
  type: ListType,
  slug: string,
  read: (body: TBody) => LoadedForImport<TData>,
): Promise<ApiCallResult<LoadedForImport<TData>>> {
  const loaded = await call<TBody>(
    handler,
    'GET',
    `/api/${type}/${encodeURIComponent(slug)}?view=cards`,
  )
  return loaded.ok ? { ok: true, data: read(loaded.data) } : loaded
}

const DECK_TARGET: ImportTarget<DeckData> = {
  type: 'deck',
  load: (slug) =>
    loadForImport<DeckLoadResult, DeckData>(handleDeckLoad, 'deck', slug, (body) => ({
      data: body.deck,
      namesById: deckCardNamesById(body.deck),
      contentHash: body.contentHash,
      listLabels: body.labels,
    })),
  // The batch hands every apply the target's own default (`listLabels` above).
  apply: (deck, change, options) =>
    applyChangeToDeck(deck, change, { ...options, listLabels: options?.listLabels }),
  cardIds: collectDeckCardIds,
  mergeLine: deckMergeLine,
}

const COLLECTION_TARGET: ImportTarget<CollectionCardEntry[]> = {
  type: 'collection',
  load: (slug) =>
    loadForImport<CollectionLoadResult, CollectionCardEntry[]>(
      handleCollectionLoad,
      'collection',
      slug,
      (body) => {
        const entries = toCollectionCardEntries(body.entries)
        return {
          data: entries,
          namesById: cardNamesById(entries),
          contentHash: body.contentHash,
          listLabels: body.labels,
        }
      },
    ),
  apply: applyChangeToCollection,
  cardIds: collectExistingIds,
}

const WANTED_TARGET: ImportTarget<WantedListCardEntry[]> = {
  type: 'wanted',
  load: (slug) =>
    loadForImport<WantedLoadResult, WantedListCardEntry[]>(
      handleWantedListLoad,
      'wanted',
      slug,
      (body) => {
        const entries = toWantedCardEntries(body.entries)
        return { data: entries, namesById: cardNamesById(entries), contentHash: body.contentHash }
      },
    ),
  apply: applyChangeToWantedList,
  cardIds: collectExistingIds,
}

async function applyToList<TData>(
  target: ImportTarget<TData>,
  slug: string,
  changes: ChangeEvent[],
  state: RetargetState,
): Promise<ApplyOutcome> {
  const loaded = await target.load(slug)
  if (!loaded.ok) return { retargeted: [], conflicts: [], droppedNotes: [], error: loaded.error }
  const { data, namesById, contentHash, listLabels } = loaded.data

  const { retargeted, conflicts } = retarget(changes, namesById, state)
  if (retargeted.length === 0) return { retargeted, conflicts, droppedNotes: [] }

  // The save route replays the changes against the file itself and refuses the
  // whole batch when any change does not apply, so the inapplicable ones are
  // split off here first — with the route's own reducer — and only the rest
  // are sent.
  const split = splitApplicable(data, retargeted, target, state, listLabels)
  const applicable = split.applicable
  const allConflicts = [...conflicts, ...split.missConflicts]
  if (applicable.length === 0) {
    return { retargeted: applicable, conflicts: allConflicts, droppedNotes: [] }
  }

  const saved = await saveChanges(target.type, slug, applicable, contentHash)
  return {
    retargeted: applicable.slice(0, saved.applied),
    conflicts: allConflicts,
    droppedNotes: saved.droppedNotes,
    ...(saved.error === undefined ? {} : { error: saved.error }),
  }
}

function applyByKind(
  kind: ListType,
  slug: string,
  changes: ChangeEvent[],
  state: RetargetState,
): Promise<ApplyOutcome> {
  switch (kind) {
    case 'deck':
      return applyToList(DECK_TARGET, slug, changes, state)
    case 'collection':
      return applyToList(COLLECTION_TARGET, slug, changes, state)
    case 'wanted':
      return applyToList(WANTED_TARGET, slug, changes, state)
    default: {
      kind satisfies never
      throw localizedCommandError(
        'runtime_error',
        ExitCode.RuntimeError,
        'admin.api.importChanges.unhandledKind',
      )
    }
  }
}

/**
 * Resolve a bundle list ref to the file basename the load/save handlers key on.
 * Two export surfaces produce different slugs: the admin editor and MCP server
 * use the file basename verbatim (e.g. `Red Binder`), while the public site
 * slugifies the display name for its URLs (e.g. `red-binder`). A basename that
 * exists on disk is used directly (admin/MCP round-trip); otherwise — or when
 * the ref carries no slug at all, as a move endpoint may — the display `name`
 * is resolved against the on-disk files via the shared list resolver, which
 * reverses the public site's slugging by matching case- and
 * diacritic-insensitively.
 */
async function resolveListBasename(list: ChangeBundleListRef): Promise<ApiCallResult<string>> {
  const dir = dirForType(list.kind)
  if (list.slug !== undefined) {
    const direct = path.join(dir, `${list.slug}.md`)
    if (isPathWithinDir(direct, dir) && (await Bun.file(direct).exists())) {
      return { ok: true, data: list.slug }
    }
  }

  const resolved = await resolveList(list.name, list.kind)
  if (isResolveListError(resolved))
    return { ok: false, error: resolveListErrorMessage(resolved, 'none') }
  return { ok: true, data: resolved.name }
}

/** A target's running result while its batches are applied. */
type TargetProgress = {
  /** The bundle's ref for the list — `slug` absent, not empty, when unknown. */
  ref: ChangeBundleListRef
  result: ListImportResult
  /** Resolved once per target: the basename, or the resolution failure. */
  basename?: ApiCallResult<string>
  /**
   * The re-target's memory across this target's batches: a copy added in an
   * earlier batch is what a later batch's edit may name, and the list loaded
   * fresh for that batch cannot say which exported id it was.
   */
  retarget: RetargetState
}

/**
 * Apply one batch onto its target, folding the outcome into the target's
 * running result. Resolution happens on the target's first batch and is
 * remembered; a failure (resolution, load, or save) marks the target and stops
 * its later batches.
 */
async function applyBatch(progress: TargetProgress, batch: ImportBatch): Promise<void> {
  const { result } = progress
  if (result.error !== undefined) return
  progress.basename ??= await resolveListBasename(progress.ref)
  const resolved = progress.basename
  if (!resolved.ok) {
    Object.assign(result, prefixedFields('error', resolved.error))
    return
  }
  if (result.slug === '') result.slug = resolved.data

  const outcome = await applyByKind(result.kind, resolved.data, batch.changes, progress.retarget)
  result.applied += outcome.error ? 0 : outcome.retargeted.length
  result.conflicts.push(...outcome.conflicts)
  result.droppedNotes = dedupeDroppedNotes([...result.droppedNotes, ...outcome.droppedNotes])
  if (outcome.error) Object.assign(result, prefixedFields('error', outcome.error))
}

/**
 * Apply a change bundle to the underlying list files: every list's changes and
 * every move, merged into one timestamp-ordered stream and applied batch by
 * batch (see {@link planImportBatches}). Each batch loads its list fresh
 * immediately before saving it — necessary because an earlier batch's
 * cross-list move may have rewritten the file since (a move lands as a
 * `move-to` on its destination, whose save takes the copy out of the source).
 * A batch that fails to load or save is reported on its list's result, stops
 * that list's remaining batches, and does not stop the other lists'. Shared by
 * the admin `POST /api/import-changes` route and the `ritual import-changes`
 * CLI.
 */
export async function applyChangeBundle(bundle: ChangeBundle): Promise<BundleImportResult> {
  const plan = planImportBatches(bundle)
  const progress: TargetProgress[] = plan.targets.map((target): TargetProgress => ({
    ref: target,
    retarget: createRetargetState(),
    result: {
      kind: target.kind,
      slug: target.slug ?? '',
      name: target.name,
      applied: 0,
      conflicts: [],
      droppedNotes: [],
    },
  }))
  for (const batch of plan.batches) {
    await applyBatch(progress[batch.target]!, batch)
  }
  const lists = progress.map((p) => p.result)
  return { failedCount: lists.filter((l) => l.error !== undefined).length, lists }
}

/**
 * Build the one-line summary of a bundle import ("Applied 3 changes across 2
 * lists"). Shared verbatim by the admin `POST /api/import-changes` response, the
 * MCP `import_change_bundle` tool (which calls that route), and the CLI's
 * `--output json` payload, so all three surfaces report identically.
 *
 * A {@link SyncMessage}, not an `ApiMessage`: each count is a plural noun of its
 * own, nested as a param so a reader's locale pluralizes it rather than English
 * being glued into a translated sentence.
 */
export function bundleImportMessage(result: BundleImportResult): SyncMessage {
  const changes = syncRef('domain.count.changes', {
    count: result.lists.reduce((sum, l) => sum + l.applied, 0),
  })
  if (result.failedCount === 0) {
    return syncMessage('admin.api.importChanges.applied', {
      changes,
      lists: syncRef('domain.count.lists', { count: result.lists.length }),
    })
  }
  return syncMessage('admin.api.importChanges.appliedWithFailures', {
    changes,
    count: result.failedCount,
  })
}

/**
 * `POST /api/import-changes` — apply an exported change bundle. The body is the
 * raw exported JSON; the response reports per-list
 * applied counts, skipped conflicts, and errors.
 */
export function handleImportChanges(req: Request): Promise<Response> {
  // `readJsonObjectBody` does not fit here: the body is the bundle's raw text,
  // which `parseChangeBundle` parses and validates itself.
  return apiHandler(async () => {
    const read = await readBodyText(req, MAX_UPLOAD_BODY_SIZE)
    if (!read.ok) return read.response

    const parsed = parseChangeBundle(read.text)
    if (!parsed.ok) return nestedRefusal(changeProblemMessage(parsed.problem))

    const result = await applyChangeBundle(parsed.value)
    const body: BundleImportResponse = {
      success: true,
      ...result,
      ...bundleImportMessage(result),
    }
    return Response.json(body)
  })
}
