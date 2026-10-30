import type { CardArtRef } from '../list/card-art'
import type { CardArtRefs } from './card-art-view'
import type { SaveEffect } from '../changes/save-effects'
import type { EntryWithCardId } from '../card/card-id'

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

/** One thing an add does to the staged-art table. */
export type ArtStagingAction =
  /** Take back whatever is staged for this id — it belongs to no card the save will write. */
  | { kind: 'reset'; cardId: number }
  /** Stage this reference (or, with `null`, a clear) against the id. */
  | { kind: 'set'; cardId: number; art: CardArtRef | null }

/** What one added copy came to — the two outcomes `useCardChanges.addCard` reports. */
export type AddedCopyOutcome =
  | {
      kind: 'recorded'
      /** The id the copy's event carries (`undefined` on a merge onto an id-less line). */
      cardId: number | undefined
    }
  | {
      kind: 'cancelled'
      cardId: number | undefined
      /**
       * The `&N` of the line that survives, from the cancelled removal — and
       * `undefined` when that removal named no id, which is a removal whose line
       * this session cannot identify.
       */
      survivorId: number | undefined
    }

/** One Add Card, as far as its custom art is concerned. */
export type AddCardArt = {
  /**
   * The line the copies join because the list already has one they merge
   * onto (a deck quantity bump), or `null` when they start a line. A line may
   * have no id yet, which is why this is not just a number.
   */
  mergeTarget: EntryWithCardId | null
  /** The art the add carried, `null` when it named none. */
  art: CardArtRef | null
  /** Each copy's outcome, in the order the copies were added. */
  copies: readonly AddedCopyOutcome[]
}

/**
 * Where an Add Card's custom art belongs, as the ordered edits to make —
 * planned across all its copies at once, because a copy changes what the next
 * one lands on.
 *
 * - **The copies join an existing line** (`mergeTarget`, or the line a copy
 *   before them restored by cancelling its removal). That line has its own
 *   art, so only an explicit reference has anything to say; adding without art
 *   must never clear what the line wears — staging a clear there would delete
 *   its art from the sidecar on save. A line with no id yet cannot take art
 *   (the art route keys on `&N`), so art aimed at one is refused the way a
 *   cancellation with no surviving line refuses it: nothing is staged, and the
 *   tile shows none rather than art no save would write.
 * - **A copy cancelled a pending removal.** The session now touches nothing, so
 *   the id it carried gives up its staging — but an add that *named art* is
 *   one of the two ways art legitimately returns to a card after a removal (the
 *   other being undo), so that art is staged against the surviving line
 *   instead. With no `survivorId` there is no line to aim at: staging against
 *   the carried id would write to a number no saved line holds, which the
 *   save's liveness filter drops silently — so that art is refused here,
 *   visibly, instead.
 * - **A new line.** Reported art or not, the staging is written: the pool hands
 *   out the ids removals freed, so a fresh line can land on an `&N` an earlier
 *   card's art is still filed under, and a staged `null` is what clears it.
 *
 * Each distinct edit appears once, under the copy that first makes it — the
 * plan is one list per copy, so undoing a copy reverts exactly its own edits.
 */
export function addCardArtPlan(add: AddCardArt): ArtStagingAction[][] {
  const plan: ArtStagingAction[][] = []
  let mine: ArtStagingAction[] = []
  // Every `set` in one plan stages the same `add.art`, so kind and id say
  // whether an edit was already made.
  const made = new Set<string>()
  const push = (action: ArtStagingAction): void => {
    const key = `${action.kind}:${action.cardId}`
    if (made.has(key)) return
    made.add(key)
    mine.push(action)
  }
  let joins = add.mergeTarget
  for (const copy of add.copies) {
    mine = []
    plan.push(mine)
    if (joins !== null) {
      if (add.art !== null && joins.cardId !== undefined) {
        push({ kind: 'set', cardId: joins.cardId, art: add.art })
      }
      continue
    }
    if (copy.kind === 'cancelled') {
      const { cardId, survivorId } = copy
      // The pool hands the re-add the number the removal released — which is
      // why the two cancelled each other at all (`areOppositeChanges` compares
      // ids) — so the reset is normally moot and would undo the write beside it.
      if (cardId !== undefined && (add.art === null || survivorId !== cardId)) {
        push({ kind: 'reset', cardId })
      }
      if (survivorId !== undefined) {
        if (add.art !== null) push({ kind: 'set', cardId: survivorId, art: add.art })
        // The line is back: the copies after this one join it.
        joins = { cardId: survivorId }
      }
      continue
    }
    if (copy.cardId !== undefined) push({ kind: 'set', cardId: copy.cardId, art: add.art })
  }
  return plan
}

/** What is staged against an id: a reference, `null` (a staged clear), or `undefined` (nothing). */
export type StagedArt = CardArtRef | null | undefined

/**
 * The staged-art table as an editor host offers it (the admin's `useCardArt`).
 * One object, so a host cannot stage art without also letting an undo read
 * what it staged.
 */
export type ArtStaging = {
  /** Stage a reference (or, with `null`, a clear) against an id. */
  stage: (cardId: number, art: CardArtRef | null) => void
  /** Drop whatever is staged against an id, so the list's own art applies again. */
  reset: (cardId: number) => void
  /** What is staged against an id right now. */
  staged: (cardId: number) => StagedArt
}

/**
 * What an action did to one staged-art id: what the id held before it, and
 * what it held right after — so an undo can put back `before`, and only while
 * the id still holds `after`.
 */
export type ArtRestore = { cardId: number; before: StagedArt; after: StagedArt }

/**
 * Make `actions` through `staging`, recording each touched id's staged art
 * before and after them (one entry per id, in the order first touched).
 */
export function applyArtActions(
  actions: readonly ArtStagingAction[],
  staging: ArtStaging,
): ArtRestore[] {
  const before = new Map<number, StagedArt>()
  for (const action of actions) {
    if (!before.has(action.cardId)) before.set(action.cardId, staging.staged(action.cardId))
  }
  for (const action of actions) {
    if (action.kind === 'reset') staging.reset(action.cardId)
    else staging.stage(action.cardId, action.art)
  }
  return [...before].map(([cardId, was]) => ({
    cardId,
    before: was,
    after: staging.staged(cardId),
  }))
}

/**
 * The edits that undo an action's art: each id it touched goes back to what it
 * held before — and nothing else. Art is never inferred from which ids the
 * pool moved: that would wipe art a still-pending add staged on a line when an
 * unrelated decrement of it is undone, and would leave the art a merged add
 * staged when the add itself is undone.
 *
 * An id that no longer holds what the action left there was changed since (the
 * art dialog, on a line the session added), and that later edit stands.
 */
export function artUndoActions(
  restores: readonly ArtRestore[],
  staged: (cardId: number) => StagedArt,
): ArtStagingAction[] {
  const actions: ArtStagingAction[] = []
  for (const { cardId, before, after } of restores) {
    if (staged(cardId) !== after) continue
    actions.push(
      before === undefined ? { kind: 'reset', cardId } : { kind: 'set', cardId, art: before },
    )
  }
  return actions
}
