import {
  loadCardArt,
  type CardArtMap,
  type CardArtReconcileInput,
  type CardArtReconcileResult,
  type CardArtRef,
} from '../../list/card-art'
import { t } from '../../i18n/t'
import { reconcileListRefs } from '../../list/list-refs'

/** What the Set Custom Art prompt resolved to: a reference, or `null` to clear. */
export type CardArtEdit = { ref: CardArtRef | null }

/**
 * A CLI edit session's pending custom-art bookkeeping.
 *
 * The `<list>.art.json` sidecar is keyed by a card line's `&N`, and an edit
 * session hands released ids straight back out: removing a line frees its id to
 * the session pool, which gives it to the next card added. Art left filed under
 * that id does not merely go stale — it reappears on a different card. Since
 * nothing is written until the session is saved, the operations record what
 * happened here and {@link commitSessionArt} re-files the sidecar in the same
 * step that writes the list file. The Set Custom Art edit action
 * ({@link noteArtSet}) is deferred through the same channel, for the same
 * reason: it is one more edit the session's save commits and its undo takes
 * back.
 *
 * Ids are in the sidecar's own key space, i.e. the ids as the file on disk has
 * them.
 *
 * There is deliberately no `renumbered` channel, unlike the admin save tail
 * (which derives one from its `SaveEffect`s). A session never renumbers an
 * existing line: ids come from a pool seeded at load (flat lists) or from the
 * ids the deck already carries, an arriving move is stripped of the source's id
 * before it is applied, and a discard's re-pack only touches ids the session
 * itself created. If a session ever gains a path that can renumber a
 * *pre-existing* line, this type needs a `renumbered` channel too and the
 * serializers' assignment reports have to be threaded through
 * {@link commitSessionArt}.
 */
export type SessionArtChanges = {
  /** Ids whose line the session removed or moved out. */
  removed: Set<number>
  /** Art arriving with a card this session received from a cross-list move. */
  added: Map<number, CardArtRef>
  /**
   * Art the user set (or cleared, as `null`) with the Set Custom Art edit
   * action, keyed by the line's id.
   *
   * A separate channel from `added` rather than a second writer of it, because
   * the two are undone differently and because a removal has to win over an
   * edit it postdates: {@link commitSessionArt} folds these in *under*
   * `removed`, so setting art on a line and then taking the line out leaves no
   * entry — while undoing that removal ({@link noteArtLineRestored}) brings the
   * pending edit back with the line, which is the state the session's own undo
   * stack still claims.
   */
  edited: Map<number, CardArtRef | null>
  /**
   * Ids this session lifted **out of** `removed` because it staged art under
   * them — a new line that took a freed number, or a card that arrived on one.
   *
   * The rescue is what keeps the new card's art; this set is what takes the
   * rescue back. Discarding the session add that earned it (a re-pack, or the
   * discard of the arrival itself) leaves the id free again, and the departed
   * card's removal has to return to `removed` — otherwise its sidecar entry
   * survives under a number the next card added would inherit, which is the
   * exact resurfacing this module exists to prevent.
   *
   * Disjoint from `removed` by construction: an id is in one or the other.
   */
  reclaimedFromRemoved: Set<number>
  /**
   * The sidecar as it is on disk, read at most once per save cycle by
   * {@link currentSessionArt} and dropped again when the session writes. Null
   * before the first read — a session that never touches art never reads it.
   */
  baseline: CardArtMap | null
}

/** A session's art bookkeeping, empty. */
export function createSessionArtChanges(): SessionArtChanges {
  return {
    removed: new Set(),
    added: new Map(),
    edited: new Map(),
    reclaimedFromRemoved: new Set(),
    baseline: null,
  }
}

/**
 * Lift `cardId` out of `removed` because the session staged art under it, and
 * remember that it did — {@link restoreReclaimedRemoval} is how a discard of
 * that staged art puts the removal back.
 */
function reclaimFromRemoved(art: SessionArtChanges, cardId: number): void {
  if (art.removed.delete(cardId)) art.reclaimedFromRemoved.add(cardId)
}

/** Put back the removal {@link reclaimFromRemoved} cancelled, if it cancelled one. */
function restoreReclaimedRemoval(art: SessionArtChanges, cardId: number): void {
  if (art.reclaimedFromRemoved.delete(cardId)) art.removed.add(cardId)
}

