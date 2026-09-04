import { type Accessor, batch, createSignal, createMemo } from 'solid-js'
import type { Finish } from '../card/finish-condition'
import type { ChangeInput } from '../changes/change-event'
import {
  type CardTagChange,
  type ChangeEvent,
  type ConsolidateManyResult,
  type ConsolidateResult,
  type CardPrintingOptions,
  type PrintingTuple,
  type ListRef,
  type RemoveChange,
  createChangeId,
  areOppositeChanges,
  consolidateSetFinish,
  consolidateSetLabel,
  consolidateSetLanguage,
  consolidateSetPrinting,
  consolidateSetSection,
  consolidateSetCategories,
  consolidateTagEdits,
  isSetCategoriesFor,
} from '../changes/change-event'
import type { CardLabel } from '../card/card-labels'
import type { CardLanguage } from '../card/card-language'
import type { CardTag } from '../card/card-tags'
import { foldCategoryCardName, type CardCategory } from '../card/card-categories'

/**
 * What a "set the tags to …" gesture recorded: the per-tag events that became
 * pending, and the pending opposites it cancelled instead. Returned so the
 * caller can see exactly what the session now holds (the live data is updated
 * from the tag *delta*, which is the same whether an event was recorded or
 * cancelled a pending one).
 */
export type TagEditResult = Omit<ConsolidateManyResult<CardTagChange>, 'changes'>

/**
 * What an add (or the record of what a remove took away) may carry beyond the
 * printing: the line's label override and its tags. Both ride the
 * `add`/`remove` event itself so they land on the copy the change is about —
 * and so a remove and a re-add under different overrides or tags are not read
 * as opposites (see {@link RemoveChange.labels} and `areOppositeChanges`).
 */
export type AddCardOptions = CardPrintingOptions & {
  labels?: CardLabel[]
  tags?: CardTag[]
}

/**
 * What an {@link UseCardChangesResult.addCard} did.
 *
 * `cancelled` is not merely "no change was recorded": the pending removal it
 * annulled names, through its `cardId`, the line that therefore survives — the
 * only handle a caller has on the card the add actually landed on. Art picked
 * at add time belongs on *that* line (a re-add that specifies art is one of the
 * two ways art comes back after a removal), so the counterpart is surfaced
 * rather than folded into a bare `null`.
 */
export type AddCardResult =
  | { kind: 'added'; change: ChangeEvent }
  | { kind: 'cancelled'; cancelled: RemoveChange | null }

/**
 * Stores enough context to fully reverse a single user action.
 * - addedChange: the ChangeEvent that was pushed to the changes array (null if auto-cancelled)
 * - cancelledChange: a previously existing ChangeEvent removed by auto-cancel (null if none)
 * - removedCardData: full card data stored by the editor for removal undo restoration
 */
export type UndoEntry<T = unknown> = {
  addedChange: ChangeEvent | null
  cancelledChange: ChangeEvent | null
  removedCardData?: T
  /**
   * `set-categories` events folded out of the pending list because this
   * operation took the last line of their card's name — the web half of the
   * CLI's `FoldOptions.goneCardName` (`src/commands/session/edit-undo.ts`).
   * Restored verbatim when this entry is undone.
   */
  displacedChanges?: ChangeEvent[]
}

export type UndoResult<T = unknown> = {
  entry: UndoEntry<T>
  remainingChanges: ChangeEvent[]
}

