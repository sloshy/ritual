import type { Finish, Condition, ConditionUpdate } from '../card/finish-condition'
import type { Board } from '../list/deck'
import type { ListType } from '../list/list-type'
import { formatCardLabels, sameCardLabels, type CardLabel } from '../card/card-labels'
import {
  displayLanguage,
  languageDisplayName,
  languageToken,
  type CardLanguage,
} from '../card/card-language'

/**
 * A condition *update*: a grade to record, or `'NONE'` to clear a recorded
 * grade. `undefined` means "leave the entry's condition alone" — the engines
 * only touch condition when the field is defined — so clearing needs a value of
 * its own rather than an absence. Every apply path funnels the value through
 * {@link isCondition}, so `'NONE'` lands as an entry with no condition.
 */
export type { ConditionUpdate } from '../card/finish-condition'

// ── Discriminated union types ───────────────────────────────────────

/** Reference to a named list (deck, collection, or wanted list). */
export type ListRef = {
  type: ListType
  name: string
}

export type BaseChange = {
  id: string
  timestamp: number
  cardName: string
  cardId?: number
}

export type AddChange = BaseChange & {
  action: 'add'
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The added copy's language. Omitted means English (the bare-line default). */
  language?: CardLanguage
  /**
   * Label override the new card starts with, where the list type carries labels
   * (see {@link SetLabelChange}). Rides the add
   * event itself (rather than a follow-up set-label) so the label lands on the
   * added copy and never on a same-named existing entry. Not annotated in the
   * changelog text line.
   */
  labels?: CardLabel[]
  /** Deck board the card was added to. Omitted/`Main` renders without annotation. */
  board?: Board
  /** Section the card was added to. Defaults to `DEFAULT_SECTION` ("Main") when omitted. */
  section?: string
}

export type RemoveChange = BaseChange & {
  action: 'remove'
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The removed copy's language. Omitted means English (the bare-line default). */
  language?: CardLanguage
  /**
   * The label override the removed line carried, where the list type carries
   * labels. Recorded so {@link areOppositeChanges} can treat label state as part
   * of a card's identity: re-adding a `[proxy]` copy of a card that was removed
   * as a real one is not the removal undone, and must not cancel it. Like
   * {@link AddChange.labels} it is not annotated in the changelog text line, so a
   * surface that does not know a line's labels may leave it absent.
   */
  labels?: CardLabel[]
  /** Deck board the card was removed from. Omitted/`Main` renders without annotation. */
  board?: Board
}

export type SetCommanderChange = BaseChange & {
  action: 'set-commander'
}

export type UnsetCommanderChange = BaseChange & {
  action: 'unset-commander'
}

export type SetFinishChange = BaseChange & {
  action: 'set-finish'
  finish: Finish
}

export type SetPrintingChange = BaseChange & {
  action: 'set-printing'
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** A grade, or `'NONE'` to clear the recorded grade. */
  condition?: ConditionUpdate
  /**
   * The printing's language, when the change specifies one. An absent value
   * leaves the entry's language alone (unlike `finish`, which is rewritten
   * wholesale) — language changes have their own {@link SetLanguageChange}.
   */
  language?: CardLanguage
}

export type SetNoteChange = BaseChange & {
  action: 'set-note'
  /** The new note text. Empty string clears the note. */
  note: string
}

export type SetLanguageChange = BaseChange & {
  action: 'set-language'
  /** The new language. `en` clears the line's token (a bare line means English). */
  language: CardLanguage
}

/**
 * Applies wherever the list type carries labels — the whole vocabulary on a
 * collection, `proxy` alone on a deck, never on a wanted list (see
 * `LIST_TYPE_LABELS`). The write surfaces validate the set against the type;
 * the event itself just carries it.
 */
export type SetLabelChange = BaseChange & {
  action: 'set-label'
  /** The new label override. An empty array clears it (the list default applies again). */
  labels: CardLabel[]
}

export type MoveFromChange = BaseChange & {
  action: 'move-from'
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The moved copy's language. Omitted means English (the bare-line default). */
  language?: CardLanguage
  /** The list this card was moved to. */
  to: ListRef
}

