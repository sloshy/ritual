import type { CardArtRef } from '../list/card-art'
import type { ChangeEvent } from '../changes/change-event'
import type { CardArtRefs } from './card-art-view'
import { reconcileIdPoolForUndo } from './reconcile-undo'
import type { SaveEffect } from './save-effects'
import type { UndoEntry } from './useCardChanges'

/**
 * Custom art an editor holds until the list it belongs to has been saved.
 *
 * Art is written by its own route (`PUT /api/art/:type/:slug`), which refuses an
 * `&N` no card line carries — and a card added during an editing session has no
 * line on disk until the save writes one. So art picked at add time is *staged*
 * here against the id the session allocated, and flushed once the save reports
 * what that id became.
 *
 * The ids can move: two entries may reach a save wanting the same `&N` (a
 * cross-list move carrying its source id, a replayed change bundle), and the
 * serializer hands the later claimant a fresh number. It reports that as an
 * `updated` effect carrying `previousCardId`, which is the only way a client
 * learns its optimistic id was renumbered — hence {@link artIdRemap}.
 *
 * Everything here is a pure function of its inputs; the hook that owns the
 * signals (`src/admin/site/hooks/useCardArt.ts`) is a shell around them.
 */

/** One art write waiting on a save: the id it was staged under, and the reference. */
export type PendingArt = {
  /** The id to write to — what the save gave the line, after any renumbering. */
  cardId: number
  /**
   * The key the reference was staged under, which is {@link cardId} unless the
   * save renumbered the line. Carried so the caller can retire exactly the
   * staged entries this save resolved, and leave alone anything staged while it
   * was in flight.
   */
  stagedId: number
  /** `null` clears whatever the sidecar holds for the id — see {@link PendingArtMap}. */
  art: CardArtRef | null
}

/**
 * A staged-art table, keyed by the card id the editing session allocated.
 *
 * A `null` value is a staged *clear*: the id pool hands a removed line's `&N`
 * to the next card added, so a new card can land on a number the sidecar still
 * has art filed under, and that art belongs to neither the new card nor the
 * file the save will write.
 */
export type PendingArtMap = ReadonlyMap<number, CardArtRef | null>

/**
 * Old id → new id for every line a save renumbered. Built from the effects the
 * save response carries, so a staged reference follows its card line rather than
 * landing on whichever card inherited its number.
 */
export function artIdRemap(effects: readonly SaveEffect[]): Map<number, number> {
  const remap = new Map<number, number>()
  for (const effect of effects) {
    if (effect.previousCardId !== undefined) remap.set(effect.previousCardId, effect.cardId)
  }
  return remap
}

/**
 * The staged art a completed save can now write, with each entry aimed at the id
 * the save actually gave its line. Ascending id order, so a failure reports the
 * same first offender every time.
 *
 * `liveCardIds` are the ids the list holds **after** the save — the set this
 * save's effects produced, never the pre-save one: the renumbered lines that
 * {@link artIdRemap} exists for are precisely the ones a pre-save set would
 * reject. Staging outlives the card it was picked for — adding a card with art
 * and then removing it again cancels both change events, leaving art staged for
 * a line that will never exist — and the art route refuses an id the list does
 * not have. Such an entry is dropped rather than turned into an error the user
 * cannot act on.
 */
export function resolvePendingArt(
  pending: PendingArtMap,
  effects: readonly SaveEffect[],
  liveCardIds: Iterable<number>,
): PendingArt[] {
  const remap = artIdRemap(effects)
  const live = new Set(liveCardIds)
  const writes: PendingArt[] = []
  for (const [stagedId, art] of pending) {
    const target = remap.get(stagedId) ?? stagedId
    if (!live.has(target)) continue
    writes.push({ cardId: target, stagedId, art })
  }
  return writes.sort((a, b) => a.cardId - b.cardId)
}

