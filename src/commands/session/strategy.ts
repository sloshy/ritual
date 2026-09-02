import type { ScryfallCard } from '../../scryfall/types'
import type { ChangeEvent, MoveToChange } from '../../changes/change-event'
import type { CardArtRef } from '../../list/card-art'
import type { SessionConfig } from './config'
import type { MenuChoice, MenuSentinel } from './menu'

/**
 * The contract between the card-entry session loop and the three list types:
 * the per-session context the engine owns and the {@link CardSessionStrategy}
 * each list type implements.
 */

// ── Session context & strategy ──────────────────────────────────────

/**
 * Whether the session is adding new cards (autocomplete over the card database)
 * or editing existing entries (autocomplete over the list's current entries).
 * Toggled from the session menu; orthogonal to the name/collector {@link EntryMode}.
 */
export type SessionMode = 'add' | 'edit'

/**
 * An existing list entry offered in the edit-mode picker. The engine treats
 * `cardId` as opaque and hands it straight back to
 * {@link CardSessionStrategy.editEntry} — a multi-list scope exploits that to
 * issue synthetic keys, since card ids are only unique within one list.
 */
export type EditableEntryItem = { label: string; cardId: number }

/** The most recently added/edited card, tracked for the menu shortcuts. */
export type LastAdded = { name: string; hasNote: boolean; cardId?: number }

/** The list file a session writes, and the display name recorded in its changelog. */
export type ListSaveTarget = { filePath: string; listName: string }

/** Mutable per-session state owned by the engine and shared with the strategy. */
export type CardSessionContext = {
  /** Change events accumulated for the session changelog. */
  sessionChanges: ChangeEvent[]
  /** Index into {@link sessionChanges} of the entry an edit would update in place. */
  lastChangeIndex: number | null
  lastAdded: LastAdded | null
  /** Consecutive copies of {@link lastAdded} added this streak. */
  lastAddedCount: number
  /**
   * Whether this session has already written a changelog block. Once true, later
   * saves merge into that block (one changelog entry per session) rather than
   * appending a new one. Never reset mid-session — only a new session clears it.
   */
  hasSavedChangelog: boolean
}

/** Create a fresh session context. Multi-list sessions own one per open list. */
export function createCardSessionContext(): CardSessionContext {
  return {
    sessionChanges: [],
    lastChangeIndex: null,
    lastAdded: null,
    lastAddedCount: 0,
    hasSavedChangelog: false,
  }
}

/**
 * A card added during the current session, for the Undo Last Add shortcut and
 * the session-changes list. `label` is the full rendered line shown in the
 * picker; `name` is the bare card name used in the "Undo Last Add" shortcut.
 */
export type SessionAddItem = {
  label: string
  name: string
  /**
   * The card id the add produced, when the line it produced is still in the
   * list. Absent once the line is gone (a later removal), which is what makes a
   * session-changes row un-editable.
   */
  cardId?: number
}

/**
 * One change made this session, as shown in the View Session Changes picker.
 * `blocked` carries the reason the change cannot be discarded right now (a
 * newer change touches the same card), or is undefined when it can be.
 */
export type SessionChangeItem = {
  label: string
  blocked?: string
  /**
   * The change's card is still in the list under the same name, so the review
   * screen can offer to edit it instead of only discarding the change. False for
   * a row whose card is gone (a removal, a completed move, a card whose `&N` was
   * reissued to a different card) and for a list's creation. Required rather
   * than optional: a strategy that forgot it would silently lose the whole edit
   * half of that screen.
   */
  editable: boolean
}

/**
 * What the View Session Changes screen can do to the card behind a change,
 * short of discarding it: open the list type's own per-entry action menu, or go
 * straight to the language picker.
 */
export type SessionChangeEditAction = 'details' | 'language'

/**
 * Why the engine is invoking {@link CardSessionStrategy.handleCard}:
 *
 * - `add` — a fresh add; a multi-list scope asks which list it should go to.
 * - `edit-last` — a re-entry of the last added card that replaces its options
 *   in place rather than adding a copy.
 * - `similar-copy` — a re-entry of the last added card to add a copy with
 *   different options.
 *
 * Both re-entry intents act on the list the last added card went into, so a
 * multi-list scope must route them there rather than asking for a destination.
 */
export type CardChoiceIntent = 'add' | 'edit-last' | 'similar-copy'

/** Input to {@link CardSessionStrategy.handleCard} once the engine has resolved a selection. */
export type CardChoiceInput = {
  cardName: string
  /** Printing preselected via collector mode, or null in name mode. */
  preselected: ScryfallCard | null
  /** Force the finish/condition prompts even when session defaults would apply. */
  forcePrompts: boolean
  intent: CardChoiceIntent
}

/**
 * The {@link CardChoiceInput} for the Add Similar Copy shortcut: re-enter the
 * add flow for the last added card with the prompts forced, so the user can
 * pick a different printing, finish, or condition (and, for a deck without a
 * pinned target section, a different section) for this copy.
 */