export type MoveToChange = BaseChange & {
  action: 'move-to'
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The moved copy's language. Omitted means English (the bare-line default). */
  language?: CardLanguage
  /** The list this card was moved from. */
  from: ListRef
  /**
   * Destination section (decks; flat lists place the copy in that section).
   * Like `AddChange.section`: applied by the reducer when the copy lands,
   * never rendered in a changelog line.
   */
  section?: string
  /**
   * The SOURCE list's line id the copy was taken from. A removal hint for the
   * incoming-move writer (`applyCrossListMoves`); a name + printing match is
   * the fallback. `cardId` on an in-stack move-to is the destination's own line id.
   */
  sourceCardId?: number
  /**
   * The destination's own name-only line this copy PINS instead of adding a
   * copy to the list (the swap wizard setting a printing from a copy owned
   * elsewhere). Equal to `cardId`: the line is converted in place — it takes
   * the event's printing and keeps its `&N` and quantity (every copy of a deck
   * line's fill repeats the event, the later ones changing nothing). Different
   * from `cardId`: one copy is taken off that line (the line goes when empty)
   * and lands on `cardId` as an add would — a deck line filled partially or
   * from several printings. Never rendered in a changelog line.
   */
  replacesCardId?: number
  /**
   * A printing added to the SOURCE list in place of the copy taken — the swap
   * wizard's "replace taken copies" option. Applied by the incoming-move
   * writer (a plain `add` on the source, logged there); the destination's own
   * reducer ignores it.
   */
  replacement?: MoveReplacement
}

/** The printing a source list receives back for a copy a `move-to` took (see {@link MoveToChange.replacement}). */
export type MoveReplacement = {
  set: string
  collectorNumber: string
  finish?: Finish
  /** Omitted means English (the bare-line default). */
  language?: CardLanguage
}

/**
 * Base for section-structural changes. These target a section rather than a specific card,
 * so they intentionally carry no `cardName`/`cardId`.
 */
export type SectionMetaBase = {
  id: string
  timestamp: number
}

export type AddSectionChange = SectionMetaBase & {
  action: 'add-section'
  section: string
}

export type RemoveSectionChange = SectionMetaBase & {
  action: 'remove-section'
  section: string
}

export type RenameSectionChange = SectionMetaBase & {
  action: 'rename-section'
  /** The existing section name being renamed. */
  section: string
  /** The new name for the section. */
  newSection: string
}

/** Moves an existing card into a section. Keyed by card like the other per-card changes. */
export type SetSectionChange = BaseChange & {
  action: 'set-section'
  section: string
}

export type ChangeEvent =
  | AddChange
  | RemoveChange
  | SetCommanderChange
  | UnsetCommanderChange
  | SetFinishChange
  | SetPrintingChange
  | SetLanguageChange
  | SetNoteChange
  | SetLabelChange
  | MoveFromChange
  | MoveToChange
  | AddSectionChange
  | RemoveSectionChange
  | RenameSectionChange
  | SetSectionChange

/** Derived from the union — kept as a convenience alias for switch statements. */
export type ChangeAction = ChangeEvent['action']

/**
 * Every valid {@link ChangeAction}, as a runtime array for validation (e.g. when
 * parsing an imported change file). The `satisfies` check makes the compiler flag
 * this list if a new action variant is added to {@link ChangeEvent} but not here.
 */
export const CHANGE_ACTIONS = [
  'add',
  'remove',
  'set-commander',
  'unset-commander',
  'set-finish',
  'set-printing',
  'set-language',
  'set-note',
  'set-label',
  'move-from',
  'move-to',
  'add-section',
  'remove-section',
  'rename-section',
  'set-section',
] as const satisfies readonly ChangeAction[]

/**
 * The card-bearing subset of {@link ChangeEvent} — every variant except the section-structural
 * ones (add/remove/rename-section), which target a section rather than a card. Producers that
 * never emit section-meta changes (e.g. the file diff) use this so `.cardName` is always present.
 */
export type CardChange = Extract<ChangeEvent, { cardName: string }>

/** Distributes Omit over each member of a union, preserving discriminated-union structure. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** The subset of ChangeEvent fields that applyChange* functions need (no id/timestamp). */
export type ChangeInput = DistributiveOmit<ChangeEvent, 'id' | 'timestamp'>

/** Printing metadata shared by Card operations and API boundaries */
export type CardPrintingOptions = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  language?: CardLanguage
  cardId?: number
}

/** A {@link PrintingTuple} plus the optional card id: the input {@link printingOptionsFrom} projects. */
export type PrintingTupleWithId = PrintingTuple & { cardId?: number }

/**
 * Project a card entry's printing identity into {@link CardPrintingOptions} —
 * the required projection wherever an entry (or {@link PrintingTuple}) becomes
 * change-event options. Written as an explicit destructuring so a future
 * printing dimension (a new tuple field) is a compile-time change at this one
 * site rather than a silent drop at every open-coded call site.
 */
export function printingOptionsFrom(entry: PrintingTupleWithId): CardPrintingOptions {
  const { set, collectorNumber, finish, condition, language, cardId } = entry
  return { set, collectorNumber, finish, condition, language, cardId }
}

