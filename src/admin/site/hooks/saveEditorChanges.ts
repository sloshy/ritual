import type { StatusAction } from './useEditorStatus'

type SaveResponse = { success: boolean; error?: string }

export async function saveEditorChanges(
  endpoint: string,
  body: unknown,
  statusDispatch: (action: StatusAction) => void,
  discardAll: () => void,
): Promise<void> {
  statusDispatch({ type: 'SAVE_START' })
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
    const data = (await resp.json()) as SaveResponse
    if (data.success) {
      statusDispatch({ type: 'SAVE_SUCCESS', message: 'Changes saved successfully' })
      discardAll()
    } else {
      statusDispatch({ type: 'SAVE_ERROR', error: data.error ?? 'Save failed' })
    }
  } catch {
    statusDispatch({ type: 'SAVE_ERROR', error: 'Failed to save changes' })
  }
}
