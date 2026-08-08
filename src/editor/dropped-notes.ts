import type { DroppedNote } from '../commands/move-io'
import { t } from '../i18n/t'

/**
 * Format dropped-note reports as a status-message suffix (empty when none),
 * e.g. ` Note dropped on merge: Sol Ring ("from trade").`. Shared by the move
 * page and the editor save flow so the wording stays identical.
 */
export function formatDroppedNotesSuffix(droppedNotes: DroppedNote[]): string {
  if (droppedNotes.length === 0) return ''
  const items = droppedNotes.map((d) => `${d.cardName} ("${d.note}")`).join(', ')
  // The leading space joins this onto the status sentence before it; it belongs
  // to the caller's composition, not to the message.
  return ` ${t('ui.editor.droppedNotes', { count: droppedNotes.length, items })}`
}