/**
 * {@link printingOptionsFrom} with the language *resolved*: a bare line's
 * absent language reads as `en` rather than staying undefined. This is the
 * projection an edit's "before" tuple needs — on a set-printing event an absent
 * language means "leave the token alone", which would let an undo keep a
 * language the forward edit had changed.
 */
export function resolvedPrintingOptionsFrom(entry: PrintingTupleWithId): CardPrintingOptions {
  return { ...printingOptionsFrom(entry), language: displayLanguage(entry.language) }
}

/** Create a unique ID for a change event */
export function createChangeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Options for add/remove actions. */
export type AddRemoveOptions = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The copy's language. Omitted means English (the bare-line default). */
  language?: CardLanguage
  /**
   * The copy's label override, where the type carries labels: what an `add`
   * starts the new card with, and what the line a `remove` takes away was
   * carrying (see {@link RemoveChange.labels}).
   */
  labels?: CardLabel[]
  cardId?: number
  /** Deck board the card was added to / removed from (e.g. `Sideboard`, `Maybeboard`). */
  board?: Board
  /** Section the card was added to (flat lists and decks). Only consumed by `add`. */
  section?: string
}

/** Options for set-commander / unset-commander actions. */
export type CommanderOptions = {
  cardId?: number
}

/** Options for set-finish action. */
export type SetFinishOptions = {
  finish: Finish
  cardId?: number
}

/** Options for set-printing action. An undefined set/collectorNumber means "no specific printing". */
export type SetPrintingOptions = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** A grade, or `'NONE'` to clear the recorded grade. */
  condition?: ConditionUpdate
  /** The printing's language, when the change specifies one (see {@link SetPrintingChange}). */
  language?: CardLanguage
  cardId?: number
}

/** The set/collector-number/finish/condition/language tuple that identifies a printing. */
export type PrintingTuple = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** Omitted means English (the bare-line default). */
  language?: CardLanguage
}

/**
 * Whether two printings are equivalent, normalizing absent values to their
 * defaults (no set/CN, `nonfoil` finish, `NM` condition, `en` language). Set
 * codes and collector numbers compare case-insensitively — a printing is
 * identified case-insensitively project-wide (`printingKey`), and `507A` and
 * `507a` are the same printing.
 */
export function isSamePrinting(a: PrintingTuple, b: PrintingTuple): boolean {
  return (
    (a.set?.toLowerCase() ?? '') === (b.set?.toLowerCase() ?? '') &&
    (a.collectorNumber?.toLowerCase() ?? '') === (b.collectorNumber?.toLowerCase() ?? '') &&
    (a.finish ?? 'nonfoil') === (b.finish ?? 'nonfoil') &&
    (a.condition ?? 'NM') === (b.condition ?? 'NM') &&
    displayLanguage(a.language) === displayLanguage(b.language)
  )
}

/** Options for set-language action. */
export type SetLanguageOptions = {
  language: CardLanguage
  cardId?: number
}

/** Options for set-note action. */
export type SetNoteOptions = {
  note: string
  cardId?: number
}

/** Options for set-label action. */
export type SetLabelOptions = {
  /** The new label override; an empty array clears it. */
  labels: CardLabel[]
  cardId?: number
}

/** Options for move-from action. */
export type MoveFromOptions = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The moved copy's language. Omitted means English (the bare-line default). */
  language?: CardLanguage
  cardId?: number
  to: ListRef
}

/** Options for move-to action. */
export type MoveToOptions = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The moved copy's language. Omitted means English (the bare-line default). */
  language?: CardLanguage
  cardId?: number
  from: ListRef
  /** Destination section (decks; flat lists place the copy in that section); see {@link MoveToChange.section}. */
  section?: string
  /** Source line id hint; see {@link MoveToChange.sourceCardId}. */
  sourceCardId?: number
  /** The destination line this copy pins; see {@link MoveToChange.replacesCardId}. */
  replacesCardId?: number
  /** The printing the source receives back; see {@link MoveToChange.replacement}. */
  replacement?: MoveReplacement
}

function makeBase(cardName: string, cardId?: number): BaseChange {
  return { id: createChangeId(), timestamp: Date.now(), cardName, cardId }
}

export function createAddChange(cardName: string, options?: AddRemoveOptions): AddChange {
  return {
    ...makeBase(cardName, options?.cardId),
    action: 'add',
    set: options?.set,
    collectorNumber: options?.collectorNumber,
    finish: options?.finish,
    condition: options?.condition,
    language: options?.language,
    labels: options?.labels,
    board: options?.board,
    section: options?.section,
  }
}

