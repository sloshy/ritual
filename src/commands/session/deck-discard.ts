import type { DeckData } from '../../list/deck'
import {
  createRemoveChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../../changes/change-event'
import { repackSessionIds } from '../../card/card-id'
import { applyChangeToDeck } from '../../changes/deck-changes'
import { findCardById } from '../../list/deck-io'
import type { SessionAddItem } from './strategy'

// ── Discarding session adds ─────────────────────────────────────────

/** One copy added to the deck this session, tracked for the Undo Last Add and session-changes pickers. */
export type DeckCopyRecord = {
  cardId: number
  name: string
  printing: PrintingTuple
  section: string
}

/** Render a session copy record for the Undo Last Add and session-changes pickers. */
export function renderDeckCopyRecord(record: DeckCopyRecord): SessionAddItem {
  const printingInfo = record.printing.set
    ? ` (${record.printing.set.toUpperCase()}:${record.printing.collectorNumber})`
    : ''
  return {
    label: `${record.name}${printingInfo} → ${record.section}`,
    name: record.name,
    cardId: record.cardId,
  }
}

/** The mutable session state a discard transforms. */
export type DeckDiscardState = {
  deck: DeckData
  sessionChanges: ChangeEvent[]
  /** Per-copy adds this session, in add order. */
  sessionAdds: DeckCopyRecord[]
  /** Distinct line ids first created this session, for re-pack on full removal. */
  sessionLineIds: number[]
}

/** A successful discard's next state, plus the copy that was removed. */
export type DeckDiscardOutcome = DeckDiscardState & {
  discarded: DeckCopyRecord
  /**
   * Old id → new id for the lines the re-pack renumbered, empty when it did not
   * run. Reported rather than kept private because the deck is not the only
   * thing keyed by these ids: the session's pending custom art is too, and it
   * has to follow them.
   */
  remap: ReadonlyMap<number, number>
  /** Whether the discard took the line out entirely (rather than a copy off it). */
  lineRemoved: boolean
}

/**
 * Discard the session copy at `index` (into {@link DeckDiscardState.sessionAdds}):
 * decrement that line (dropping it at quantity 0), drop one matching add event (or the
 * line's whole changelog footprint when it's fully removed), and — only when a
 * session-created line is fully removed — re-pack the surviving session line ids so
 * they stay dense, freeing the highest. Pure: returns the next state, or null when the
 * index is out of range. Pre-existing (non-session) cards and their ids are untouched.
 */
export function discardDeckCopy(state: DeckDiscardState, index: number): DeckDiscardOutcome | null {
  const record = state.sessionAdds[index]
  if (!record) return null
  const { cardId } = record

  // Remove one copy: applyChangeToDeck deep-clones, so the result is safe to mutate.
  const deck = applyChangeToDeck(
    state.deck,
    createRemoveChange(record.name, { cardId, section: record.section }),
  )
  const sessionAdds = state.sessionAdds.filter((_, i) => i !== index)
  const lineRemoved = findCardById(deck, cardId) === null

  // A surviving line keeps its id, so only one add event for it is dropped; a fully
  // removed line takes its whole changelog footprint with it.
  let sessionChanges: ChangeEvent[]
  if (lineRemoved) {
    sessionChanges = state.sessionChanges.filter((c) => !('cardId' in c) || c.cardId !== cardId)
  } else {
    sessionChanges = [...state.sessionChanges]
    const lastAddIdx = sessionChanges.findLastIndex(
      (c) => c.action === 'add' && c.cardId === cardId,
    )
    if (lastAddIdx !== -1) sessionChanges.splice(lastAddIdx, 1)
  }

  let sessionLineIds = state.sessionLineIds
  let repacked: ReadonlyMap<number, number> = new Map()
  if (lineRemoved && sessionLineIds.includes(cardId)) {
    const survivors = sessionLineIds.filter((id) => id !== cardId)
    const { remap } = repackSessionIds(sessionLineIds, survivors)
    repacked = remap
    for (const section of deck.sections) {
      for (const card of section.cards) {
        if (card.cardId !== undefined && remap.has(card.cardId)) {
          card.cardId = remap.get(card.cardId)!
        }
      }
    }
    for (const c of sessionChanges) {
      if ('cardId' in c && c.cardId !== undefined && remap.has(c.cardId)) {
        c.cardId = remap.get(c.cardId)!
      }
    }
    for (const rec of sessionAdds) {
      if (remap.has(rec.cardId)) rec.cardId = remap.get(rec.cardId)!
    }
    sessionLineIds = survivors.map((id) => remap.get(id) ?? id)
  }

  return {
    deck,
    sessionChanges,
    sessionAdds,
    sessionLineIds,
    discarded: record,
    remap: repacked,
    lineRemoved,
  }
}
