import { CATEGORY_ACTIONS, type ChangeAction, type ChangeEvent } from '../changes/change-event'
import type { MessageKey } from '../i18n/messages/en'
import type { MissReason, UnmatchedChange } from '../changes/apply-batch'
import type { CardLabel } from '../card/card-labels'
import { replayAssigningIds, type IdReplayOps, type PinLanding } from '../changes/replay-ids'

/**
 * A change from an imported file that could not be applied to the current list:
 * its target card could not be resolved, or its action can never apply to the
 * list's type (a commander action aimed at a flat list).
 */
/**
 * Why a change from a bundle was skipped. Derived from {@link MissReason} so a
 * new engine refusal cannot be added without deciding how imports report it;
 * `no-target` is renamed because the re-targeting step reports it before the
 * engines ever see the change. Each reason names a different fix, so they are
 * never collapsed into one: a `needs-printing` change targets a card that is
 * right there and only needs a printing pinned first.
 */
export type ImportConflictReason = Exclude<MissReason, 'no-target'> | 'target-not-found'

export type ImportConflict = {
  change: ChangeEvent
  reason: ImportConflictReason
}

/** The import-side name for an engine's refusal. */
export function importConflictReason(reason: MissReason): ImportConflictReason {
  return reason === 'no-target' ? 'target-not-found' : reason
}

/**
 * A refused change is reported like any other inapplicable one — under the
 * reason the engine actually gave — so the import summary never counts an
 * edit the list did not take, nor names the wrong fix for it. A placeholder id
 * ({@link provisionalIdAllocator}) the refused change still carries names no
 * line, so it is left out of the report.
 */
export function refusedToConflicts(
  refused: readonly UnmatchedChange<ChangeEvent>[],
): ImportConflict[] {
  return refused.map((item) => ({
    change: withoutProvisionalIds(item.change),
    reason: importConflictReason(item.reason),
  }))
}

/**
 * The message naming each skip reason, shared by every surface that reports a
 * skipped change (the CLI's per-reason breakdown, the admin Import Changes
 * page). One table, so no surface can name a reason the engine did not report —
 * or, as the admin page used to, name one reason for all three.
 */
export const IMPORT_CONFLICT_REASON_KEY = {
  'target-not-found': 'domain.importConflict.targetNotFound',
  'not-applicable': 'domain.importConflict.notApplicable',
  'needs-printing': 'domain.importConflict.needsPrinting',
} as const satisfies Record<ImportConflictReason, MessageKey>

export type RetargetResult = {
  /** The changes re-aimed at the current list's card IDs, in order. */
  retargeted: ChangeEvent[]
  /** Changes dropped because their target card is no longer present. */
  conflicts: ImportConflict[]
}

/**
 * What a re-target learns about the ids it handed out, kept by the caller
 * between calls: an import applies a list in several batches (its events
 * interleave with other lists' in time), and a follow-up edit on a copy an
 * earlier batch added can only be found through what that batch allocated.
 */
export type RetargetState = {
  /** Exported id → the id this import gave the line it created. */
  idMap: Map<number, number>
  /** The id each card name was most recently added under, in this import. */
  addedByName: Map<string, number>
}

/** A fresh {@link RetargetState}, for a single-batch caller or a new target. */
export function createRetargetState(): RetargetState {
  return { idMap: new Map(), addedByName: new Map() }
}

/**
 * Placeholder ids for the lines an import creates. The re-target cannot know
 * the real `&N` a new line gets: that depends on what the batch removes before
 * it (a released id is reused) and on whether a deck folds the copy onto a line
 * it already has. So it hands out these instead — negative, so none can name a
 * line — and the replay (`replayAssigningIds`, with {@link isProvisionalId})
 * stamps each with the id its line actually gets, in apply order.
 */
export function provisionalIdAllocator(): () => number {
  let next = 0
  return () => --next
}

/** Whether `id` is a {@link provisionalIdAllocator} placeholder. */
export const isProvisionalId = (id: number): boolean => id < 0

/** `change` without the placeholder ids it carries (`cardId`, a pin's `replacesCardId`). */
function withoutProvisionalIds(change: ChangeEvent): ChangeEvent {
  let stripped = change
  if ('cardId' in stripped && stripped.cardId !== undefined && isProvisionalId(stripped.cardId)) {
    const { cardId: _placeholder, ...rest } = stripped
    stripped = rest
  }
  if (
    stripped.action === 'move-to' &&
    stripped.replacesCardId !== undefined &&
    isProvisionalId(stripped.replacesCardId)
  ) {
    const { replacesCardId: _placeholder, ...rest } = stripped
    stripped = rest
  }
  return stripped
}