export function createRemoveChange(cardName: string, options?: AddRemoveOptions): RemoveChange {
  return {
    ...makeBase(cardName, options?.cardId),
    action: 'remove',
    set: options?.set,
    collectorNumber: options?.collectorNumber,
    finish: options?.finish,
    condition: options?.condition,
    language: options?.language,
    labels: options?.labels,
    board: options?.board,
  }
}

export function createSetCommanderChange(
  cardName: string,
  options?: CommanderOptions,
): SetCommanderChange {
  return { ...makeBase(cardName, options?.cardId), action: 'set-commander' }
}

export function createUnsetCommanderChange(
  cardName: string,
  options?: CommanderOptions,
): UnsetCommanderChange {
  return { ...makeBase(cardName, options?.cardId), action: 'unset-commander' }
}

export function createSetFinishChange(
  cardName: string,
  options: SetFinishOptions,
): SetFinishChange {
  return { ...makeBase(cardName, options.cardId), action: 'set-finish', finish: options.finish }
}

export function createSetPrintingChange(
  cardName: string,
  options: SetPrintingOptions,
): SetPrintingChange {
  return {
    ...makeBase(cardName, options.cardId),
    action: 'set-printing',
    set: options.set,
    collectorNumber: options.collectorNumber,
    finish: options.finish,
    condition: options.condition,
    language: options.language,
  }
}

export function createSetLanguageChange(
  cardName: string,
  options: SetLanguageOptions,
): SetLanguageChange {
  return {
    ...makeBase(cardName, options.cardId),
    action: 'set-language',
    language: options.language,
  }
}

export function createSetNoteChange(cardName: string, options: SetNoteOptions): SetNoteChange {
  return { ...makeBase(cardName, options.cardId), action: 'set-note', note: options.note }
}

export function createSetLabelChange(cardName: string, options: SetLabelOptions): SetLabelChange {
  return { ...makeBase(cardName, options.cardId), action: 'set-label', labels: options.labels }
}

export function createMoveFromChange(cardName: string, options: MoveFromOptions): MoveFromChange {
  return {
    ...makeBase(cardName, options.cardId),
    action: 'move-from',
    set: options.set,
    collectorNumber: options.collectorNumber,
    finish: options.finish,
    condition: options.condition,
    language: options.language,
    to: options.to,
  }
}

export function createMoveToChange(cardName: string, options: MoveToOptions): MoveToChange {
  return {
    ...makeBase(cardName, options.cardId),
    action: 'move-to',
    set: options.set,
    collectorNumber: options.collectorNumber,
    finish: options.finish,
    condition: options.condition,
    language: options.language,
    from: options.from,
    section: options.section,
    sourceCardId: options.sourceCardId,
    replacesCardId: options.replacesCardId,
    replacement: options.replacement,
  }
}

/**
 * The destination-side `move-to` a saved `move-from` implies. The one place
 * that decides what rides across a cross-list move — every commit path (the
 * editor saves' disk path, the unified editor's open-session path) must derive
 * the mirror event here, so the two halves can never drift apart. The ids
 * follow {@link MoveToChange}'s contract: the source line's id becomes
 * `sourceCardId`, and `cardId` is the DESTINATION line's own `&N` — passed as
 * `destCardId` once the destination has allocated (or merged onto) its line,
 * absent when the caller does not know it yet.
 */
export function mirrorMoveTo(
  move: MoveFromChange,
  from: ListRef,
  destCardId?: number,
): MoveToChange {
  const { cardId: sourceCardId, ...printing } = printingOptionsFrom(move)
  return createMoveToChange(move.cardName, { ...printing, cardId: destCardId, from, sourceCardId })
}

/** Whether two list refs name the same list (same type and name). */
export function sameListRef(a: ListRef, b: ListRef): boolean {
  return a.type === b.type && a.name === b.name
}

function makeSectionMetaBase(): SectionMetaBase {
  return { id: createChangeId(), timestamp: Date.now() }
}

export function createAddSectionChange(section: string): AddSectionChange {
  return { ...makeSectionMetaBase(), action: 'add-section', section }
}

export function createRemoveSectionChange(section: string): RemoveSectionChange {
  return { ...makeSectionMetaBase(), action: 'remove-section', section }
}

export function createRenameSectionChange(
  section: string,
  newSection: string,
): RenameSectionChange {
  return { ...makeSectionMetaBase(), action: 'rename-section', section, newSection }
}

export function createSetSectionChange(
  cardName: string,
  section: string,
  cardId?: number,
): SetSectionChange {
  return { ...makeBase(cardName, cardId), action: 'set-section', section }
}

