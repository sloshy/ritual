import type { DroppedNote } from '../commands/move-io'
import { formatDroppedNotesSuffix } from './dropped-notes'
import type { EditorStatusActions } from './useEditorStatus'

type SaveResponse = {
  success: boolean
  error?: string
  message?: string
  conflict?: boolean
  contentHash?: string
  /** Notes discarded by the destination side of this save's cross-list moves. */
  droppedNotes?: DroppedNote[]
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
      const droppedNote = formatDroppedNotesSuffix(data.droppedNotes ?? [])
      statusActions.saveSuccess(
        droppedNote ? `Changes saved successfully.${droppedNote}` : 'Changes saved successfully',
      )
      discardAll()
      return data
    }
    if (resp.status === 409 || data.conflict) {
      statusActions.saveError(
        data.message ?? 'Content has been modified. Please reload to continue editing.',
      )
      return data
    }
    statusActions.saveError(data.error ?? data.message ?? 'Save failed')
    return data
  } catch {
    statusActions.saveError('Failed to save changes')
    return undefined
  }
}
