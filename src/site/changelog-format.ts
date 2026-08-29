import { isAdditiveChange, type ChangeEvent } from '../changes/change-event'

/**
 * Whether a change renders as additive (green `+`) rather than destructive (red `−`).
 * Derived from `isAdditiveChange` in `change-event.ts`, with the two *cleared*
 * forms folded in: a `set-note` with an empty note and a `set-label` with no
 * labels are clears, destructive like `remove`, exactly as `formatChangeCore`
 * writes them (`Cleared note …`, `Cleared labels …`).
 *
 * This file used to carry a second implementation of the changelog *wording*
 * beside `formatChangeCore`, with an explicit "keep the two in sync" comment.
 * That duplication is gone: `changeMessage` in `src/change-message.ts` is now
 * the single display renderer, and it hands back ordered segments so the card
 * name can be a clickable node wherever the translator puts it. Only this
 * colour categorization — which is presentation, not wording — stays here.
 */
export function isAdditiveEvent(change: ChangeEvent): boolean {
  if (change.action === 'set-note') return change.note !== ''
  if (change.action === 'set-label') return change.labels.length > 0
  return isAdditiveChange(change.action)
}