/**
 * The ids a save took out of the list, whose art the sidecar no longer holds:
 * every line reported `removed`, plus every line renumbered *away* from an id
 * (its art moved with it, so the old key is stale either way).
 *
 * An editor keeps its art table in memory across a save, and the id pool hands a
 * removed line's `&N` to the next card added — so a stale entry does not merely
 * linger, it decorates a different card.
 */
export function artIdsClearedBySave(effects: readonly SaveEffect[]): Set<number> {
  const cleared = new Set<number>()
  for (const effect of effects) {
    if (effect.action === 'removed') cleared.add(effect.cardId)
    else if (effect.previousCardId !== undefined) cleared.add(effect.previousCardId)
  }
  // A renumbered line's new id is live: never clear one the same save re-filed to.
  for (const effect of effects) {
    if (effect.previousCardId !== undefined) cleared.delete(effect.cardId)
  }
  return cleared
}

/**
 * What the pages render: the list's on-disk art with the staged edits laid over
 * it, so a card added with art shows it before the save that writes it.
 *
 * `baseline` is returned by identity when nothing is staged, which keeps the
 * editors' art memos from re-cloning every entry on an unrelated edit.
 */
export function artDisplayRefs(baseline: CardArtRefs, pending: PendingArtMap): CardArtRefs {
  if (pending.size === 0) return baseline
  const refs = new Map(baseline)
  for (const [cardId, ref] of pending) {
    if (ref === null) refs.delete(cardId)
    else refs.set(cardId, ref)
  }
  return refs
}

/**
 * The list's art with a set of writes laid over it — the ones that actually
 * reached the sidecar, so what the editor renders and what is on disk agree
 * even when some of a save's writes failed.
 *
 * The writes are already aimed at post-save ids by {@link resolvePendingArt}.
 */
export function applyArtWrites(baseline: CardArtRefs, writes: readonly PendingArt[]): CardArtRefs {
  if (writes.length === 0) return baseline
  const refs = new Map(baseline)
  for (const write of writes) {
    if (write.art === null) refs.delete(write.cardId)
    else refs.set(write.cardId, write.art)
  }
  return refs
}

/**
 * The list's art after a save: the ids the save renumbered re-filed, the ids it
 * removed dropped, and `writes` applied on top.
 *
 * Pass only the writes that landed — a failed art write leaves the sidecar
 * holding what it held before.
 */
export function artAfterSave(
  baseline: CardArtRefs,
  writes: readonly PendingArt[],
  effects: readonly SaveEffect[],
): CardArtRefs {
  const remap = artIdRemap(effects)
  const cleared = artIdsClearedBySave(effects)
  const refs = new Map<number, CardArtRef>()
  for (const [cardId, ref] of baseline) {
    const target = remap.get(cardId) ?? cardId
    if (cleared.has(target)) continue
    refs.set(target, ref)
  }
  return applyArtWrites(refs, writes)
}

/**
 * The ids the list holds on disk, updated by what a save reported.
 *
 * Only *changed* lines produce effects, so this starts from what was known and
 * applies the differences — it never re-derives the set. Removals are applied
 * before additions because a save that hands a freed `&N` to a new card reports
 * both an `added` and a `removed` effect under that one id, and the card that
 * arrived is the one that is now on disk.
 */
export function savedCardIdsAfterSave(
  saved: ReadonlySet<number>,
  effects: readonly SaveEffect[],
): Set<number> {
  const ids = new Set(saved)
  for (const effect of effects) {
    if (effect.action === 'removed') ids.delete(effect.cardId)
    else if (effect.previousCardId !== undefined) ids.delete(effect.previousCardId)
  }
  for (const effect of effects) {
    if (effect.action !== 'removed') ids.add(effect.cardId)
  }
  return ids
}

/**
 * The ids an undo handed back to the pool — a session add taken back, or a
 * removal reclaiming the `&N` it had released.
 *
 * Whatever was staged against such an id belongs to a card that is no longer
 * there, and the list's own art applies again: undoing the removal of a card
 * with custom art must show (and keep) that art, even when the id had since
 * been handed to a card added afterwards.
 *
 * Delegates to {@link reconcileIdPoolForUndo} rather than restating its rules,
 * so the art and the id pool can never disagree about which ids moved.
 */