/**
 * Point the re-target state at the real ids the replay gave its placeholders
 * (`resolved`: placeholder → id, `undefined` for a copy merged onto a line with
 * no id). A placeholder the replay never resolved — its line was not created —
 * is forgotten, so a later batch falls back to the card's name rather than
 * naming a line that does not exist.
 */
export function settleRetargetState(
  state: RetargetState,
  resolved: ReadonlyMap<number, number | undefined>,
): void {
  const settle = (id: number): number | undefined => (isProvisionalId(id) ? resolved.get(id) : id)
  for (const [exported, id] of state.idMap) {
    const real = settle(id)
    if (real === undefined) state.idMap.delete(exported)
    else state.idMap.set(exported, real)
  }
  for (const [name, id] of state.addedByName) {
    const real = settle(id)
    if (real === undefined) state.addedByName.delete(name)
    else state.addedByName.set(name, real)
  }
}

type RetargetParams = {
  changes: ChangeEvent[]
  /**
   * The card name on each line of the current list before importing, keyed by
   * its `&N`. An exported id is kept only where it still names the same card:
   * ids are recycled, so the line holding it now may be a different card.
   */
  currentNames: ReadonlyMap<number, string>
  /**
   * The id for a line an `add` / `move-to` creates — a
   * {@link provisionalIdAllocator} placeholder, which the replay then stamps
   * with the line's real id.
   */
  allocateId: () => number
  /** Carried across batches of the same list; a fresh state when omitted. */
  state?: RetargetState
  /**
   * How the list type lands a pinning `move-to` (`replacesCardId`). On an
   * `append` list (a wanted list) a pin is an arrival like any other, so it is
   * re-targeted as one; otherwise (the default) it pins a line of the list.
   */
  pins?: PinLanding
}

/**
 * Changes that name no card *line*, so an exported `&N` is nothing to retarget:
 * the section-structural three, plus the category actions. `set-categories` is
 * keyed by card NAME in one list, and an assignment for a name this list does
 * not hold is a harmless no-op the sidecar prunes, never an import conflict.
 * (`rename-category` / `set-category-order` carry no `cardName` at all and would
 * fall through the `cardName === undefined` arm below; they are listed so the
 * three read as one rule.)
 */
const UNTARGETED_ACTIONS = new Set<ChangeAction>([
  'add-section',
  'remove-section',
  'rename-section',
  ...CATEGORY_ACTIONS,
])

/** The first `&N` (in file order) whose line holds `cardName`. */
function firstIdNamed(names: ReadonlyMap<number, string>, cardName: string): number | undefined {
  for (const [id, name] of names) if (name === cardName) return id
  return undefined
}

const withCardId = (change: ChangeEvent, cardId: number): ChangeEvent =>
  ({ ...change, cardId }) as ChangeEvent

/**
 * Re-aim an imported change list at the current list's card IDs. The exported IDs
 * come from the source list at export time and rarely match the live list, so:
 *
 * - `add` and `move-to` changes get a fresh ID from `allocateId` (both *create*
 *   an entry in this list, so an exported ID is nothing to target), and later
 *   changes that referenced that card by its exported ID are remapped to it. A
 *   second add/move-to naming an exported id already allocated here reuses
 *   that id: the exporting editor put those copies on one line (a deck merges
 *   same-tuple copies), so they share the line here too.
 * - other card changes keep their ID when it still names the same card (a
 *   removed card's id is recycled, so the line holding it may be another card
 *   entirely), otherwise fall back to matching by card name — first against a card this same import added (a
 *   bundle move recorded on its source side carries no destination id, so a
 *   follow-up edit on the copy it brought in can only be found this way), then
 *   against the list as loaded;
 *   when neither resolves, the change is reported as a conflict rather than
 *   silently retargeted or dropped.
 * - section-structural changes (add/remove/rename-section) and the category
 *   actions (set-categories, rename-category, set-category-order) pass through
 *   unchanged — they name no card line, and a categories assignment for a name
 *   this list does not hold is a no-op rather than a conflict.
 *
 * Pure and deterministic given the same inputs, so it is unit-tested directly.
 */
