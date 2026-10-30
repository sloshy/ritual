/**
 * Pure reads over a session's change list: which cards it added that the
 * on-disk list did not hold.
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