export function artIdsResetByUndo(
  entry: UndoEntry,
  remainingChanges: ChangeEvent[] = [],
): number[] {
  const ids: number[] = []
  const collect = (id: number): void => {
    if (!ids.includes(id)) ids.push(id)
  }
  reconcileIdPoolForUndo(collect, collect, entry, remainingChanges)
  return ids
}

/** One thing an add does to the staged-art table. */
export type ArtStagingAction =
  /** Take back whatever is staged for this id — it belongs to no card the save will write. */
  | { kind: 'reset'; cardId: number }
  /** Stage this reference (or, with `null`, a clear) against the id. */
  | { kind: 'set'; cardId: number; art: CardArtRef | null }

/**
 * One added copy, as the two outcomes an add can have — mirroring
 * {@link import('./useCardChanges').AddCardResult} rather than restating it as a
 * flag, so "cancelled with a merge target" cannot be expressed.
 */
export type AddedCopyArt =
  | {
      kind: 'recorded'
      /** The id the session allocated for this copy. */
      cardId: number
      /**
       * The id of the line the copy merged into, when the list already had one
       * it belongs on (a deck quantity bump). That line carries its own art.
       */
      mergeTargetId?: number
      /** The art the add carried, `null` when it named none. */
      art: CardArtRef | null
    }
  | {
      kind: 'cancelled'
      cardId: number
      /**
       * The `&N` of the line that survives, from the cancelled removal — and
       * `undefined` when that removal named no id, which is a removal whose line
       * this session cannot identify.
       */
      survivorId: number | undefined
      art: CardArtRef | null
    }

/**
 * Where one added copy's custom art belongs, as the ordered edits to make.
 *
 * Three cases, and the middle one is the reason this is a function rather than
 * an `if` at the call site:
 *
 * - **The add cancelled a pending removal.** The session now touches nothing, so
 *   the id it allocated must be given up — but an add that *named art* is one of
 *   the two ways art legitimately returns to a card after a removal (the other
 *   being undo), so that art is staged against the surviving line instead of
 *   dropped. A plain re-add still leaves the line as the file has it. With no
 *   `survivorId` there is no line to aim at: staging against the allocated id
 *   would write to a number no saved line holds, which the save's liveness
 *   filter drops silently — so that art is refused here, visibly, instead.
 * - **The copies joined an existing line.** That line has its own art, so only an
 *   explicit reference has anything to say; adding without art must never clear
 *   what the target already wears.
 * - **A new line.** Reported art or not, the staging is written: the pool hands
 *   out the ids removals freed, so a fresh line can land on an `&N` an earlier
 *   card's art is still filed under, and a staged `null` is what clears it.
 */
export function addedCopyArtActions(copy: AddedCopyArt): readonly ArtStagingAction[] {
  if (copy.kind === 'cancelled') {
    if (copy.art === null || copy.survivorId === undefined) {
      return [{ kind: 'reset', cardId: copy.cardId }]
    }
    // The pool hands the re-add the number the removal released — which is why
    // the two cancelled each other at all (`areOppositeChanges` compares ids) —
    // so the reset is normally moot and would undo the write beside it.
    return copy.survivorId === copy.cardId
      ? [{ kind: 'set', cardId: copy.survivorId, art: copy.art }]
      : [
          { kind: 'reset', cardId: copy.cardId },
          { kind: 'set', cardId: copy.survivorId, art: copy.art },
        ]
  }
  if (copy.mergeTargetId !== undefined) {
    return copy.art === null ? [] : [{ kind: 'set', cardId: copy.mergeTargetId, art: copy.art }]
  }
  return [{ kind: 'set', cardId: copy.cardId, art: copy.art }]
}
