import type { ChangeAction, ChangeEvent } from '../changes/change-event'
import type { MessageKey } from '../i18n/messages/en'
import type { MissReason } from '../changes/apply-batch'

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

type RetargetParams = {
  changes: ChangeEvent[]
  /** Card IDs present in the current list before importing. */
  currentIds: Set<number>
  /** Allocate a fresh card ID from the editor's pool (for `add` changes). */
  allocateId: () => number
  /** Resolve a card name to its current ID in the list, if present. */
  findIdByName: (name: string) => number | undefined
  /** Carried across batches of the same list; a fresh state when omitted. */
  state?: RetargetState
}

const SECTION_ACTIONS = new Set<ChangeAction>(['add-section', 'remove-section', 'rename-section'])

const withCardId = (change: ChangeEvent, cardId: number): ChangeEvent =>
  ({ ...change, cardId }) as ChangeEvent

/**
 * Re-aim an imported change list at the current list's card IDs. The exported IDs
 * come from the source list at export time and rarely match the live list, so:
 *
 * - `add` and `move-to` changes get a fresh ID from the pool (both *create* an
 *   entry in this list, so an exported ID is nothing to target), and later
 *   changes that referenced that card by its exported ID are remapped to it. A
 *   second add/move-to naming an exported id already allocated here reuses
 *   that id: the exporting editor put those copies on one line (a deck merges
 *   same-tuple copies), so they share the line here too.
 * - other card changes keep their ID when it still exists, otherwise fall back to
 *   matching by card name — first against a card this same import added (a
 *   bundle move recorded on its source side carries no destination id, so a
 *   follow-up edit on the copy it brought in can only be found this way), then
 *   against the list as loaded;
 *   when neither resolves, the change is reported as a conflict rather than
 *   silently retargeted or dropped.
 * - section-structural changes (add/remove/rename-section) pass through unchanged.
 *
 * Pure and deterministic given the same inputs, so it is unit-tested directly.
 */
export function retargetImportedChanges(params: RetargetParams): RetargetResult {
  const { changes, currentIds, allocateId, findIdByName } = params
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
      // The exported ID still exists in the current list — keep it.
      if (currentIds.has(exportedId)) return exportedId
    }
    // Fall back to resolving by card name — a copy this import just added
    // first, since an unresolved exported id most plausibly named it.
    return addedByName.get(cardName) ?? findIdByName(cardName)
  }

  for (const change of changes) {
    if (change.action === 'move-to' && change.replacesCardId !== undefined) {
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

    if (SECTION_ACTIONS.has(change.action)) {
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