export type UseCardChangesResult<T = unknown> = {
  changes: Accessor<ChangeEvent[]>
  changeCount: Accessor<number>
  addChange: (change: ChangeInput, removedCardData?: T) => ChangeEvent | null
  /** Replace the entire pending-change stack (e.g. when importing a change file). Clears undo history. */
  loadChanges: (changes: ChangeEvent[]) => void
  /**
   * Drop specific pending changes by id — the ones a replay could not apply.
   * Undo entries naming a dropped change go with it: the edit they would take
   * back is not in the data any more.
   */
  dropChanges: (changeIds: ReadonlySet<string>) => void
  discardAll: () => void
  canUndo: Accessor<boolean>
  undo: () => UndoResult<T> | null
  undoStack: Accessor<UndoEntry<T>[]>
  /**
   * Drop one copy. `labels` is the override the line being decremented carries,
   * recorded on the change so a re-add under a different override does not
   * cancel it (see {@link RemoveChange.labels}).
   */
  decrementCard: (
    cardName: string,
    cardId?: number,
    removedCardData?: T,
    labels?: CardLabel[],
    tags?: CardTag[],
  ) => void
  /**
   * Add a copy, optionally under a label override the new line starts with.
   *
   * Reports the recorded `add`, or the pending removal it cancelled instead
   * (see {@link areOppositeChanges}) — in which case the session leaves the line
   * exactly as the file has it, and a caller staging anything against the id it
   * allocated (custom art) must take that back and aim it at the surviving line
   * named by the cancelled removal.
   */
  addCard: (cardName: string, options?: AddCardOptions) => AddCardResult
  removeCard: (cardName: string, options?: AddCardOptions, removedCardData?: T) => void
  /** Record a move of a card out of this list into another list (`to`); its tags ride along. */
  moveCardToList: (
    cardName: string,
    to: ListRef,
    options?: AddCardOptions,
    removedCardData?: T,
  ) => void
  setFinish: (cardName: string, finish: Finish, originalFinish: Finish, cardId?: number) => void
  setPrinting: (
    cardName: string,
    target: PrintingTuple,
    original: PrintingTuple,
    cardId?: number,
  ) => void
  setSection: (cardName: string, section: string, originalSection: string, cardId?: number) => void
  /**
   * Set a card's language with "latest wins" semantics. `originalLanguage` is the
   * on-disk value (undefined for a bare line, which means `en`); restoring it
   * cancels the pending change, so undo lands back on the prior language.
   */
  setLanguage: (
    cardName: string,
    language: CardLanguage,
    originalLanguage: CardLanguage | undefined,
    cardId?: number,
  ) => void
  /** Set (or, with `[]`, clear) a collection card's label override — latest wins. */
  setLabel: (
    cardName: string,
    labels: CardLabel[],
    originalLabels: readonly CardLabel[] | undefined,
    cardId?: number,
  ) => void
  /**
   * Set a card's tags to exactly `tags`, recorded as one `add-tag` /
   * `remove-tag` event per tag that differs from `currentTags` — the card's
   * *live* tags, so a tag added earlier this session and removed now cancels
   * the pending add outright instead of stacking a remove on top of it.
   */
  setTags: (
    cardName: string,
    tags: readonly CardTag[],
    currentTags: readonly CardTag[] | undefined,
    cardId?: number,
  ) => TagEditResult
  /**
   * Set a card's categories to exactly `categories` — one whole-list,
   * latest-wins `set-categories` event with **no `cardId`** (categories are
   * keyed by card name and cover every line of it). `originalCategories` is the
   * on-disk value; restoring it cancels the pending change outright, exactly as
   * `setLabel` does. One undo entry, not one per category.
   */
  setCategories: (
    cardName: string,
    categories: CardCategory[],
    originalCategories: readonly CardCategory[] | undefined,
  ) => void
  /**
   * Fold the pending `set-categories` events for `cardName` out of the session,
   * attaching them to the undo entry the immediately preceding removal or move
   * pushed. Call it **directly after** the `remove` / `move-from` that took the
   * list's last line of that name; the events come back if that operation is
   * undone. A `set-categories` carries no `cardId`, so an id-keyed cancel can
   * never reach it — this is the web half of `FoldOptions.goneCardName`
   * (`src/commands/session/edit-undo.ts`), and the surviving-line test is the
   * caller's, exactly as it is in the CLI.
   */
  foldGoneCardCategories: (cardName: string) => void
}