/** Check if two change events are exact opposites that should cancel out */
export function areOppositeChanges(a: ChangeEvent, b: ChangeEvent): boolean {
  // add-section and remove-section cancel each other for the same section name
  if (
    (a.action === 'add-section' && b.action === 'remove-section') ||
    (a.action === 'remove-section' && b.action === 'add-section')
  ) {
    return a.section === b.section
  }

  // set-commander and unset-commander cancel each other for the same card
  if (
    (a.action === 'set-commander' && b.action === 'unset-commander') ||
    (a.action === 'unset-commander' && b.action === 'set-commander')
  ) {
    if (a.cardId !== undefined && b.cardId !== undefined && a.cardId !== b.cardId) return false
    return a.cardName === b.cardName
  }

  // Add/remove of the same card cancels out
  if (
    !(
      (a.action === 'add' && b.action === 'remove') ||
      (a.action === 'remove' && b.action === 'add')
    )
  ) {
    return false
  }

  // Narrow to add/remove variants for field access
  const ac = a
  const bc = b

  // Card name must match
  if (ac.cardName !== bc.cardName) return false

  // Card ID must match when both are present
  if (ac.cardId !== undefined && bc.cardId !== undefined && ac.cardId !== bc.cardId) return false

  // Printing must match (both undefined or both same, case-insensitive)
  if (ac.set?.toLowerCase() !== bc.set?.toLowerCase() || ac.collectorNumber !== bc.collectorNumber)
    return false

  // Finish must match
  if (ac.finish !== bc.finish) return false

  // Condition must match
  if (ac.condition !== bc.condition) return false

  // Language must match — an absent language means English, so a bare add and
  // an explicit [en] remove of the same card are still opposites.
  if (displayLanguage(ac.language) !== displayLanguage(bc.language)) return false

  // Board must match — an absent board means the default Main board, so a
  // Sideboard add and a Main remove of the same card are not opposites.
  if ((ac.board ?? 'Main') !== (bc.board ?? 'Main')) return false

  // Labels are part of the card's identity, not a decoration on it: cancelling a
  // removal against a re-add that lands the card under a different override
  // would silently keep the *old* line, override and all, and the re-add's
  // `[proxy]` (or its absence) would never reach the file. An absent override
  // and an empty one are the same thing, so a surface that carries no labels at
  // all still cancels exactly as it did before.
  if (!sameCardLabels(ac.labels, bc.labels)) return false

  return true
}

/** Result of a "latest wins" consolidation (set-finish / set-printing / set-note). */
export type ConsolidateResult = {
  changes: ChangeEvent[]
  addedChange: ChangeEvent | null
  cancelledChange: ChangeEvent | null
}

/** What one "latest wins" consolidation needs: which action to displace, whether the value actually changed, and how to build the new event. */
type LatestWinsSpec = {
  action: ChangeAction
  /** False when the new value equals the original — the pending change (if any) is dropped and nothing is added. */
  changed: boolean
  create: () => ChangeEvent
}

/**
 * The shared body of every `consolidateSet*` helper: remove any pending change
 * of `spec.action` for the same card (matching by cardId when both sides carry
 * one), then add the new event only when the value genuinely differs from the
 * original. The three-clause id matcher lives exactly once here.
 */
function consolidateLatestWins(
  changes: ChangeEvent[],
  cardName: string,
  cardId: number | undefined,
  spec: LatestWinsSpec,
): ConsolidateResult {
  const existingIdx = changes.findIndex(
    (c) =>
      c.action === spec.action &&
      'cardName' in c &&
      c.cardName === cardName &&
      (cardId === undefined || c.cardId === undefined || c.cardId === cardId),
  )
  const cancelledChange: ChangeEvent | null =
    existingIdx !== -1 ? (changes[existingIdx] ?? null) : null
  let updatedChanges = existingIdx !== -1 ? changes.filter((_, i) => i !== existingIdx) : changes

  let addedChange: ChangeEvent | null = null
  if (spec.changed) {
    addedChange = spec.create()
    updatedChanges = [...updatedChanges, addedChange]
  }

  return { changes: updatedChanges, addedChange, cancelledChange }
}

/**
 * Apply a set-finish action with "latest wins" semantics:
 * - Removes any existing set-finish for the same card from the changelog
 * - Does not add a new change if `finish` equals `originalFinish` (card restored to original state)
 * - Otherwise adds the new set-finish change
 *
 * Returns the updated changes array plus addedChange/cancelledChange for undo tracking.
 * Returns null addedChange and null cancelledChange when the action is a no-op.
 */
export function consolidateSetFinish(
  changes: ChangeEvent[],
  cardName: string,
  finish: Finish,
  originalFinish: Finish,
  cardId?: number,
): ConsolidateResult {
  return consolidateLatestWins(changes, cardName, cardId, {
    action: 'set-finish',
    changed: finish !== originalFinish,
    create: () => createSetFinishChange(cardName, { finish, cardId }),
  })
}