export function similarCopyInput(lastAdded: LastAdded): CardChoiceInput {
  return {
    cardName: lastAdded.name,
    preselected: null,
    forcePrompts: true,
    intent: 'similar-copy',
  }
}

/**
 * The list-type-specific half of a card-entry session. Implementations close
 * over their list model (deck structure or flat entry array + ID pool) and apply
 * every mutation as a {@link ChangeEvent} to the in-memory model. Nothing is
 * written to disk until the engine asks the strategy to {@link CardSessionStrategy.persist}
 * (the Save menu action or the save-and-exit choice in the exit menu); exiting
 * without saving instead discards the in-memory state.
 */
export type CardSessionStrategy = {
  /** Used in exit messages, e.g. `collection manager`. */
  managerLabel: string
  /**
   * Where {@link saveCardSession} writes this session, or null for a strategy
   * that spans several lists (a multi-list scope) and so has no file of its own —
   * such a session is saved one open list at a time, through each list's own
   * strategy.
   */
  saveTarget: ListSaveTarget | null
  sessionConfig: SessionConfig
  /** Extra menu entries inserted after the note shortcut in both modes. */
  extraMenuItems?: () => MenuChoice[]
  /** Handle a strategy-specific sentinel; any sentinel it does not recognize is ignored. */
  handleSentinel?: (ctx: CardSessionContext, value: MenuSentinel) => Promise<void>
  /** Re-prompt session filters and return the reloaded card-name list. */
  updateConfig: (excludeDigitalOnly: boolean) => Promise<string[]>
  /** Apply a change to the in-memory list model (not written to disk until {@link persist}). */
  applyChange: (change: ChangeEvent) => void
  /**
   * Receive the destination side of a cross-list move: add the moved card to
   * the in-memory model with a card id of this list's own (the event's cardId
   * is the *source* list's, kept for the changelog only). Called by the save
   * path when a saved list's `move-from` targets a list that is open in the
   * editor.
   *
   * `art` is the moved card's custom art in the source list, if it had any: the
   * strategy files it under the id it just allocated, so the art follows the
   * card the way it does on the on-disk move paths.
   */
  receiveMove: (change: MoveToChange, art?: CardArtRef) => void
  /** Write the in-memory list model to the list file. */
  persist: () => Promise<void>
  /** Whether the in-memory model differs from what was last written to disk. */
  hasUnsavedChanges: () => boolean
  /** Reset session-scoped tracking (session adds, undo stacks) after a mid-session save. */
  sessionSaved: () => void
  /** Run the full add/edit flow for a selected card. */
  handleCard: (ctx: CardSessionContext, input: CardChoiceInput) => Promise<void>
  /** Add another copy of the last added card. */
  addAnotherCopy: (ctx: CardSessionContext) => Promise<void>
  /** Notify the strategy that the engine applied a note to the last added card. */
  noteAdded?: (note: string) => void
  /** The cards added this session, in add order, for the Undo Last Add shortcut. */
  listSessionAdds?: () => SessionAddItem[]
  /** Discard the session add at `index` into {@link listSessionAdds}, re-packing ids. */
  discardSessionAdd?: (ctx: CardSessionContext, index: number) => Promise<void>
  /** Every change made this session (adds, edits, removals), for the View Session Changes picker. */
  listSessionChanges: () => SessionChangeItem[]
  /** Discard the session change at `index` into {@link listSessionChanges}. */
  discardSessionChange: (ctx: CardSessionContext, index: number) => Promise<void>
  /**
   * Run `action` on the card the session change at `index` targets. Addressed by
   * change index rather than card id so the id never has to leave the strategy
   * that owns it — a multi-list scope keys its pickers by synthetic ids, and a
   * raw card id is only unique within one list. A no-op when the row's card is
   * gone (`editable` false).
   */
  editSessionChange: (
    ctx: CardSessionContext,
    index: number,
    action: SessionChangeEditAction,
  ) => Promise<void>
  /**
   * The list itself was discarded (its creation was taken back from the session
   * changes), so there is nothing left to edit. The session loop leaves for the
   * list selection menu when this turns true.
   */
  discarded?: () => boolean
  /** The list's current entries, for the edit-mode picker. */
  listEntries: () => EditableEntryItem[]
  /** Run the edit flow (action menu and prompts) for the entry with `cardId`. */
  editEntry: (ctx: CardSessionContext, cardId: number) => Promise<void>
  /**
   * Run the language picker for the entry with `cardId`, skipping the action
   * menu. Drives the `🌐 Change Language` add-mode shortcut, whose `cardId`
   * comes from {@link CardSessionContext.lastAdded} — a real id in the list the
   * last card went into, never one of a scope's synthetic picker keys.
   */
  editEntryLanguage: (ctx: CardSessionContext, cardId: number) => Promise<void>
  /** Label for the Undo Last Edit menu item, or null when there is no edit to undo. */
  lastEditUndoLabel: () => string | null
  /** Undo the most recent edit-mode operation. */
  undoLastEdit: (ctx: CardSessionContext) => Promise<void>
}
