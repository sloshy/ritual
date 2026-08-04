import type { ChangelogAction, ChangelogChange } from '../changelog-parser'

/** A change rendered as the text before and after the (clickable) card-name node. */
export type FormattedChange = { prefix: string; suffix: string }

/**
 * Whether a change renders as additive (green `+`) rather than destructive (red `−`).
 * Mirrors `isAdditiveChange` in `change-event.ts`: `Unset as commander` and
 * `Cleared note` are destructive like `Removed`. Exhaustive so a new `ChangelogAction`
 * fails to compile until it is categorized here.
 */
export function isAdditiveAction(action: ChangelogAction): boolean {
  switch (action) {
    case 'Added':
    case 'Set as commander':
    case 'Set finish':
    case 'Set printing':
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

/**
 * Split a change into the text before and after the (clickable) card-name node.
 * The wording mirrors `formatChangeCore` in `change-event.ts` — keep the two in sync.
 * They stay separate because the server emits one flat string while the client needs
 * the card name isolated so it can be rendered as its own interactive element.
 */
export function formatChangeText(change: ChangelogChange): FormattedChange {
  switch (change.action) {
    case 'Added':
    case 'Removed': {
      // The printing/board annotation is inlined rather than reusing
      // formatPrintingAnnotation / formatBoardAnnotation from change-event.ts:
      // ChangelogChange types set/finish/condition/board as `string` (not the
      // Finish/Condition/Board unions those helpers require), so reuse would need
      // casts. Keep the output identical to those helpers — same exclusion rules
      // (skip nonfoil/NM, require both set and collector number).
      const parts: string[] = []
      if (change.set && change.collectorNumber) {
        parts.push(`(${change.set.toUpperCase()}:${change.collectorNumber})`)
      }
      if (change.finish && change.finish !== 'nonfoil') {
        parts.push(`[${change.finish}]`)
      }
      if (change.condition && change.condition !== 'NM') {
        parts.push(`[${change.condition}]`)
      }
      const annotation = parts.length > 0 ? ' ' + parts.join(' ') : ''
      // The parser only sets `board` for non-main boards, so this stays empty for
      // ordinary mainboard changes.
      const boardText = change.board
        ? ` ${change.action === 'Removed' ? 'from' : 'to'} ${change.board}`
        : ''
      return { prefix: `${change.action} `, suffix: `${annotation}${boardText}` }
    }
    case 'Set as commander':
      return { prefix: 'Set ', suffix: ' as commander' }
    case 'Unset as commander':
      return { prefix: 'Unset ', suffix: ' as commander' }
    case 'Set finish':
      return { prefix: 'Set ', suffix: ` finish to ${change.finish ?? 'nonfoil'}` }
    case 'Set printing': {
      // Mirror formatChangeCore's set-printing wording.
      const parts: string[] = []
      if (change.set && change.collectorNumber) {
        parts.push(`${change.set.toUpperCase()}:${change.collectorNumber}`)
      }
      if (change.finish && change.finish !== 'nonfoil') parts.push(`[${change.finish}]`)
      if (change.condition && change.condition !== 'NM') parts.push(`[${change.condition}]`)
      const desc = parts.length > 0 ? parts.join(' ') : 'no specific printing'
      return { prefix: 'Set ', suffix: ` printing to ${desc}` }
    }
    case 'Set note':
      // Mirror formatChangeCore: an empty (or absent) note is a clear, not a set.
      if (!change.note) return { prefix: 'Cleared note on ', suffix: '' }
      return { prefix: 'Set note on ', suffix: ` to "${change.note}"` }
    case 'Cleared note':
      return { prefix: 'Cleared note on ', suffix: '' }
    case 'Set labels':
      // Mirror formatChangeCore: an empty (or absent) label set is a clear.
      if (!change.labels || change.labels.length === 0) {
        return { prefix: 'Cleared labels on ', suffix: '' }
      }
      return { prefix: 'Set labels on ', suffix: ` to [${change.labels.join(',')}]` }
    case 'Cleared labels':
      return { prefix: 'Cleared labels on ', suffix: '' }
    // Section-structural changes carry no card; the section name lives entirely in the prefix
    // (cardName is empty, so the modal's clickable card-name node renders nothing).
    case 'Added section':
      return { prefix: `Added section "${change.section ?? ''}"`, suffix: '' }
    case 'Removed section':
      return { prefix: `Removed section "${change.section ?? ''}"`, suffix: '' }
    case 'Renamed section':
      return {
        prefix: `Renamed section "${change.section ?? ''}" to "${change.newSection ?? ''}"`,
        suffix: '',
      }
    case 'Moved to section':
      return { prefix: 'Moved ', suffix: ` to section "${change.section ?? ''}"` }
    default:
      change.action satisfies never
      throw new Error(`Unhandled changelog action (this is a bug)`)
  }
}
