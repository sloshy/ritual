import type { Finish, Condition } from './types'

// ── Discriminated union types ───────────────────────────────────────

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

export type ChangeEvent =
  | AddChange
  | RemoveChange
  | SetCommanderChange
  | UnsetCommanderChange
  | SetFinishChange

/** Derived from the union — kept as a convenience alias for switch statements. */
export type ChangeAction = ChangeEvent['action']

/** Distributes Omit over each member of a union, preserving discriminated-union structure. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** The subset of ChangeEvent fields that applyChange* functions need (no id/timestamp). */
export type ChangeInput = DistributiveOmit<ChangeEvent, 'id' | 'timestamp'>

/** Printing metadata shared by ChangeEvent, Card operations, and API boundaries */
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

/** Create a ChangeEvent with auto-generated id and timestamp. */
export function createChangeEvent(
  action: ChangeAction,
  cardName: string,
  options?: CardPrintingOptions,
): ChangeEvent {
  const base: BaseChange = {
    id: createChangeId(),
    timestamp: Date.now(),
    cardName,
    cardId: options?.cardId,
  }
  switch (action) {
    case 'add':
      return {
        ...base,
        action,
        set: options?.set,
        collectorNumber: options?.collectorNumber,
        finish: options?.finish,
        condition: options?.condition,
      }
    case 'remove':
      return {
        ...base,
        action,
        set: options?.set,
        collectorNumber: options?.collectorNumber,
        finish: options?.finish,
        condition: options?.condition,
      }
    case 'set-commander':
      return { ...base, action }
    case 'unset-commander':
      return { ...base, action }
    case 'set-finish': {
      if (!options?.finish) throw new Error('set-finish action requires a finish value')
      return { ...base, action, finish: options.finish }
    }
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

  // Only add/remove can cancel each other
  if (
    !(
      (a.action === 'add' && b.action === 'remove') ||
      (a.action === 'remove' && b.action === 'add')
    )
  ) {
    return false
  }

  // Narrow to AddChange | RemoveChange for field access
  const ac = a as AddChange | RemoveChange
  const bc = b as AddChange | RemoveChange

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

/** Check if a change is additive (green) or destructive (red) */
export function isAdditiveChange(action: ChangeAction): boolean {
  return action === 'add' || action === 'set-commander' || action === 'set-finish'
  // unset-commander is treated as destructive (red) like remove
}

/** Format a change event as a human-readable description */
export function formatChange(change: ChangeEvent): string {
  const idInfo = change.cardId !== undefined ? ` &${change.cardId}` : ''

  switch (change.action) {
    case 'add':
    case 'remove': {
      const printingInfo =
        change.set && change.collectorNumber
          ? ` (${change.set.toUpperCase()}:${change.collectorNumber})`
          : ''
      const finishInfo = change.finish && change.finish !== 'nonfoil' ? ` [${change.finish}]` : ''
      const conditionInfo =
        change.condition && change.condition !== 'NM' ? ` [${change.condition}]` : ''
      const verb = change.action === 'add' ? 'Add' : 'Remove'
      return `${verb} ${change.cardName}${printingInfo}${finishInfo}${conditionInfo}${idInfo}`
    }
    case 'set-commander':
      return `Set ${change.cardName} as commander${idInfo}`
    case 'unset-commander':
      return `Unset ${change.cardName} as commander${idInfo}`
    case 'set-finish':
      return `Set ${change.cardName} finish to ${change.finish}${idInfo}`
  }
}
