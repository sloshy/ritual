export type ChangeAction = 'add' | 'remove' | 'set-commander' | 'set-finish'

export type ChangeEvent = {
  id: string
  timestamp: number
  action: ChangeAction
  cardName: string
  set?: string
  collectorNumber?: string
  finish?: string
  condition?: string
}

/** Printing metadata shared by ChangeEvent, Card operations, and API boundaries */
export type CardPrintingOptions = Pick<
  ChangeEvent,
  'set' | 'collectorNumber' | 'finish' | 'condition'
>

/** Create a unique ID for a change event */
export function createChangeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Check if two change events are exact opposites that should cancel out */
export function areOppositeChanges(a: ChangeEvent, b: ChangeEvent): boolean {
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

  // Printing must match (both undefined or both same)
  if (a.set !== b.set || a.collectorNumber !== b.collectorNumber) return false

  // Finish must match
  if (a.finish !== b.finish) return false

  // Condition must match
  if (a.condition !== b.condition) return false

  return true
}

/** Check if a change is additive (green) or destructive (red) */
export function isAdditiveChange(action: ChangeAction): boolean {
  return action === 'add' || action === 'set-commander' || action === 'set-finish'
}

/** Format a change event as a human-readable description */
export function formatChange(change: ChangeEvent): string {
  const printingInfo =
    change.set && change.collectorNumber ? ` (${change.set}:${change.collectorNumber})` : ''
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
    case 'set-finish':
      return `Set ${change.cardName} finish to ${change.finish ?? 'nonfoil'}`
  }
}
