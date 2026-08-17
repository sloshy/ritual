import { batch, createMemo, createSignal, type Accessor } from 'solid-js'
import type { CardArtRecord, CardArtRef } from '../../../card-art'
import { cardArtRefsFrom, type CardArtRefs } from '../../../editor/card-art-view'
import type { CardContextInfo } from '../../../editor/context-menu'
import {
  applyArtWrites,
  artAfterSave,
  artDisplayRefs,
  resolvePendingArt,
  savedCardIdsAfterSave,
  type PendingArt,
} from '../../../editor/pending-art'
import type { SaveEffect } from '../../../editor/save-effects'
import { statusMessage, type EditorStatusActions } from '../../../editor/useEditorStatus'
import type { ListType } from '../../../list-type'
import { promptCardArt } from '../card-art-prompt'
import { putCardArt } from '../editor-backend'

/**
 * The custom-art half of an admin editor page: the references the load body
 * carried, the edits the session is holding for lines that do not exist yet,
 * and the dialog that rewrites one of them.
 *
 * Held beside the editor session rather than inside it. Art is list metadata,
 * written by its own route into a sidecar no card save touches — the same
 * relationship the list-default labels have with the metadata route. For a card
 * already in the file that means an immediate write; for one this session added
 * it cannot, because the art route refuses an `&N` no card line carries. Those
 * edits are staged (`src/editor/pending-art.ts`) and flushed by
 * {@link UseCardArtResult.flush} once the save reports which id each new line
 * actually got.
 */
export type UseCardArtResult = {
  /** The references to render: what the list holds, with the staged edits over it. */
  art: Accessor<CardArtRefs>
  /**
   * Seed from a load body; call from `processLoadResponse`. `savedCardIds` are
   * the ids the loaded file holds — what separates a card the art route will
   * accept from one whose art has to wait for a save.
   */
  adopt: (
    slug: string | null,
    record: CardArtRecord | undefined,
    savedCardIds: Iterable<number>,
  ) => void
  /** Open the dialog for a context-menu card. A tile with no `&N` at all is ignored. */
  open: (target: CardContextInfo) => void
  /** Stage art for a card the session just added (`null` clears a reused id's). */
  stage: (cardId: number, art: CardArtRef | null) => void
  /** Drop what was staged for an id an undo handed back, revealing the list's own art. */
  reset: (cardId: number) => void
  /**
   * Write the staged art, now that the save's effects have told us the ids —
   * which is the *only* input needed: the ids the list holds afterwards follow
   * from what the save reported, and a set captured before it would reject
   * every line the save renumbered.
   *
   * Every write is attempted; failures are reported through the editor's error
   * banner ({@link attachStatus}) rather than dropped — the list saved, and the
   * art did not.
   */
  flush: (effects: readonly SaveEffect[]) => Promise<void>
  /**
   * Report art failures through the editor's status banner. Called once the
   * editor exists, which is after the config that owns {@link flush} was built.
   */
  attachStatus: (actions: EditorStatusActions) => void
}

/** One staged write that did not reach the sidecar, and why. */
type ArtWriteFailure = {
  cardId: number
  reason: string
}

export function useCardArt(type: ListType): UseCardArtResult {
  // The list as it is on disk, and the session's staged edits over it. Kept
  // apart so an undo can drop a staged edit and reveal what the file holds.
  const [baseline, setBaseline] = createSignal<CardArtRefs>(new Map())
  const [pending, setPending] = createSignal<ReadonlyMap<number, CardArtRef | null>>(new Map())
  const [slug, setSlug] = createSignal<string | null>(null)
  // Plain state, not a signal: nothing renders from it, and it is read inside
  // event handlers that must see the value the last save left.
  let savedIds: ReadonlySet<number> = new Set()
  let status: EditorStatusActions | null = null

  const art = createMemo<CardArtRefs>(() => artDisplayRefs(baseline(), pending()))

  const stagePending = (cardId: number, ref: CardArtRef | null): void => {
    const current = pending()
    // A clear with nothing to clear is not an edit: staging it would send the
    // save a write that changes nothing, for every card added without art. When
    // there is nothing staged for the id either, the table is already what it
    // should be — returning leaves the signal (and every tile reading it) alone.
    const clearsNothing = ref === null && !baseline().has(cardId)
    if (clearsNothing && !current.has(cardId)) return
    const next = new Map(current)
    if (clearsNothing) next.delete(cardId)
    else next.set(cardId, ref)
    setPending(next)
  }

  const writeNow = (cardId: number, ref: CardArtRef | null): void => {
    const next = new Map(baseline())
    if (ref === null) next.delete(cardId)
    else next.set(cardId, ref)
    setBaseline(next)
  }

  return {
    art,
    adopt: (loadedSlug, record, savedCardIds) => {
      setSlug(loadedSlug)
      setBaseline(cardArtRefsFrom(record))
      // A different list is on screen: anything staged belonged to the last one.
      setPending(new Map())
      savedIds = new Set(savedCardIds)
    },
    open: (target) => {
      // The tile's first copy: art is per card line, and a tile grouping
      // identical copies renders the first one's.
      const cardId = target.cardIds[0]
      const listSlug = slug()
      if (listSlug === null || cardId === undefined) return
      // A line the saved file does not have yet cannot be written to: the art
      // route refuses an id the list does not hold. The dialog says so and the
      // edit joins the staged ones instead.
      const staged = !savedIds.has(cardId)
      promptCardArt({
        listType: type,
        slug: listSlug,
        cardId,
        cardName: target.cardName,
        current: art().get(cardId) ?? null,
        staged,
        onSaved: (ref) => (staged ? stagePending(cardId, ref) : writeNow(cardId, ref)),
      })
    },
    stage: stagePending,
    reset: (cardId) => {
      const current = pending()
      if (!current.has(cardId)) return
      const next = new Map(current)
      next.delete(cardId)
      setPending(next)
    },
    flush: async (effects) => {
      const listSlug = slug()
      if (listSlug === null) return
      // The ids the list holds *after* this save, computed first: it is both the
      // liveness test the writes are filtered by and what the next save starts
      // from, and the two must be the same set — the pre-save ids would drop
      // exactly the renumbered lines the remap exists to follow.
      savedIds = savedCardIdsAfterSave(savedIds, effects)
      const writes = resolvePendingArt(pending(), effects, savedIds)
      // What the save itself did to the sidecar's keys is settled now; only the
      // art writes are still in flight.
      setBaseline(artAfterSave(baseline(), [], effects))

      const landed: PendingArt[] = []
      const failures: ArtWriteFailure[] = []
      for (const write of writes) {
        const result = await putCardArt(type, listSlug, write.cardId, write.art)
        if (result.ok) landed.push(write)
        else failures.push({ cardId: write.cardId, reason: result.message })
      }

      if (writes.length > 0) {
        batch(() => {
          // Only the entries this save resolved are retired: art staged while
          // the writes were in flight belongs to a card the *next* save will
          // file, and clearing the table wholesale would lose it. A resolved
          // entry goes either way — a failed write cannot be retried without a
          // save to re-report the id it is aimed at, and leaving it staged would
          // keep showing art the sidecar does not have.
          const next = new Map(pending())
          for (const write of writes) next.delete(write.stagedId)
          setPending(next)
          setBaseline(applyArtWrites(baseline(), landed))
        })
      }

      const first = failures[0]
      if (first !== undefined) {
        status?.setError(
          statusMessage('admin.art.pendingFailed', {
            count: failures.length,
            cardId: first.cardId,
            reason: first.reason,
          }),
        )
      }
    },
    attachStatus: (actions) => {
      status = actions
    },
  }
}