/**
 * Apply a set-printing action with "latest wins" semantics, mirroring
 * {@link consolidateSetFinish}:
 * - Removes any existing set-printing for the same card from the changelog
 * - Does not add a new change if `target` equals `original` (printing restored)
 * - Otherwise adds the new set-printing change
 *
 * Returns the updated changes array plus addedChange/cancelledChange for undo
 * tracking. Returns null addedChange and null cancelledChange when the action is
 * a no-op.
 */
export function consolidateSetPrinting(
  changes: ChangeEvent[],
  cardName: string,
  target: PrintingTuple,
  original: PrintingTuple,
  cardId?: number,
): ConsolidateResult {
  return consolidateLatestWins(changes, cardName, cardId, {
    action: 'set-printing',
    changed: !isSamePrinting(target, original),
    create: () => createSetPrintingChange(cardName, { ...target, cardId }),
  })
}

/**
 * Apply a set-language action with "latest wins" semantics, mirroring
 * {@link consolidateSetFinish}:
 * - Removes any existing set-language for the same card from the changelog
 * - Does not add a new change if `language` equals `originalLanguage` (card
 *   restored to its original language; both sides fold missing to `en`)
 * - Otherwise adds the new set-language change
 *
 * Returns the updated changes array plus addedChange/cancelledChange for undo
 * tracking. Returns null addedChange and null cancelledChange when the action
 * is a no-op.
 */
export function consolidateSetLanguage(
  changes: ChangeEvent[],
  cardName: string,
  language: CardLanguage,
  originalLanguage: CardLanguage | undefined,
  cardId?: number,
): ConsolidateResult {
  return consolidateLatestWins(changes, cardName, cardId, {
    action: 'set-language',
    changed: displayLanguage(language) !== displayLanguage(originalLanguage),
    create: () => createSetLanguageChange(cardName, { language, cardId }),
  })
}

/**
 * Apply a set-note action with "latest wins" semantics:
 * - Removes any existing set-note for the same card from the changelog
 * - Does not add a new change if `note` equals `originalNote` (note restored to original)
 * - Otherwise adds the new set-note change (an empty `note` clears the field)
 *
 * Returns the updated changes array plus addedChange/cancelledChange for undo tracking.
 * Returns null addedChange and null cancelledChange when the action is a no-op.
 */
export function consolidateSetNote(
  changes: ChangeEvent[],
  cardName: string,
  note: string,
  originalNote: string,
  cardId?: number,
): ConsolidateResult {
  return consolidateLatestWins(changes, cardName, cardId, {
    action: 'set-note',
    changed: note !== originalNote,
    create: () => createSetNoteChange(cardName, { note, cardId }),
  })
}

/**
 * Apply a set-label action with "latest wins" semantics, mirroring
 * {@link consolidateSetNote}:
 * - Removes any existing set-label for the same card from the changelog
 * - Does not add a new change if `labels` equals `originalLabels` (override restored)
 * - Otherwise adds the new set-label change (an empty `labels` clears the override)
 *
 * Label sets compare by their canonical serialized form, so `['trade','sale']`
 * and `['sale','trade']` are the same override.
 */
export function consolidateSetLabel(
  changes: ChangeEvent[],
  cardName: string,
  labels: CardLabel[],
  originalLabels: readonly CardLabel[] | undefined,
  cardId?: number,
): ConsolidateResult {
  return consolidateLatestWins(changes, cardName, cardId, {
    action: 'set-label',
    changed: !sameCardLabels(labels, originalLabels),
    create: () => createSetLabelChange(cardName, { labels, cardId }),
  })
}

/**
 * Apply a set-section action (move a card to a section) with "latest wins" semantics,
 * mirroring {@link consolidateSetFinish}:
 * - Removes any existing set-section for the same card from the changelog
 * - Does not add a new change if `section` equals `originalSection` (card restored to its section)
 * - Otherwise adds the new set-section change
 */
export function consolidateSetSection(
  changes: ChangeEvent[],
  cardName: string,
  section: string,
  originalSection: string,
  cardId?: number,
): ConsolidateResult {
  return consolidateLatestWins(changes, cardName, cardId, {
    action: 'set-section',
    changed: section !== originalSection,
    create: () => createSetSectionChange(cardName, section, cardId),
  })
}

/**
 * Replay the section-structural changes (add/remove/rename-section) over an original section
 * order to derive the current order. Card-level changes are ignored. Because this is a pure
 * function of the original order plus the live change list, the result stays correct across
 * undo without any separate reconciliation — the same way card data is replayed from `original`.
 */
