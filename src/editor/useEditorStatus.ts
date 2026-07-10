import { createStore } from 'solid-js/store'

export type EditorStatus = {
  loading: boolean
  error: string | null
  saving: boolean
  saveStatus: string | null
}

const initialStatus: EditorStatus = {
  loading: false,
  error: null,
  saving: false,
  saveStatus: null,
}

export type EditorStatusActions = {
  loadStart: () => void
  loadSuccess: () => void
  loadError: (error: string) => void
  saveStart: () => void
  saveSuccess: (message: string) => void
  saveError: (error: string) => void
  setError: (error: string) => void
}

export function useEditorStatus(): [EditorStatus, EditorStatusActions] {
  const [state, setState] = createStore<EditorStatus>({ ...initialStatus })

  const actions: EditorStatusActions = {
    loadStart: () => setState({ loading: true, error: null, saveStatus: null }),
    loadSuccess: () => setState({ loading: false }),
    loadError: (error) => setState({ loading: false, error }),
    saveStart: () => setState({ saving: true, saveStatus: null }),
    saveSuccess: (message) => setState({ saving: false, saveStatus: message }),
    saveError: (error) => setState({ saving: false, error }),
    setError: (error) => setState({ error }),
  }

  return [state, actions]
}
