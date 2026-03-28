import type { Finish } from './types'

export type ChangeAction = 'add' | 'remove' | 'set-commander' | 'unset-commander' | 'set-finish'

export type ChangeEvent = {
  id: string
  timestamp: number
  action: ChangeAction
  cardName: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: string
}

/** The subset of ChangeEvent fields that applyChange* functions need (no id/timestamp). */
export type ChangeInput = Omit<ChangeEvent, 'id' | 'timestamp'>

/** Printing metadata shared by ChangeEvent, Card operations, and API boundaries */
export type CardPrintingOptions = Pick<
  ChangeEvent,
  'set' | 'collectorNumber' | 'finish' | 'condition'
>

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
  return {
    id: createChangeId(),
    timestamp: Date.now(),
    action,
    cardName,
    set: options?.set,
    collectorNumber: options?.collectorNumber,
    finish: options?.finish,
    condition: options?.condition,
  }
}

/** Check if two change events are exact opposites that should cancel out */
export function areOppositeChanges(a: ChangeEvent, b: ChangeEvent): boolean {
  // set-commander and unset-commander cancel each other for the same card
  if (
    (a.action === 'set-commander' && b.action === 'unset-commander') ||
    (a.action === 'unset-commander' && b.action === 'set-commander')
  ) {
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

  // Card name must match
  if (a.cardName !== b.cardName) return false

  // Printing must match (both undefined or both same, case-insensitive)
  if (a.set?.toLowerCase() !== b.set?.toLowerCase() || a.collectorNumber !== b.collectorNumber)
    return false

  // Finish must match
  if (a.finish !== b.finish) return false

  // Condition must match
  if (a.condition !== b.condition) return false

  return true
}

/** Check if a change is additive (green) or destructive (red) */
export function isAdditiveChange(action: ChangeAction): boolean {
  return action === 'add' || action === 'set-commander' || action === 'set-finish'
  // unset-commander is treated as destructive (red) like remove
}

/** Format a change event as a human-readable description */
export function formatChange(change: ChangeEvent): string {
  const printingInfo =
    change.set && change.collectorNumber
      ? ` (${change.set.toUpperCase()}:${change.collectorNumber})`
      : ''
  const finishInfo = change.finish && change.finish !== 'nonfoil' ? ` [${change.finish}]` : ''
  const conditionInfo =
    change.condition && change.condition !== 'NM' ? ` [${change.condition}]` : ''

  switch (change.action) {
    case 'add':
      return `Add ${change.cardName}${printingInfo}${finishInfo}${conditionInfo}`
    case 'remove':
      return `Remove ${change.cardName}${printingInfo}${finishInfo}${conditionInfo}`
    case 'set-commander':
      return `Set ${change.cardName} as commander`
    case 'unset-commander':
      return `Unset ${change.cardName} as commander`
    case 'set-finish':
      return `Set ${change.cardName} finish to ${change.finish ?? 'nonfoil'}`
  }
}