export function replaySectionOrder(originalOrder: string[], changes: ChangeEvent[]): string[] {
  let order = [...originalOrder]
  for (const c of changes) {
    if (c.action === 'add-section') {
      if (!order.includes(c.section)) order.push(c.section)
    } else if (c.action === 'remove-section') {
      order = order.filter((s) => s !== c.section)
    } else if (c.action === 'rename-section') {
      order = order.map((s) => (s === c.section ? c.newSection : s))
    }
  }
  return order
}

/**
 * Whether each action reads as a gain (green/+) or a loss (red/−) in the
 * change lists. `unset-commander`, `remove-section` and `move-from` are
 * destructive like `remove`; a `move-to` lands a copy here, so it is a gain.
 * The `satisfies` makes a new {@link ChangeAction} a compile error until it
 * has a row.
 */
const ADDITIVE_ACTIONS = {
  add: true,
  remove: false,
  'set-commander': true,
  'unset-commander': false,
  'set-finish': true,
  'set-printing': true,
  'set-language': true,
  'set-note': true,
  'set-label': true,
  'move-from': false,
  'move-to': true,
  'add-section': true,
  'remove-section': false,
  'rename-section': true,
  'set-section': true,
} as const satisfies Record<ChangeAction, boolean>

/** Check if a change is additive (green) or destructive (red) */
export function isAdditiveChange(action: ChangeAction): boolean {
  return ADDITIVE_ACTIONS[action]
}

/**
 * The loosely-typed printing fields the annotation formatters read. Deliberately
 * `string` rather than the `Finish` / `Condition` / `CardLanguage` unions: the
 * same annotation has to be rendered from a {@link ChangeEvent} (typed) and from
 * a `ChangelogChange` parsed back out of `.changes.md` (loose strings). One
 * widened parameter is what lets both go through this single implementation
 * instead of the mirrored copy `src/site/changelog-format.ts` used to carry.
 */
export type PrintingAnnotationInput = {
  set?: string
  collectorNumber?: string
  finish?: string
  condition?: string
  language?: string
}

/**
 * Format the ` [finish] [condition] [lang]` suffix shared by printing
 * annotations and the set-printing description. Empty when all three are at
 * their defaults (`nonfoil` / `NM` / `en`) — the same tokens a card line omits.
 */
export function formatFinishConditionTail(
  finish?: string,
  condition?: string,
  language?: string,
): string {
  const finishInfo = finish && finish !== 'nonfoil' ? ` [${finish}]` : ''
  // `NONE` clears the grade and `NM` is the unrecorded default: neither is
  // annotated, so the changelog line reads exactly like the line it produced.
  const conditionInfo =
    condition && condition !== 'NM' && condition !== 'NONE' ? ` [${condition}]` : ''
  // English is the bare-line default and is never annotated, like the card line.
  const languageInfo = languageToken(language)
  return `${finishInfo}${conditionInfo}${languageInfo}`
}

/**
 * Format the ` (SET:CN) [finish] [condition] [lang]` annotation tail used in
 * changelog lines and entry descriptions. Empty when none of the fields are set.
 */
export function formatPrintingAnnotation(change: PrintingAnnotationInput): string {
  const printingInfo =
    change.set && change.collectorNumber
      ? ` (${change.set.toUpperCase()}:${change.collectorNumber})`
      : ''
  return `${printingInfo}${formatFinishConditionTail(change.finish, change.condition, change.language)}`
}

/**
 * Format the ` {preposition} {Board}` suffix used in add/remove changelog lines
 * and entry descriptions. Empty for the default main board (or when unspecified),
 * so an ordinary deck change still reads `Added Lightning Bolt`, while a sideboard
 * or maybeboard change reads `Added Lightning Bolt to Sideboard` (adds) or
 * `Removed Lightning Bolt from Sideboard` (removes).
 */
export function formatBoardAnnotation(
  board: Board | undefined,
  preposition: 'to' | 'from',
): string {
  if (!board || board === 'Main') return ''
  return ` ${preposition} ${board}`
}

type FormatChangeOptions = {
  tense: 'present' | 'past'
  /**
   * Wrap the card name in double quotes (e.g. `Added "Lightning Bolt" to Sideboard`).
   * Used by the changelog writer so persisted lines have an unambiguous boundary
   * between the card name and trailing annotations like ` to Sideboard`. Display
   * formatters leave this off.
   */
  quoteCardName?: boolean
}

