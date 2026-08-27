/**
 * The copy ledger a save is replayed against: how many copies each `&N` line
 * held on disk, and the in-order replay of a save's copy-changing events over
 * it. Pure over `ChangeEvent`s; shared by the admin save tail's art reconcile
 * and the cross-list move writer.
 */

import type { ChangeEvent } from './change-event'
import type { DeckData } from '../list/deck'
import type { EntryWithCardId } from '../card/card-id'

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
export type LineCopyChange = Extract<
  ChangeEvent,
  { action: 'add' | 'remove' | 'move-from' | 'move-to' }
>

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
    const step = (id: number, gain: boolean): void => {
      const before = copies.get(id) ?? baseline.get(id) ?? options.unknownIdHolds
      const after = gain ? before + 1 : before - 1
      copies.set(id, after)
      steps.push({ change, cardId: id, before, after })
    }
    if (change.action === 'move-to' && change.replacesCardId !== undefined) {
      // A copy pinning a name-only line in place changes no line's copy count;
      // a split takes one off the name-only line before it lands on `cardId`.
      if (change.replacesCardId === cardId) continue
      step(change.replacesCardId, false)
    }
    step(cardId, change.action === 'add' || change.action === 'move-to')
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
