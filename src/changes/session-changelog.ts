import type { ChangeEvent } from './change-event'
import { createChangeId } from './change-event'

/**
 * Track a card add in the session change log.
 * Returns the index of the newly pushed event (the new lastChangeIndex).
 */
export function trackAdd(sessionChanges: ChangeEvent[], event: ChangeEvent): number {
  sessionChanges.push(event)
  return sessionChanges.length - 1
}

/**
 * Track an edit to the last added card.
 *
 * If `replaced` is true (the line was found and replaced in the file), the event
 * at `lastChangeIndex` is updated in-place so the changelog reflects the final state.
 *
 * If `replaced` is false (line mismatch — the card was added as a new entry instead),
 * or if `lastChangeIndex` is null, the event is pushed as a new entry.
 *
 * Returns the new lastChangeIndex.
 */
export function trackEdit(
  sessionChanges: ChangeEvent[],
  lastChangeIndex: number | null,
  event: ChangeEvent,
  replaced: boolean,
): number {
  if (replaced && lastChangeIndex !== null) {
    sessionChanges[lastChangeIndex] = event
    return lastChangeIndex
  }
  sessionChanges.push(event)
  return sessionChanges.length - 1
}

/**
 * Track adding another copy of the last added card.
 * Copies the previous event with a fresh ID and timestamp.
 * If `cardId` is provided it overrides the original event's cardId (each copy gets a unique ID).
 * Returns the new lastChangeIndex, or null if there is no previous event to copy.
 */
export function trackAnotherCopy(
  sessionChanges: ChangeEvent[],
  lastChangeIndex: number | null,
  cardId?: number,
): number | null {
  if (lastChangeIndex === null) return null
  const prevChange = sessionChanges[lastChangeIndex]
  if (!prevChange) return null
  sessionChanges.push({
    ...prevChange,
    id: createChangeId(),
    timestamp: Date.now(),
    ...(cardId !== undefined ? { cardId } : {}),
  })
  return sessionChanges.length - 1
}