export function retargetImportedChanges(params: RetargetParams): RetargetResult {
  const { changes, currentNames, allocateId } = params
  const { idMap, addedByName } = params.state ?? createRetargetState()
  const retargeted: ChangeEvent[] = []
  const conflicts: ImportConflict[] = []

  /** Where an exported id that names an EXISTING line resolves here, or undefined. */
  const resolveExisting = (
    cardName: string,
    exportedId: number | undefined,
  ): number | undefined => {
    if (exportedId !== undefined) {
      // Remap a reference to a card added earlier in this same import.
      const mapped = idMap.get(exportedId)
      if (mapped !== undefined) return mapped
      // The exported ID still names this card in the current list — keep it.
      // A recycled id on another card falls through to the name lookup.
      if (currentNames.get(exportedId) === cardName) return exportedId
    }
    // Fall back to resolving by card name — a copy this import just added
    // first, since an unresolved exported id most plausibly named it, then the
    // first line of that name in the list as loaded.
    return addedByName.get(cardName) ?? firstIdNamed(currentNames, cardName)
  }

  for (const change of changes) {
    if (
      change.action === 'move-to' &&
      change.replacesCardId !== undefined &&
      params.pins !== 'append'
    ) {
      // A copy pinning a name-only line targets an existing line, so the
      // pinned id resolves like an edit's; the landing id is the pinned line
      // itself when the copy converts it in place, else a fresh one as for an add.
      const pinned = resolveExisting(change.cardName, change.replacesCardId)
      if (pinned === undefined) {
        conflicts.push({ change, reason: 'target-not-found' })
        continue
      }
      const inPlace = change.cardId === change.replacesCardId
      const mapped = change.cardId === undefined ? undefined : idMap.get(change.cardId)
      const newId = inPlace ? pinned : (mapped ?? allocateId())
      if (change.cardId !== undefined) idMap.set(change.cardId, newId)
      idMap.set(change.replacesCardId, pinned)
      addedByName.set(change.cardName, newId)
      retargeted.push({ ...change, cardId: newId, replacesCardId: pinned })
      continue
    }

    if (change.action === 'add' || change.action === 'move-to') {
      const mapped = change.cardId === undefined ? undefined : idMap.get(change.cardId)
      const newId = mapped ?? allocateId()
      if (change.cardId !== undefined) idMap.set(change.cardId, newId)
      addedByName.set(change.cardName, newId)
      retargeted.push(withCardId(change, newId))
      continue
    }

    if (UNTARGETED_ACTIONS.has(change.action)) {
      retargeted.push(change)
      continue
    }

    const cardName = 'cardName' in change ? change.cardName : undefined
    const exportedId = 'cardId' in change ? change.cardId : undefined
    if (cardName === undefined) {
      retargeted.push(change)
      continue
    }

    const resolved = resolveExisting(cardName, exportedId)
    if (resolved !== undefined) {
      retargeted.push(resolved === exportedId ? change : withCardId(change, resolved))
      continue
    }

    conflicts.push({ change, reason: 'target-not-found' })
  }

  return { retargeted, conflicts }
}

type ListImportParams<TData> = {
  /** The list as loaded — the baseline the changes replay over. */
  data: TData
  changes: ChangeEvent[]
  /** `&N` → card name on `data` (see {@link RetargetParams.currentNames}). */
  currentNames: ReadonlyMap<number, string>
  /** The list type's reducer and id rules — the save route's own. */
  ops: IdReplayOps<TData>
  /** Carried across batches of the same list; a fresh state when omitted. */
  state?: RetargetState
  /** The list's default labels, handed to every apply and merge probe. */
  listLabels?: readonly CardLabel[]
}

/** What {@link importIntoList} produced. */
export type ListImport<TData> = {
  /** The list with every applicable change replayed. */
  data: TData
  /** The changes that applied, re-aimed, each new line stamped with its real id. */
  applied: ChangeEvent[]
  /** The re-target's conflicts, then the changes the reducer refused. */
  conflicts: ImportConflict[]
}

/**
 * Bring an imported change list onto a list: re-target it at the list's card
 * IDs, giving each line it creates a placeholder id, then replay it with the
 * list type's reducer (`replayAssigningIds`), which gives each new line the id
 * the card-id rule says it gets at that point in the batch — a line removed
 * earlier has released its id, and a deck copy that merges onto a line takes
 * that line's id. The re-target state follows the real ids, so a later batch's
 * reference to a copy this one added resolves.
 *
 * Retargeting only guarantees the target *card* resolves; a change can still
 * miss at apply time (an `unset-commander` on a card outside the commander
 * section, a commander action aimed at a flat list). Those are reported as
 * conflicts and left out of `applied`, so a save names only real edits. The
 * one protocol both the admin import route and an editor's import use.
 */
export function importIntoList<TData>(params: ListImportParams<TData>): ListImport<TData> {
  const state = params.state ?? createRetargetState()
  const { retargeted, conflicts } = retargetImportedChanges({
    changes: params.changes,
    currentNames: params.currentNames,
    allocateId: provisionalIdAllocator(),
    state,
    pins: params.ops.pins,
  })
  const replayed = replayAssigningIds(params.data, retargeted, params.ops, {
    listLabels: params.listLabels,
    isProvisional: isProvisionalId,
  })
  settleRetargetState(state, replayed.resolved)
  const missed = new Set(replayed.unmatched.map((item) => item.change))
  return {
    data: replayed.data,
    applied: replayed.changes.filter((change) => !missed.has(change)),
    conflicts: [...conflicts, ...refusedToConflicts(replayed.unmatched)],
  }
}
