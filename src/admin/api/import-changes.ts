import path from 'node:path'
import type { ChangeEvent } from '../../changes/change-event'
import { replaySectionOrder } from '../../changes/change-event'
import type { DeckData } from '../../list/deck'
import type { ListType } from '../../list/list-type'
import {
  dirForType,
  formatResolveListError,
  isResolveListError,
  resolveList,
} from '../../list/resolve-list'
import { isPathWithinDir } from '../../util/path-validation'
import {
  allocateId,
  collectDeckCardIds,
  collectExistingIds,
  createIdPool,
} from '../../card/card-id'
import {
  type ChangeBundle,
  type ChangeBundleListRef,
  countLabel,
  parseChangeBundle,
} from '../../changes/change-bundle'
import { planImportBatches, type ImportBatch } from './import-batches'
import {
  createRetargetState,
  importConflictReason,
  type ImportConflict,
  type RetargetResult,
  type RetargetState,
  retargetImportedChanges,
} from '../../editor/import-changes'
import { applyChangesCollectingMisses, type ApplyChange } from '../../changes/apply-batch'
import { applyChangeToCollection, toCollectionCardEntries } from '../../changes/collection-changes'
import { applyChangeToDeck, findDeckAddMergeTargetId } from '../../changes/deck-changes'
import { applyChangeToWantedList } from '../../changes/wanted-changes'
import { toWantedCardEntries } from '../../list/wanted-entries'
import { buildSyntheticRequest } from '../../util/synthetic-request'
import type { CollectionLoadResult, DeckLoadResult, WantedLoadResult } from './load-results'
import type { ApiMessage } from './result'
import { apiHandler } from '../utils'
import { badRequest, validateBodySize } from './save-helpers'
import { handleDeckLoad } from './deck-load'
import { handleDeckSave } from './deck-save'
import { handleCollectionLoad } from './collection-load'
import { handleCollectionSave } from './collection-save'
import { handleWantedListLoad } from './wanted-load'
import { handleWantedListSave } from './wanted-save'
import { MAX_LIST_BODY_SIZE } from '../validation'

/** Origin for synthetic in-process request URLs; nothing leaves the process. */
const SYNTHETIC_ORIGIN = 'http://ritual-import'

/**
 * The outcome of applying a bundle's changes to one list — its own entry's
 * changes plus every move arriving in it — aggregated across the batches the
 * timestamp order split them into.
 */
export type ListImportResult = {
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
   * Human-readable failure when the list could not be resolved, loaded, or
   * saved. The failing batch applied nothing and the list's later batches were
   * skipped (they would replay onto a file the earlier batch left unchanged);
   * batches already applied stay applied and are counted.
   */
  error?: string
}

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
export type BundleImportResponse = BundleImportResult & ApiMessage & { success: true }

type ApiCallResult<T> = { ok: true; data: T } | { ok: false; error: string }

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
    const message =
      typeof data.message === 'string' ? data.message : `Request failed (HTTP ${response.status})`
    return { ok: false, error: message }
  }
  return { ok: true, data: data as T }
}

/**
 * Re-aim a list's imported changes at its current card IDs: adds draw fresh IDs
 * from a pool seeded with the list's existing IDs, other changes resolve by ID
 * then by card name, and unresolvable ones become conflicts.
 */
function retarget(
  changes: ChangeEvent[],
  currentIds: number[],
  findIdByName: (name: string) => number | undefined,
  state: RetargetState,
): RetargetResult {
  const pool = createIdPool(currentIds)
  return retargetImportedChanges({
    changes,
    currentIds: new Set(currentIds),
    allocateId: () => allocateId(pool),
    findIdByName,
    state,
  })
}

function findDeckCardIdByName(deck: DeckData, name: string): number | undefined {
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (card.name === name && card.cardId !== undefined) return card.cardId
    }
  }
  return undefined
}

type NamedEntry = { name: string; cardId?: number }

function findEntryIdByName(entries: readonly NamedEntry[], name: string): number | undefined {
  return entries.find((e) => e.name === name && e.cardId !== undefined)?.cardId
}

type ApplyOutcome = {
  retargeted: ChangeEvent[]
  conflicts: ImportConflict[]
  error?: string
}

type SplitApplicableResult<TData> = {
  updated: TData
  applicable: ChangeEvent[]
  missConflicts: ImportConflict[]
}

/**
 * Apply the retargeted changes, demoting any that still do not apply to
 * conflicts instead of silently counting them as applied. Retargeting only
 * guarantees the target *card* resolves — a change can still miss at apply
 * time (an `unset-commander` on a card outside the commander section, or a
 * commander action aimed at a flat list). Misses no-op inside the engines, so
 * `updated` computed over the full list equals applying only the applicable
 * changes; the split exists so the save's changelog names only real edits.
 */
