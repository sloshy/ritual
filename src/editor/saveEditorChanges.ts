import type { DroppedNote } from '../list/move-staging'
import type { SaveEffect } from '../changes/save-effects'
import { saveSuccessSuffix } from './save-notices'
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
      // Every notice is already a rendered sentence (they splice card names and
      // server prose), so they ride in as one parameter rather than being
      // concatenated onto a second message.
      const notices = saveSuccessSuffix({
        droppedNotes: data.droppedNotes,
        prunedCategories: data.prunedCategories,
        categoryWarnings: data.categoryWarnings,
      })
      statusActions.saveSuccess(
        notices
          ? statusMessage('ui.editor.saveSuccessNotices', { notes: notices })
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