/**
 * Serialize a change event as a `.changes.md` line body. **Persistence only —
 * English by contract. This function must never be localized, and this module
 * must never import `src/i18n`** (asserted by the persistence-fence scan in
 * `test/unit/i18n-conventions.test.ts`).
 *
 * The bytes it produces are a data format, not prose:
 *
 * - `changelog-parser.ts` re-reads them with regexes anchored on the English
 *   verbs (`Added` / `Removed` / `Set` / `Unset`) and on the English language
 *   names from `LANGUAGE_PARSE_NAMES`. A translated line parses to *zero*
 *   changes and renders an empty history **with no error** — silent data loss.
 * - `.sha256` sidecars hash the exact bytes, so a locale-dependent line would
 *   make `detect-changes` report spurious edits on a machine with a different
 *   `LANG`.
 * - The files are git-diffable and shared between collaborators whose UI
 *   locales need not agree.
 *
 * Display is a separate concern with a separate implementation: `changeMessage`
 * in `src/change-message.ts` is the **single** renderer for every user-facing
 * surface (CLI, public site, admin). Do not add a display caller here.
 */
export function formatChangeCore(change: ChangeEvent, opts: FormatChangeOptions): string {
  const { tense } = opts
  // Section-meta changes (add/remove/rename-section) carry no card, so guard the reads.
  const cardId = 'cardId' in change ? change.cardId : undefined
  const cardName = 'cardName' in change ? change.cardName : ''
  const idInfo = cardId !== undefined ? ` &${cardId}` : ''
  const name = opts.quoteCardName ? `"${cardName}"` : cardName

  switch (change.action) {
    case 'add':
    case 'remove': {
      const ann = formatPrintingAnnotation(change)
      const boardInfo = formatBoardAnnotation(change.board, change.action === 'add' ? 'to' : 'from')
      const verb =
        change.action === 'add'
          ? tense === 'past'
            ? 'Added'
            : 'Add'
          : tense === 'past'
            ? 'Removed'
            : 'Remove'
      return `${verb} ${name}${ann}${boardInfo}${idInfo}`
    }
    case 'set-commander':
      return `Set ${name} as commander${idInfo}`
    case 'unset-commander':
      return `Unset ${name} as commander${idInfo}`
    case 'set-finish':
      return `Set ${name} finish to ${change.finish}${idInfo}`
    case 'set-printing': {
      const printingDesc =
        change.set && change.collectorNumber
          ? `${change.set.toUpperCase()}:${change.collectorNumber}${formatFinishConditionTail(change.finish, change.condition, change.language)}`
          : 'no specific printing'
      return `Set ${name} printing to ${printingDesc}${idInfo}`
    }
    case 'set-language':
      return `Set language of ${name} to ${languageDisplayName(change.language)}${idInfo}`
    case 'set-note': {
      if (change.note === '') {
        const clearVerb = tense === 'past' ? 'Cleared' : 'Clear'
        return `${clearVerb} note on ${name}${idInfo}`
      }
      return `Set note on ${name}${idInfo} to "${change.note}"`
    }
    case 'set-label': {
      if (change.labels.length === 0) {
        const clearVerb = tense === 'past' ? 'Cleared' : 'Clear'
        return `${clearVerb} labels on ${name}${idInfo}`
      }
      return `Set labels on ${name}${idInfo} to [${formatCardLabels(change.labels)}]`
    }
    case 'move-from': {
      const ann = formatPrintingAnnotation(change)
      const verb = tense === 'past' ? 'Moved' : 'Move'
      return `${verb} ${name}${ann}${idInfo} to ${listRefLabel(change.to)}`
    }
    case 'move-to': {
      const ann = formatPrintingAnnotation(change)
      const verb = tense === 'past' ? 'Moved' : 'Move'
      return `${verb} ${name}${ann}${idInfo} from ${listRefLabel(change.from)}`
    }
    case 'add-section':
      return `${tense === 'past' ? 'Added' : 'Add'} section "${change.section}"`
    case 'remove-section':
      return `${tense === 'past' ? 'Removed' : 'Remove'} section "${change.section}"`
    case 'rename-section':
      return `${tense === 'past' ? 'Renamed' : 'Rename'} section "${change.section}" to "${change.newSection}"`
    case 'set-section':
      return `${tense === 'past' ? 'Moved' : 'Move'} ${name} to section "${change.section}"${idInfo}`
    default: {
      change satisfies never
      throw new Error(`Unhandled change action (this is a bug)`)
    }
  }
}

/**
 * Name a list the way a changelog line names it (`Deck 'Standard Burn'`).
 *
 * English by contract for the same reason as {@link formatChangeCore}: it is
 * spliced into persisted `Moved "X" to Deck 'Y'` lines.
 */
export function listRefLabel(ref: ListRef): string {
  if (ref.type === 'deck') return `Deck '${ref.name}'`
  if (ref.type === 'collection') return `Collection '${ref.name}'`
  return `Wanted list '${ref.name}'`
}
