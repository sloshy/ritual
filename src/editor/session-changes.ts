/**
 * Pure reads over a session's change list: which cards it added that the
 * on-disk list did not hold, and which `&N` ids a restored session occupies.
 */

import type { ChangeEvent } from '../changes/change-event'

/**
 * Card names added by `changes` — an `add` change for a card that wasn't in
 * the on-disk original (`findOriginalId` answers `undefined`). Cards moved in
 * from another list are recorded as `move-from` on the source (not `add`
 * here), so they're correctly excluded. Each name once, in first-added order.
 */
export function addedCardNamesFrom(
  changes: readonly ChangeEvent[],
  findOriginalId: (cardName: string) => number | undefined,
): string[] {
  const names = new Set<string>()
  for (const change of changes) {
    if (change.action === 'add' && findOriginalId(change.cardName) === undefined) {
      names.add(change.cardName)
    }
  }
  return [...names]
}

/**
 * Every `&N` a resumed session holds: the original's ids plus each id the
 * restored changes reference, so later adds in the session don't reallocate
 * one of them.
 */
export function usedIdsAfterRestore(
  originalIds: readonly number[],
  restored: readonly ChangeEvent[],
): number[] {
  const used = new Set<number>(originalIds)
  for (const change of restored) {
    if ('cardId' in change && typeof change.cardId === 'number') used.add(change.cardId)
  }
  return [...used]
}
