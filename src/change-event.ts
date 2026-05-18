import type { Finish, Condition } from './types'
import type { ListType } from './list-type'

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
}

export type RemoveChange = BaseChange & {
  action: 'remove'
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
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

export type SetNoteChange = BaseChange & {
  action: 'set-note'
  /** The new note text. Empty string clears the note. */
  note: string
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

export type ChangeEvent =
  | AddChange
  | RemoveChange
  | SetCommanderChange
  | UnsetCommanderChange
  | SetFinishChange
  | SetNoteChange
  | MoveFromChange
  | MoveToChange

/** Derived from the union — kept as a convenience alias for switch statements. */
export type ChangeAction = ChangeEvent['action']

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
  cardId?: number
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

/** Options for set-note action. */
export type SetNoteOptions = {
  note: string
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

export function createSetNoteChange(cardName: string, options: SetNoteOptions): SetNoteChange {
  return { ...makeBase(cardName, options.cardId), action: 'set-note', note: options.note }
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

/** Check if two change events are exact opposites that should cancel out */
export function areOppositeChanges(a: ChangeEvent, b: ChangeEvent): boolean {
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

  return true
}

export type ConsolidateSetFinishResult = {
  changes: ChangeEvent[]
  addedChange: ChangeEvent | null
  cancelledChange: ChangeEvent | null
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
): ConsolidateSetFinishResult {
  const existingIdx = changes.findIndex(
    (c) =>
      c.action === 'set-finish' &&
      c.cardName === cardName &&
      (cardId === undefined || c.cardId === undefined || c.cardId === cardId),
  )
  const cancelledChange: ChangeEvent | null =
    existingIdx !== -1 ? (changes[existingIdx] ?? null) : null
  let updatedChanges = existingIdx !== -1 ? changes.filter((_, i) => i !== existingIdx) : changes

  let addedChange: ChangeEvent | null = null
  if (finish !== originalFinish) {
    addedChange = createSetFinishChange(cardName, { finish, cardId })
    updatedChanges = [...updatedChanges, addedChange]
  }

  return { changes: updatedChanges, addedChange, cancelledChange }
}

export type ConsolidateSetNoteResult = {
  changes: ChangeEvent[]
  addedChange: ChangeEvent | null
  cancelledChange: ChangeEvent | null
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
): ConsolidateSetNoteResult {
  const existingIdx = changes.findIndex(
    (c) =>
      c.action === 'set-note' &&
      c.cardName === cardName &&
      (cardId === undefined || c.cardId === undefined || c.cardId === cardId),
  )
  const cancelledChange: ChangeEvent | null =
    existingIdx !== -1 ? (changes[existingIdx] ?? null) : null
  let updatedChanges = existingIdx !== -1 ? changes.filter((_, i) => i !== existingIdx) : changes

  let addedChange: ChangeEvent | null = null
  if (note !== originalNote) {
    addedChange = createSetNoteChange(cardName, { note, cardId })
    updatedChanges = [...updatedChanges, addedChange]
  }

  return { changes: updatedChanges, addedChange, cancelledChange }
}

/** Check if a change is additive (green) or destructive (red) */
export function isAdditiveChange(action: ChangeAction): boolean {
  return (
    action === 'add' ||
    action === 'set-commander' ||
    action === 'set-finish' ||
    action === 'set-note'
  )
  // unset-commander is treated as destructive (red) like remove
}

export type PrintingFields = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
}

/**
 * Format the ` (SET:CN) [finish] [condition]` annotation tail used in changelog
 * lines and entry descriptions. Empty when none of the fields are set.
 */
export function formatPrintingAnnotation(change: PrintingFields): string {
  const printingInfo =
    change.set && change.collectorNumber
      ? ` (${change.set.toUpperCase()}:${change.collectorNumber})`
      : ''
  const finishInfo = change.finish && change.finish !== 'nonfoil' ? ` [${change.finish}]` : ''
  const conditionInfo =
    change.condition && change.condition !== 'NM' ? ` [${change.condition}]` : ''
  return `${printingInfo}${finishInfo}${conditionInfo}`
}

type FormatChangeOptions = { tense: 'present' | 'past' }

/** Format a change event as a human-readable description, shared by formatChange and changelog writer */
export function formatChangeCore(change: ChangeEvent, opts: FormatChangeOptions): string {
  const { tense } = opts
  const idInfo = change.cardId !== undefined ? ` &${change.cardId}` : ''

  switch (change.action) {
    case 'add':
    case 'remove': {
      const ann = formatPrintingAnnotation(change)
      const verb =
        change.action === 'add'
          ? tense === 'past'
            ? 'Added'
            : 'Add'
          : tense === 'past'
            ? 'Removed'
            : 'Remove'
      return `${verb} ${change.cardName}${ann}${idInfo}`
    }
    case 'set-commander':
      return `Set ${change.cardName} as commander${idInfo}`
    case 'unset-commander':
      return `Unset ${change.cardName} as commander${idInfo}`
    case 'set-finish':
      return `Set ${change.cardName} finish to ${change.finish}${idInfo}`
    case 'set-note': {
      if (change.note === '') {
        const clearVerb = tense === 'past' ? 'Cleared' : 'Clear'
        return `${clearVerb} note on ${change.cardName}${idInfo}`
      }
      return `Set note on ${change.cardName}${idInfo} to "${change.note}"`
    }
    case 'move-from': {
      const ann = formatPrintingAnnotation(change)
      const verb = tense === 'past' ? 'Moved' : 'Move'
      return `${verb} ${change.cardName}${ann}${idInfo} to ${listRefLabel(change.to)}`
    }
    case 'move-to': {
      const ann = formatPrintingAnnotation(change)
      const verb = tense === 'past' ? 'Moved' : 'Move'
      return `${verb} ${change.cardName}${ann}${idInfo} from ${listRefLabel(change.from)}`
    }
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