/**
 * The reference `cardId` would be filed under if the session saved now: the
 * edit if it has one (a clear reads as no art), and otherwise whatever arrived
 * with a moved card. Mirrors the fold {@link pendingSessionArt} performs.
 */
function stagedArtRef(art: SessionArtChanges, cardId: number): CardArtRef | null {
  if (art.edited.has(cardId)) return art.edited.get(cardId) ?? null
  return art.added.get(cardId) ?? null
}

/**
 * Record that a line is gone — a full removal or the source side of a move. A
 * decremented deck line keeps its `&N`, and its art, so it is not reported here.
 *
 * Any pending arrival for the id is cancelled: the reconcile applies additions
 * last and unconditionally, so leaving one would re-file art under an id whose
 * line the same session removed — the very resurfacing this module prevents.
 *
 * A pending *edit* is deliberately kept instead of cancelled. The commit folds
 * edits in under `removed`, so the removal still wins the sidecar; keeping it
 * means undoing the removal restores the art the session had staged, rather
 * than silently reverting to whatever the file on disk says while the undo
 * stack still lists the edit as pending.
 */
export function noteArtLineRemoved(art: SessionArtChanges, cardId: number): void {
  art.added.delete(cardId)
  art.removed.add(cardId)
  // `removed` holds the id outright now, so there is no cancelled removal left
  // for a later discard to restore.
  art.reclaimedFromRemoved.delete(cardId)
}

/**
 * Record that a removal was undone *under its original id*. An undo that had to
 * take a fresh id instead (the id was reused in the meantime) is deliberately
 * not a restore: the art's old id now belongs to another card.
 */
export function noteArtLineRestored(art: SessionArtChanges, cardId: number): void {
  art.removed.delete(cardId)
  // The line is back under its own number: there is no longer a removal for a
  // discarded session add to hand back.
  art.reclaimedFromRemoved.delete(cardId)
}

/**
 * Record art arriving with a card the session received from another list. The
 * id is taken back out of `removed` so the two channels stay disjoint by
 * construction rather than by the reconcile's ordering — and the rescue is
 * remembered, so discarding the arrival puts the removal back.
 */
export function noteArtArrival(art: SessionArtChanges, cardId: number, ref: CardArtRef): void {
  reclaimFromRemoved(art, cardId)
  // An edit staged under this id belonged to the line that used to hold it —
  // the arriving card is a different card, and its own art must win.
  art.edited.delete(cardId)
  art.added.set(cardId, ref)
}

/**
 * Record the Set Custom Art edit action: `ref` for a new image, `null` to clear
 * the card's art. The id leaves `removed` for a real reference, so setting art
 * on a line that took over a freed id is not undone by the removal that freed
 * it; a clear needs no such rescue, since `removed` already means "no art".
 *
 * The rescue is recorded, not forgotten: discarding the session add that earned
 * it (a re-pack) has to put the departed card's removal back.
 */
export function noteArtSet(art: SessionArtChanges, cardId: number, ref: CardArtRef | null): void {
  if (ref !== null) reclaimFromRemoved(art, cardId)
  art.edited.set(cardId, ref)
}

/**
 * Follow a session-add discard's id re-pack: the discarded line's pending art
 * is dropped, and the survivors' art moves to the ids they were renumbered to.
 * Without this the re-pack would leave art filed under a number another card in
 * the same session now carries.
 *
 * `removed` is not remapped: it only ever holds ids of lines that existed
 * before the session, which a re-pack never touches. It is however *restored*
 * around the re-pack. A session add can be sitting on an id an earlier removal
 * freed, having cancelled that removal to keep its own art
 * (`reclaimedFromRemoved`); every id this re-pack vacates — the discarded line
 * and each line that moved down — gives its cancelled removal back, and each id
 * the re-pack fills earns the cancellation again if the line now on it carries
 * art. Without that, the departed card's sidecar entry would outlive the
 * discard under a free number, waiting for the next card to inherit it.
 */
export function noteArtRepack(
  art: SessionArtChanges,
  remap: ReadonlyMap<number, number>,
  discardedId: number,
): void {
  art.added.delete(discardedId)
  art.edited.delete(discardedId)
  restoreReclaimedRemoval(art, discardedId)
  if (remap.size === 0) return
  art.added = remapArtKeys(art.added, remap)
  art.edited = remapArtKeys(art.edited, remap)
  for (const vacated of remap.keys()) restoreReclaimedRemoval(art, vacated)
  for (const target of remap.values()) {
    if (stagedArtRef(art, target) !== null) reclaimFromRemoved(art, target)
  }
}

