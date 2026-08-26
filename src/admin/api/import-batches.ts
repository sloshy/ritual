import type { ChangeEvent } from '../../changes/change-event'
import {
  bundleRefMatches,
  bundleTargets,
  moveToEventOf,
  sameBundleList,
  type ChangeBundle,
  type ChangeBundleListRef,
} from '../../changes/change-bundle'

/**
 * One run of consecutive bundle events aimed at the same list, in timestamp
 * order. A list's events may be split across several batches when another
 * list's events fall between them in time.
 */
export type ImportBatch = {
  /** Index into {@link ImportPlan.targets}. */
  target: number
  changes: ChangeEvent[]
}

/**
 * How a bundle is applied: the lists it touches and the ordered batches that
 * replay it. Pure — nothing here has looked at the disk.
 */
export type ImportPlan = {
  /**
   * Every list the bundle touches ({@link bundleTargets}), in first-seen
   * order: the bundle's own `lists` entries in export order, then any list
   * named only as a move endpoint — a source (whose copy leaves through the
   * destination's save, so it has no batch of its own and reports `applied:
   * 0`) or a destination (a "This list" export carries the moves that leave
   * it, whose far ends have no entry of their own).
   */
  targets: ChangeBundleListRef[]
  /** The batches to apply, in order. A target with nothing to apply has none. */
  batches: ImportBatch[]
}

/** An event tagged with its target and its position in the bundle, for the stable merge. */
type PlannedEvent = { target: number; order: number; event: ChangeEvent }

/**
 * Merge a bundle's per-list changes and its moves into one timestamp-ordered
 * stream and cut it into per-list batches.
 *
 * Each move becomes a `move-to {from}` on its DESTINATION list — the save side
 * takes the copy out of the source when that event lands
 * (`applyCrossListMoves`) — so a move is applied exactly once, and a bundle's
 * source list needs no `move-from` of its own. Events that share a timestamp
 * keep their recorded order: a list's own changes in export order, then the
 * moves in theirs. Ordering across lists is what lets the replay follow what
 * the user actually did — add a card, then move it out; swap a printing, then
 * set the new copy foil — instead of applying one list wholesale before the
 * next.
 */
export function planImportBatches(bundle: ChangeBundle): ImportPlan {
  const targets = bundleTargets(bundle)
  // A list entry is matched by identity (two decks sharing a name under
  // different slugs are two targets); a move endpoint — which may know only
  // the name — by the lookup rule.
  const indexOf = (
    ref: ChangeBundleListRef,
    matches: (a: ChangeBundleListRef, b: ChangeBundleListRef) => boolean,
  ): number => {
    const found = targets.findIndex((target) => matches(ref, target))
    if (found === -1) throw new Error(`bundleTargets omitted ${ref.kind} '${ref.name}'`)
    return found
  }

  const events: PlannedEvent[] = []
  for (const list of bundle.lists) {
    const target = indexOf(list, sameBundleList)
    for (const event of list.changes) events.push({ target, order: events.length, event })
  }
  for (const move of bundle.moves) {
    events.push({
      target: indexOf(move.to, bundleRefMatches),
      order: events.length,
      event: moveToEventOf(move),
    })
  }
  events.sort((a, b) => a.event.timestamp - b.event.timestamp || a.order - b.order)

  const batches: ImportBatch[] = []
  for (const { target, event } of events) {
    const last = batches[batches.length - 1]
    if (last !== undefined && last.target === target) last.changes.push(event)
    else batches.push({ target, changes: [event] })
  }
  return { targets, batches }
}
