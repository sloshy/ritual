import type { ChangelogAction } from '../changes/changelog-parser'

/**
 * Whether a change renders as additive (green `+`) rather than destructive (red `−`).
 * Mirrors `isAdditiveChange` in `change-event.ts`: `Unset as commander` and
 * `Cleared note` are destructive like `Removed`. Exhaustive so a new `ChangelogAction`
 * fails to compile until it is categorized here.
 *
 * This file used to carry a second implementation of the changelog *wording*
 * beside `formatChangeCore`, with an explicit "keep the two in sync" comment.
 * That duplication is gone: `changeMessage` in `src/change-message.ts` is now
 * the single display renderer, and it hands back ordered segments so the card
 * name can be a clickable node wherever the translator puts it. Only this
 * colour categorization — which is presentation, not wording — stays here.
 */
export function isAdditiveAction(action: ChangelogAction): boolean {
  switch (action) {
    case 'Added':
    case 'Set as commander':
    case 'Set finish':
    case 'Set printing':
    case 'Set language':
    case 'Set note':
    case 'Set labels':
    case 'Added section':
    case 'Renamed section':
    case 'Moved to section':
      return true
    case 'Removed':
    case 'Unset as commander':
    case 'Cleared note':
    case 'Cleared labels':
    case 'Removed section':
      return false
    default:
      action satisfies never
      return false
  }
}