/** One art channel with its keys moved through `remap` (unlisted keys stay put). */
function remapArtKeys<V>(
  entries: Map<number, V>,
  remap: ReadonlyMap<number, number>,
): Map<number, V> {
  const next = new Map<number, V>()
  for (const [cardId, value] of entries) next.set(remap.get(cardId) ?? cardId, value)
  return next
}

/** One card's custom art as the session currently has it, or why it cannot be read. */
export type SessionArtLookup = { ok: true; ref: CardArtRef | null } | { ok: false; message: string }

/**
 * The art a card wears right now in an unsaved session: the session's own
 * pending state where it has one, and otherwise the sidecar on disk (read once
 * and remembered until the session saves).
 *
 * An unreadable sidecar is reported rather than treated as "no art" — the
 * editor refuses the art action instead of offering to overwrite a file it
 * cannot read.
 */
export async function currentSessionArt(
  listFilePath: string,
  art: SessionArtChanges,
  cardId: number,
): Promise<SessionArtLookup> {
  if (art.edited.has(cardId)) return { ok: true, ref: art.edited.get(cardId) ?? null }
  const arrived = art.added.get(cardId)
  if (arrived !== undefined) return { ok: true, ref: arrived }
  if (art.removed.has(cardId)) return { ok: true, ref: null }
  if (art.baseline === null) {
    const loaded = await loadCardArt(listFilePath)
    if (!loaded.ok) return { ok: false, message: loaded.message }
    art.baseline = loaded.art
  }
  return { ok: true, ref: art.baseline.get(cardId) ?? null }
}

/**
 * Re-file a saved session's art sidecar and reset the bookkeeping.
 *
 * The list's cover image is re-pointed in the same step ({@link reconcileListRefs}):
 * it is filed under an `&N` exactly as the sidecar's entries are.
 *
 * The pending sets are cleared however the reconcile went — including when it
 * throws — because replaying the same removals against the *next* save would
 * target ids the list has since handed to other cards. The remembered baseline
 * goes with them, and goes even when there was nothing pending at all. The
 * result is returned
 * rather than swallowed so the caller can tell the user that a sidecar it could
 * not read was left as it is.
 */
export async function commitSessionArt(
  listFilePath: string,
  art: SessionArtChanges,
): Promise<CardArtReconcileResult> {
  // Cleared before the early return, not inside the `finally`: a save with
  // nothing pending is still a save, and the remembered sidecar would go on
  // answering for a file another surface (`set-card --art`, the admin route)
  // may have rewritten in the meantime.
  art.baseline = null
  if (art.removed.size === 0 && art.added.size === 0 && art.edited.size === 0) {
    return { ok: true, changed: false }
  }
  try {
    return (await reconcileListRefs(listFilePath, pendingSessionArt(art))).art
  } finally {
    art.removed.clear()
    art.added.clear()
    art.edited.clear()
    art.reclaimedFromRemoved.clear()
  }
}

/**
 * The session's pending art as one reconcile input.
 *
 * Edits fold in last, so a card whose art the user set after it arrived from a
 * move keeps what they set — but *under* `removed`, so a line taken out after
 * its art was set really does leave without it. The two can only meet on one id
 * through a removal that postdates the edit: {@link noteArtSet} drops the id
 * from `removed` when a new line takes the number over.
 */
export function pendingSessionArt(art: SessionArtChanges): CardArtReconcileInput {
  const removed = new Set(art.removed)
  const added = new Map(art.added)
  for (const [cardId, ref] of art.edited) {
    if (removed.has(cardId)) {
      added.delete(cardId)
      continue
    }
    if (ref === null) {
      added.delete(cardId)
      removed.add(cardId)
    } else {
      added.set(cardId, ref)
    }
  }
  return { removed, added }
}

/**
 * Report a sidecar the save could not re-file. The card lines were written
 * correctly, so this is a warning rather than a failure — but it must not be
 * silent: the ids the save freed still carry their old art, which the next card
 * to take one of those numbers would wear.
 */
export function warnUnreconciledArt(result: CardArtReconcileResult): void {
  if (result.ok) return
  console.warn(t('cli.session.artSidecarUnreadable', { reason: result.message }))
}
