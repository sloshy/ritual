import type { DroppedNote } from '../list/move-staging'
import type { SaveEffect } from '../changes/save-effects'
import { saveSuccessSuffix, type SaveSuccessNotices } from './save-notices'
import {
  type EditorStatusActions,
  type EditorStatusMessage,
  statusMessage,
  statusText,
} from './useEditorStatus'
import { readApiMessage } from '../api/result'

type SaveResponse = {
  success: boolean
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
  /**
   * Categories-sidecar trouble the save reported (`save-helpers.ts`'s
   * `categoryWarnings`), already rendered server-side.
   */
  categoryWarnings?: string[]
  /**
   * Card names whose categories this save pruned, because its removals took the
   * list's last line of that name (`save-helpers.ts`'s `prunedCategories`).
   */
  prunedCategories?: string[]
}

export async function saveEditorChanges(
  endpoint: string,
  body: unknown,
  statusActions: EditorStatusActions,
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
      // The notices are held as data and rendered with the status, so a
      // language switch relabels them with the sentence around them. The
      // server's own sidecar warnings arrive as English sentences and stay so.
      const notices: SaveSuccessNotices = {
        droppedNotes: data.droppedNotes,
        prunedCategories: data.prunedCategories,
        categoryWarnings: data.categoryWarnings,
      }
      statusActions.saveSuccess(
        saveSuccessSuffix(notices)
          ? { kind: 'saved', notices }
          : statusMessage('ui.editor.saveSuccess'),
      )
      return data
    }
    // `data.message` is prose the server authored: English, plus the key it was
    // rendered from when it has one this bundle knows, which is then what the
    // status holds — so it relabels on a language switch like the editor's own.
    if (resp.status === 409 || data.conflict) {
      statusActions.saveError(serverStatus(data) ?? statusMessage('ui.editor.saveConflict'))
      return data
    }
    statusActions.saveError(serverStatus(data) ?? statusMessage('ui.editor.saveFailed'))
    return data
  } catch {
    statusActions.saveError(statusMessage('ui.editor.saveRequestFailed'))
    return undefined
  }
}

/** The server's own sentence as a status: by its key when this bundle knows it, else as text. */
function serverStatus(data: SaveResponse): EditorStatusMessage | null {
  const carried = readApiMessage(data)
  if (carried === null || carried.message === '') return null
  if (carried.messageKey === undefined) return statusText(carried.message)
  return { kind: 'key', key: carried.messageKey, params: carried.messageParams }
}
