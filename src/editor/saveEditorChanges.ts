import type { DroppedNote } from '../list/move-staging'
import type { SaveEffect } from './save-effects'
import { formatDroppedNotesSuffix } from './dropped-notes'
import { type EditorStatusActions, statusMessage, statusText } from './useEditorStatus'

type SaveResponse = {
  success: boolean
  error?: string
  message?: string
  conflict?: boolean
  contentHash?: string
  /** Notes discarded by the destination side of this save's cross-list moves. */
  droppedNotes?: DroppedNote[]
  /**
   * What the save did to individual card lines, ids resolved. Read for the `&N`
   * a line ended up with — the editor's optimistic ids are not binding, and the
   * serializer renumbers a line whose number another entry claimed first.
   */
  effects?: SaveEffect[]
}

export async function saveEditorChanges(
  endpoint: string,
  body: unknown,
  statusActions: EditorStatusActions,
  discardAll: () => void,
): Promise<SaveResponse | undefined> {
  statusActions.saveStart()
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
    const data = (await resp.json()) as SaveResponse
    if (data.success) {
      // The dropped-note report is already a rendered sentence (it splices card
      // names and their notes), so it rides in as a parameter rather than being
      // concatenated onto a second message.
      const droppedNote = formatDroppedNotesSuffix(data.droppedNotes ?? [])
      statusActions.saveSuccess(
        droppedNote
          ? statusMessage('ui.editor.saveSuccessDroppedNotes', { notes: droppedNote })
          : statusMessage('ui.editor.saveSuccess'),
      )
      discardAll()
      return data
    }
    // `data.message` / `data.error` are prose the server authored; they arrive
    // rendered and stay as they are until the API carries a `messageKey`
    // (plan §7.7, Phase 5).
    if (resp.status === 409 || data.conflict) {
      statusActions.saveError(
        data.message ? statusText(data.message) : statusMessage('ui.editor.saveConflict'),
      )
      return data
    }
    const failure = data.error ?? data.message
    statusActions.saveError(failure ? statusText(failure) : statusMessage('ui.editor.saveFailed'))
    return data
  } catch {
    statusActions.saveError(statusMessage('ui.editor.saveRequestFailed'))
    return undefined
  }
}
