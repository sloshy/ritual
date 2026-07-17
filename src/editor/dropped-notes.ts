import type { DroppedNote } from '../commands/move-io'

/**
 * Format dropped-note reports as a status-message suffix (empty when none),
 * e.g. ` Note dropped on merge: Sol Ring ("from trade").`. Shared by the move
 * page and the editor save flow so the wording stays identical.
 */
export function formatDroppedNotesSuffix(droppedNotes: DroppedNote[]): string {
  if (droppedNotes.length === 0) return ''
  const items = droppedNotes.map((d) => `${d.cardName} ("${d.note}")`).join(', ')
  return ` Note${droppedNotes.length === 1 ? '' : 's'} dropped on merge: ${items}.`
}
