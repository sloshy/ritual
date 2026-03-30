import type { EditorStatusActions } from './useEditorStatus'

type SaveResponse = { success: boolean; error?: string }

export async function saveEditorChanges(
  endpoint: string,
  body: unknown,
  statusActions: EditorStatusActions,
  discardAll: () => void,
): Promise<void> {
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
      statusActions.saveSuccess('Changes saved successfully')
      discardAll()
    } else {
      statusActions.saveError(data.error ?? 'Save failed')
    }
  } catch {
    statusActions.saveError('Failed to save changes')
  }
}
