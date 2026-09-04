/**
 * What a successful save has to tell the user beyond "saved", composed into one
 * suffix. The `formatDroppedNotesSuffix` sibling (`src/list/dropped-notes.ts`)
 * sets the shape: each sentence arrives already rendered, and the leading space
 * belongs to the caller's composition rather than to the message.
 */

import type { DroppedNote } from '../list/move-staging'
import { formatDroppedNotesSuffix } from '../list/dropped-notes'
import { t } from '../i18n/t'

/**
 * Format the pruned-category report as a status-message suffix (empty when
 * none), e.g. ` Categories dropped for cards the list no longer holds: Sol Ring.`
 * Renders `ui.editor.prunedCategories` with **both** parameters: `count` (the
 * plural selector, without which `t()` throws in strict mode) and `items`.
 */
export function formatPrunedCategoriesSuffix(names: readonly string[]): string {
  if (names.length === 0) return ''
  return ` ${t('ui.editor.prunedCategories', { count: names.length, items: names.join(', ') })}`
}

/** Everything a successful save reported beyond the write itself. */
export type SaveSuccessNotices = {
  droppedNotes?: readonly DroppedNote[]
  prunedCategories?: readonly string[]
  /** Sidecar trouble, arriving as finished sentences localized server-side. */
  categoryWarnings?: readonly string[]
}

/**
 * Every notice a save produced, rendered and space-joined in a fixed order:
 * dropped notes, pruned categories, then the server's own sidecar warnings.
 * `''` when the save had nothing to add.
 */
export function saveSuccessSuffix(notices: SaveSuccessNotices): string {
  const parts = [
    formatDroppedNotesSuffix(notices.droppedNotes ?? []),
    formatPrunedCategoriesSuffix(notices.prunedCategories ?? []),
    ...(notices.categoryWarnings ?? []).map((warning) => ` ${warning}`),
  ]
  return parts.filter((part) => part.length > 0).join('')
}
