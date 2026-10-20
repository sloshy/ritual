import type { DroppedNote } from './move-staging'
import { formatUnitList } from '../i18n/format'
import { currentLocale } from '../i18n/runtime'
import { t } from '../i18n/t'

/**
 * The dropped-note report as one sentence in the active locale (`null` when
 * none), e.g. `Note dropped on merge: Sol Ring ("from trade").`. Shared by the
 * move page and the editor save flow so the wording stays identical; the
 * caller joins it onto the status sentence before it (`joinSentences`).
 */
export function droppedNotesSentence(droppedNotes: readonly DroppedNote[]): string | null {
  if (droppedNotes.length === 0) return null
  const items = formatUnitList(
    currentLocale(),
    droppedNotes.map((d) => t('ui.editor.droppedNoteItem', { name: d.cardName, note: d.note })),
  )
  return t('ui.editor.droppedNotes', { count: droppedNotes.length, items })
}