export function useCardChanges<T = unknown>(): UseCardChangesResult<T> {
  const [changes, setChanges] = createSignal<ChangeEvent[]>([])
  const [undoStack, setUndoStack] = createSignal<UndoEntry<T>[]>([])
  let changesRef: ChangeEvent[] = []
  let undoStackRef: UndoEntry<T>[] = []

  /**
   * Record one change, cancelling a pending opposite instead when there is one,
   * and report both halves. `addChange` is the public half of this and keeps
   * returning only what was added; {@link addCard} needs the cancelled event
   * too, because its `cardId` is the line that survived.
   */
  function recordChange(partial: ChangeInput, removedCardData?: T): UndoEntry<T> {
    const newEvent = {
      ...partial,
      id: createChangeId(),
      timestamp: Date.now(),
    }

    let addedChange: ChangeEvent | null = newEvent
    let cancelledChange: ChangeEvent | null = null

    const oppositeIndex = changesRef.findIndex((existing) => areOppositeChanges(existing, newEvent))

    if (oppositeIndex !== -1) {
      cancelledChange = changesRef[oppositeIndex] ?? null
      addedChange = null
      changesRef = changesRef.filter((_, i) => i !== oppositeIndex)
    } else {
      changesRef = [...changesRef, newEvent]
    }

    const entry: UndoEntry<T> = { addedChange, cancelledChange, removedCardData }
    undoStackRef = [...undoStackRef, entry]

    // One update cycle rather than two: the card list and the undo button both
    // repaint from this, and every caller outside the add flow's own `batch`
    // would otherwise pay for a second pass.
    batch(() => {
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    })

    return entry
  }

  function addChange(partial: ChangeInput, removedCardData?: T): ChangeEvent | null {
    return recordChange(partial, removedCardData).addedChange
  }

  function loadChanges(loaded: ChangeEvent[]) {
    // Imported changes arrive as a curated event log; replace the stack wholesale
    // (no auto-cancel) and reset undo history, since the prior pending edits are gone.
    changesRef = [...loaded]
    undoStackRef = []
    setChanges([...changesRef])
    setUndoStack([])
  }

  function dropChanges(changeIds: ReadonlySet<string>) {
    if (changeIds.size === 0) return
    changesRef = changesRef.filter((change) => !changeIds.has(change.id))
    // Both sides: undoing an entry re-adds its `cancelledChange`, so an entry
    // naming a dropped change on either side would resurrect one the engine
    // refused.
    undoStackRef = undoStackRef
      .filter(
        (entry) =>
          (entry.addedChange === null || !changeIds.has(entry.addedChange.id)) &&
          (entry.cancelledChange === null || !changeIds.has(entry.cancelledChange.id)),
      )
      // A folded `set-categories` sits outside those two slots, so it would slip
      // past the filter and be re-added by `undo()`. An entry is never dropped
      // for its displaced half — the removal it belongs to is still undoable.
      .map((entry) => {
        if (entry.displacedChanges === undefined) return entry
        const kept = entry.displacedChanges.filter((change) => !changeIds.has(change.id))
        if (kept.length === entry.displacedChanges.length) return entry
        // An entry whose displaced events were all refused keeps no empty array:
        // "absent means none" is the shape every reader assumes.
        const { displacedChanges: _dropped, ...rest } = entry
        return kept.length > 0 ? { ...rest, displacedChanges: kept } : rest
      })
    // One update cycle, for the reason `recordChange` gives: the change list and
    // the undo button both repaint from this.
    batch(() => {
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    })
  }

  function discardAll() {
    changesRef = []
    undoStackRef = []
    setChanges([])
    setUndoStack([])
  }

  function undo(): UndoResult<T> | null {
    if (undoStackRef.length === 0) return null

    const entry = undoStackRef[undoStackRef.length - 1]!
    undoStackRef = undoStackRef.slice(0, -1)

    let next = changesRef
    if (entry.addedChange) {
      next = next.filter((c) => c.id !== entry.addedChange!.id)
    }
    if (entry.cancelledChange) {
      next = [...next, entry.cancelledChange]
    }
    if (entry.displacedChanges) {
      next = [...next, ...entry.displacedChanges]
    }
    changesRef = next

    setUndoStack([...undoStackRef])
    setChanges([...changesRef])

    return { entry, remainingChanges: changesRef }
  }

  function decrementCard(
    cardName: string,
    cardId?: number,
    removedCardData?: T,
    labels?: CardLabel[],
    tags?: CardTag[],
  ) {
    addChange({ action: 'remove', cardName, cardId, labels, tags }, removedCardData)
  }

  function addCard(cardName: string, options?: AddCardOptions): AddCardResult {
    const { addedChange, cancelledChange } = recordChange({ action: 'add', cardName, ...options })
    if (addedChange !== null) return { kind: 'added', change: addedChange }
    // Only a `remove` is ever the opposite of an `add` (see areOppositeChanges),
    // so the narrowing here can never actually discard a cancellation.
    const removed = cancelledChange?.action === 'remove' ? cancelledChange : null
    return { kind: 'cancelled', cancelled: removed }
  }

  function removeCard(cardName: string, options?: AddCardOptions, removedCardData?: T) {
    addChange({ action: 'remove', cardName, ...options }, removedCardData)
  }

  function moveCardToList(
    cardName: string,
    to: ListRef,
    options?: AddCardOptions,
    removedCardData?: T,
  ) {
    addChange({ action: 'move-from', cardName, ...options, to }, removedCardData)
  }

  /**
   * Commit a "latest wins" consolidation: adopt its change list and push one
   * undo entry, or record nothing at all when it was a no-op (neither an added
   * nor a cancelled change), so a true no-op leaves no undo step behind.
   */
  function commit(result: ConsolidateResult): void {
    const { changes: newChanges, addedChange, cancelledChange } = result
    if (addedChange === null && cancelledChange === null) return
    changesRef = newChanges
    undoStackRef = [...undoStackRef, { addedChange, cancelledChange }]
    setChanges([...changesRef])
    setUndoStack([...undoStackRef])
  }

  function setFinish(cardName: string, finish: Finish, originalFinish: Finish, cardId?: number) {
    commit(consolidateSetFinish(changesRef, cardName, finish, originalFinish, cardId))
  }

  function setPrinting(
    cardName: string,
    target: PrintingTuple,
    original: PrintingTuple,
    cardId?: number,
  ) {
    commit(consolidateSetPrinting(changesRef, cardName, target, original, cardId))
  }

  function setSection(cardName: string, section: string, originalSection: string, cardId?: number) {
    commit(consolidateSetSection(changesRef, cardName, section, originalSection, cardId))
  }

  function setLanguage(
    cardName: string,
    language: CardLanguage,
    originalLanguage: CardLanguage | undefined,
    cardId?: number,
  ) {
    commit(consolidateSetLanguage(changesRef, cardName, language, originalLanguage, cardId))
  }

  function setLabel(
    cardName: string,
    labels: CardLabel[],
    originalLabels: readonly CardLabel[] | undefined,
    cardId?: number,
  ) {
    commit(consolidateSetLabel(changesRef, cardName, labels, originalLabels, cardId))
  }

  function setCategories(
    cardName: string,
    categories: CardCategory[],
    originalCategories: readonly CardCategory[] | undefined,
  ) {
    commit(consolidateSetCategories(changesRef, cardName, categories, originalCategories))
  }

  function foldGoneCardCategories(cardName: string) {
    const key = foldCategoryCardName(cardName)
    const displaced: ChangeEvent[] = []
    const kept: ChangeEvent[] = []
    for (const change of changesRef) {
      if (isSetCategoriesFor(change, key)) {
        displaced.push(change)
      } else {
        kept.push(change)
      }
    }
    if (displaced.length === 0) return
    const last = undoStackRef[undoStackRef.length - 1]
    changesRef = kept
    // Nothing to attach to: the events still leave the session (the card is
    // gone), they simply cannot be restored by an undo that does not exist.
    undoStackRef =
      last === undefined
        ? undoStackRef
        : [
            ...undoStackRef.slice(0, -1),
            // Merged, not replaced: an entry restores everything folded onto it,
            // so a gesture that takes the last line of two names keeps both.
            { ...last, displacedChanges: [...(last.displacedChanges ?? []), ...displaced] },
          ]
    batch(() => {
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    })
  }

  function setTags(
    cardName: string,
    tags: readonly CardTag[],
    currentTags: readonly CardTag[] | undefined,
    cardId?: number,
  ): TagEditResult {
    const {
      changes: newChanges,
      addedChanges,
      cancelledChanges,
    } = consolidateTagEdits(changesRef, cardName, tags, currentTags, cardId)
    if (addedChanges.length === 0 && cancelledChanges.length === 0) {
      return { addedChanges, cancelledChanges }
    }
    // One undo entry per event, not one per gesture: `UndoEntry` holds a single
    // added *or* cancelled change, so a three-tag edit is three undo steps and
    // Undo reverts one tag at a time (the most recent first). The alternative —
    // widening `UndoEntry` to a list — would touch every consumer of the stack
    // (pool reconciliation, art reset, replay) for a dialog that usually
    // changes one tag.
    const entries: UndoEntry<T>[] = [
      ...addedChanges.map((addedChange) => ({ addedChange, cancelledChange: null })),
      ...cancelledChanges.map((cancelledChange) => ({ addedChange: null, cancelledChange })),
    ]
    changesRef = newChanges
    undoStackRef = [...undoStackRef, ...entries]
    setChanges([...changesRef])
    setUndoStack([...undoStackRef])
    return { addedChanges, cancelledChanges }
  }

  const changeCount = createMemo(() => changes().length)
  const canUndo = createMemo(() => undoStack().length > 0)

  return {
    changes,
    changeCount,
    addChange,
    loadChanges,
    dropChanges,
    discardAll,
    canUndo,
    undo,
    undoStack,
    decrementCard,
    addCard,
    removeCard,
    moveCardToList,
    setCategories,
    foldGoneCardCategories,
    setFinish,
    setPrinting,
    setSection,
    setLanguage,
    setLabel,
    setTags,
  }
}