function splitApplicable<TData>(
  data: TData,
  retargeted: ChangeEvent[],
  apply: ApplyChange<TData, ChangeEvent>,
): SplitApplicableResult<TData> {
  const { data: updated, unmatched } = applyChangesCollectingMisses(data, retargeted, apply)
  if (unmatched.length === 0) return { updated, applicable: retargeted, missConflicts: [] }
  const missed = new Set(unmatched.map((item) => item.change))
  return {
    updated,
    applicable: retargeted.filter((change) => !missed.has(change)),
    // The engine's reason travels through: `no-target` really is "card not
    // found", but `needs-printing` names a card that is present and only needs
    // a printing pinned first, and reporting that as "not found" would send the
    // user hunting for a card they can see.
    missConflicts: unmatched.map((item) => ({
      change: item.change,
      reason: importConflictReason(item.reason),
    })),
  }
}

/**
 * Re-aim a deck batch's `add`/`move-to` copies that the deck reducer folded
 * onto a line it already had. Each such copy was allocated a fresh id by the
 * re-target, but the reducer merges same-tuple copies onto one line, so the
 * fresh id names no line in the written deck — and would end up in the
 * changelog and the art plan as a phantom `&N`. The change is rewritten to the
 * line's real id (the one the exporting editor would have used), and the
 * re-target state follows, so a later reference to that copy resolves.
 */
function rewriteMergedDeckIds(
  deck: DeckData,
  changes: ChangeEvent[],
  state: RetargetState,
): ChangeEvent[] {
  const present = new Set(collectDeckCardIds(deck))
  return changes.map((change) => {
    if (change.action !== 'add' && change.action !== 'move-to') return change
    if (change.cardId === undefined || present.has(change.cardId)) return change
    // Labels are part of the merge identity (`mergesOntoCard`): a `[proxy]`
    // arrival folds onto the `[proxy]` line, never its plain sibling. A
    // `move-to` carries none (the copy lands under the list default).
    const merged = findDeckAddMergeTargetId(deck, {
      action: 'add',
      cardName: change.cardName,
      set: change.set,
      collectorNumber: change.collectorNumber,
      finish: change.finish,
      condition: change.condition,
      language: change.language,
      labels: 'labels' in change ? change.labels : undefined,
    })
    if (merged === undefined) return change
    for (const [exported, allocated] of state.idMap) {
      if (allocated === change.cardId) state.idMap.set(exported, merged)
    }
    if (state.addedByName.get(change.cardName) === change.cardId) {
      state.addedByName.set(change.cardName, merged)
    }
    return { ...change, cardId: merged }
  })
}

async function applyToDeck(
  slug: string,
  changes: ChangeEvent[],
  state: RetargetState,
): Promise<ApplyOutcome> {
  const encoded = encodeURIComponent(slug)
  // `view=cards` for the same reason the MCP mutations use it: this reads only
  // the deck lines, front matter, and content hash, never the Scryfall payload.
  const loaded = await call<DeckLoadResult>(
    handleDeckLoad,
    'GET',
    `/api/deck/${encoded}?view=cards`,
  )
  if (!loaded.ok) return { retargeted: [], conflicts: [], error: loaded.error }
  const { deck, frontMatter, contentHash } = loaded.data

  const { retargeted, conflicts } = retarget(
    changes,
    collectDeckCardIds(deck),
    (name) => findDeckCardIdByName(deck, name),
    state,
  )
  if (retargeted.length === 0) return { retargeted, conflicts }

  const split = splitApplicable(deck, retargeted, applyChangeToDeck)
  const { updated, missConflicts } = split
  const applicable = rewriteMergedDeckIds(updated, split.applicable, state)
  const allConflicts = [...conflicts, ...missConflicts]
  if (applicable.length === 0) return { retargeted: applicable, conflicts: allConflicts }

  const saved = await call(handleDeckSave, 'POST', `/api/deck/${encoded}/save`, {
    changes: applicable,
    deck: updated,
    frontMatter,
    contentHash,
  })
  if (!saved.ok) return { retargeted: [], conflicts: allConflicts, error: saved.error }
  return { retargeted: applicable, conflicts: allConflicts }
}

async function applyToCollection(
  slug: string,
  changes: ChangeEvent[],
  state: RetargetState,
): Promise<ApplyOutcome> {
  const encoded = encodeURIComponent(slug)
  const loaded = await call<CollectionLoadResult>(
    handleCollectionLoad,
    'GET',
    `/api/collection/${encoded}?view=cards`,
  )
  if (!loaded.ok) return { retargeted: [], conflicts: [], error: loaded.error }
  const { entries, sectionOrder, contentHash } = loaded.data

  const { retargeted, conflicts } = retarget(
    changes,
    collectExistingIds(entries),
    (name) => findEntryIdByName(entries, name),
    state,
  )
  if (retargeted.length === 0) return { retargeted, conflicts }

  // The collection save endpoint replays the changes against the file itself
  // and rejects the whole batch when any change does not apply, so split off
  // inapplicable changes here first (the local dry run maps entries exactly the
  // way the handler does) and send only the applicable ones.
  const { applicable, missConflicts } = splitApplicable(
    toCollectionCardEntries(entries),
    retargeted,
    applyChangeToCollection,
  )
  const allConflicts = [...conflicts, ...missConflicts]
  if (applicable.length === 0) return { retargeted: applicable, conflicts: allConflicts }

  const saved = await call(handleCollectionSave, 'POST', `/api/collection/${encoded}/save`, {
    changes: applicable,
    contentHash,
    sectionOrder: replaySectionOrder(sectionOrder ?? [], applicable),
  })
  if (!saved.ok) return { retargeted: [], conflicts: allConflicts, error: saved.error }
  return { retargeted: applicable, conflicts: allConflicts }
}

