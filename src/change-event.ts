import type { Finish, Condition, Board } from './types'
import type { ListType } from './list-type'
import { formatCardLabels, sameCardLabels, type CardLabel } from './card-labels'

/**
 * A condition *update*: a grade to record, or `'NONE'` to clear a recorded
 * grade. `undefined` means "leave the entry's condition alone" — the engines
 * only touch condition when the field is defined — so clearing needs a value of
 * its own rather than an absence. Every apply path funnels the value through
 * {@link isCondition}, so `'NONE'` lands as an entry with no condition.
 */
export type ConditionUpdate = Condition | 'NONE'

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
  /**
   * Label override the new card starts with — collections only. Rides the add
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
}

export type SetNoteChange = BaseChange & {
  action: 'set-note'
  /** The new note text. Empty string clears the note. */
  note: string
}

/** Collections only — deck and wanted entries carry no labels. */
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
  /** The list this card was moved to. */
  to: ListRef
}

export type MoveToChange = BaseChange & {
  action: 'move-to'
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The list this card was moved from. */
  from: ListRef
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
  cardId?: number
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
  /** Label override for the new card (collections only). Only consumed by `add`. */
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
  cardId?: number
}

/** The set/collector-number/finish/condition tuple that identifies a printing. */
export type PrintingTuple = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
}

/**
 * Whether two printings are equivalent, normalizing absent values to their
 * defaults (no set/CN, `nonfoil` finish, `NM` condition). Set codes compare
 * case-insensitively.
 */
export function isSamePrinting(a: PrintingTuple, b: PrintingTuple): boolean {
  return (
    (a.set?.toLowerCase() ?? '') === (b.set?.toLowerCase() ?? '') &&
    (a.collectorNumber ?? '') === (b.collectorNumber ?? '') &&
    (a.finish ?? 'nonfoil') === (b.finish ?? 'nonfoil') &&
    (a.condition ?? 'NM') === (b.condition ?? 'NM')
  )
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
  cardId?: number
  to: ListRef
}

/** Options for move-to action. */
export type MoveToOptions = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  cardId?: number
  from: ListRef
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
    from: options.from,
  }
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

  // Board must match — an absent board means the default Main board, so a
  // Sideboard add and a Main remove of the same card are not opposites.
  if ((ac.board ?? 'Main') !== (bc.board ?? 'Main')) return false

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

/** Check if a change is additive (green) or destructive (red) */
export function isAdditiveChange(action: ChangeAction): boolean {
  return (
    action === 'add' ||
    action === 'set-commander' ||
    action === 'set-finish' ||
    action === 'set-printing' ||
    action === 'set-note' ||
    action === 'set-label' ||
    action === 'add-section' ||
    action === 'rename-section' ||
    action === 'set-section'
  )
  // unset-commander and remove-section are treated as destructive (red) like remove
}

/**
 * Format the ` [finish] [condition]` suffix shared by printing annotations and
 * the set-printing description. Empty when both are at their defaults
 * (`nonfoil` / `NM`).
 */
export function formatFinishConditionTail(finish?: Finish, condition?: ConditionUpdate): string {
  const finishInfo = finish && finish !== 'nonfoil' ? ` [${finish}]` : ''
  // `NONE` clears the grade and `NM` is the unrecorded default: neither is
  // annotated, so the changelog line reads exactly like the line it produced.
  const conditionInfo =
    condition && condition !== 'NM' && condition !== 'NONE' ? ` [${condition}]` : ''
  return `${finishInfo}${conditionInfo}`
}

/**
 * Format the ` (SET:CN) [finish] [condition]` annotation tail used in changelog
 * lines and entry descriptions. Empty when none of the fields are set.
 */
export function formatPrintingAnnotation(change: PrintingTuple): string {
  const printingInfo =
    change.set && change.collectorNumber
      ? ` (${change.set.toUpperCase()}:${change.collectorNumber})`
      : ''
  return `${printingInfo}${formatFinishConditionTail(change.finish, change.condition)}`
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

/** Format a change event as a human-readable description, shared by formatChange and changelog writer */
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
          ? `${change.set.toUpperCase()}:${change.collectorNumber}${formatFinishConditionTail(change.finish, change.condition)}`
          : 'no specific printing'
      return `Set ${name} printing to ${printingDesc}${idInfo}`
    }
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

/** Format a change event as a human-readable description */
export function formatChange(change: ChangeEvent): string {
  return formatChangeCore(change, { tense: 'present' })
}

export function listRefLabel(ref: ListRef): string {
  if (ref.type === 'deck') return `Deck '${ref.name}'`
  if (ref.type === 'collection') return `Collection '${ref.name}'`
  return `Wanted list '${ref.name}'`
}
