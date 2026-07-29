import type { ChangeEvent } from '../change-event'

/**
 * A change from an imported file that could not be applied to the current list:
 * its target card could not be resolved, or its action can never apply to the
 * list's type (a commander action aimed at a flat list).
 */
export type ImportConflict = {
  change: ChangeEvent
  reason: 'target-not-found' | 'not-applicable'
}

export type RetargetResult = {
  /** The changes re-aimed at the current list's card IDs, in order. */
  retargeted: ChangeEvent[]
  /** Changes dropped because their target card is no longer present. */
  conflicts: ImportConflict[]
}

type RetargetParams = {
  changes: ChangeEvent[]
  /** Card IDs present in the current list before importing. */
  currentIds: Set<number>
  /** Allocate a fresh card ID from the editor's pool (for `add` changes). */
  allocateId: () => number
  /** Resolve a card name to its current ID in the list, if present. */
  findIdByName: (name: string) => number | undefined
}

const SECTION_ACTIONS = new Set(['add-section', 'remove-section', 'rename-section'])

const withCardId = (change: ChangeEvent, cardId: number): ChangeEvent =>
  ({ ...change, cardId }) as ChangeEvent

/**
 * Re-aim an imported change list at the current list's card IDs. The exported IDs
 * come from the source list at export time and rarely match the live list, so:
 *
 * - `add` and `move-to` changes get a fresh ID from the pool (both *create* an
 *   entry in this list, so an exported ID is nothing to target), and later
 *   changes that referenced that card by its exported ID are remapped to it.
 * - other card changes keep their ID when it still exists, otherwise fall back to
 *   matching by card name; when neither resolves, the change is reported as a
 *   conflict rather than silently retargeted or dropped.
 * - section-structural changes (add/remove/rename-section) pass through unchanged.
 *
 * Pure and deterministic given the same inputs, so it is unit-tested directly.
 */
export function retargetImportedChanges(params: RetargetParams): RetargetResult {
  const { changes, currentIds, allocateId, findIdByName } = params
  const idMap = new Map<number, number>()
  const retargeted: ChangeEvent[] = []
  const conflicts: ImportConflict[] = []

  for (const change of changes) {
    if (change.action === 'add' || change.action === 'move-to') {
      const newId = allocateId()
      if (change.cardId !== undefined) idMap.set(change.cardId, newId)
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

    // Remap a reference to a card added earlier in this same import.
    if (exportedId !== undefined) {
      const mapped = idMap.get(exportedId)
      if (mapped !== undefined) {
        retargeted.push(withCardId(change, mapped))
        continue
      }
      // The exported ID still exists in the current list — keep it.
      if (currentIds.has(exportedId)) {
        retargeted.push(change)
        continue
      }
    }

    // Fall back to resolving by card name.
    const byName = findIdByName(cardName)
    if (byName !== undefined) {
      retargeted.push(withCardId(change, byName))
      continue
    }

    conflicts.push({ change, reason: 'target-not-found' })
  }

  return { retargeted, conflicts }
}