async function applyToWanted(
  slug: string,
  changes: ChangeEvent[],
  state: RetargetState,
): Promise<ApplyOutcome> {
  const encoded = encodeURIComponent(slug)
  const loaded = await call<WantedLoadResult>(
    handleWantedListLoad,
    'GET',
    `/api/wanted/${encoded}?view=cards`,
  )
  if (!loaded.ok) return { retargeted: [], conflicts: [], error: loaded.error }
  const { contentHash, sectionOrder } = loaded.data
  const entries = toWantedCardEntries(loaded.data.entries)

  const { retargeted, conflicts } = retarget(
    changes,
    collectExistingIds(entries),
    (name) => findEntryIdByName(entries, name),
    state,
  )
  if (retargeted.length === 0) return { retargeted, conflicts }

  // The wanted save endpoint serializes the entries it receives, so the changes
  // are applied here and the resulting entry list sent along with them.
  const { updated, applicable, missConflicts } = splitApplicable(
    entries,
    retargeted,
    applyChangeToWantedList,
  )
  const allConflicts = [...conflicts, ...missConflicts]
  if (applicable.length === 0) return { retargeted: applicable, conflicts: allConflicts }

  const saved = await call(handleWantedListSave, 'POST', `/api/wanted/${encoded}/save`, {
    changes: applicable,
    entries: updated,
    contentHash,
    sectionOrder: replaySectionOrder(sectionOrder ?? [], applicable),
  })
  if (!saved.ok) return { retargeted: [], conflicts: allConflicts, error: saved.error }
  return { retargeted: applicable, conflicts: allConflicts }
}

function applyByKind(
  kind: ListType,
  slug: string,
  changes: ChangeEvent[],
  state: RetargetState,
): Promise<ApplyOutcome> {
  switch (kind) {
    case 'deck':
      return applyToDeck(slug, changes, state)
    case 'collection':
      return applyToCollection(slug, changes, state)
    case 'wanted':
      return applyToWanted(slug, changes, state)
    default: {
      kind satisfies never
      throw new Error('Unhandled list kind (this is a bug)')
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
    return { ok: false, error: formatResolveListError(resolved, 'none') }
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
    result.error = resolved.error
    return
  }
  if (result.slug === '') result.slug = resolved.data

  const outcome = await applyByKind(result.kind, resolved.data, batch.changes, progress.retarget)
  result.applied += outcome.error ? 0 : outcome.retargeted.length
  result.conflicts.push(...outcome.conflicts)
  if (outcome.error) result.error = outcome.error
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
  const progress: TargetProgress[] = plan.targets.map(
    (target): TargetProgress => ({
      ref: target,
      retarget: createRetargetState(),
      result: {
        kind: target.kind,
        slug: target.slug ?? '',
        name: target.name,
        applied: 0,
        conflicts: [],
      },
    }),
  )
  for (const batch of plan.batches) {
    await applyBatch(progress[batch.target]!, batch)
  }
  const lists = progress.map((p) => p.result)
  return { failedCount: lists.filter((l) => l.error !== undefined).length, lists }
}

/**
 * Build the one-line human summary of a bundle import ("Applied 3 changes
 * across 2 lists"). Shared verbatim by the admin `POST /api/import-changes`
 * response, the MCP `import_change_bundle` tool (which calls that route), and the
 * CLI's `--output json` payload, so all three surfaces report identically.
 */
export function bundleImportMessage(result: BundleImportResult): string {
  const applied = countLabel(
    result.lists.reduce((sum, l) => sum + l.applied, 0),
    'change',
  )
  return result.failedCount === 0
    ? `Applied ${applied} across ${countLabel(result.lists.length, 'list')}`
    : `Applied ${applied}; ${countLabel(result.failedCount, 'list')} failed`
}

/**
 * `POST /api/import-changes` — apply an exported change bundle. The body is the
 * raw exported JSON; the response reports per-list
 * applied counts, skipped conflicts, and errors.
 */
export function handleImportChanges(req: Request): Promise<Response> {
  // `readJsonObjectBody` does not fit here: the body is the bundle's raw text,
  // which `parseChangeBundle` parses and validates itself. The size cap it also
  // performs is therefore applied on its own.
  return apiHandler(async () => {
    const sizeError = validateBodySize(req, MAX_LIST_BODY_SIZE)
    if (sizeError) return sizeError

    const bundle = parseChangeBundle(await req.text())
    if (typeof bundle === 'string') return badRequest(bundle)

    const result = await applyChangeBundle(bundle)
    const body: BundleImportResponse = {
      success: true,
      ...result,
      message: bundleImportMessage(result),
    }
    return Response.json(body)
  })
}
