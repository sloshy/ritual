import { createStore } from 'solid-js/store'

export type EditorStatus = {
  loading: boolean
  error: string | null
  saving: boolean
  saveStatus: string | null
}

export type StatusAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS' }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS'; message: string }
  | { type: 'SAVE_ERROR'; error: string }
  | { type: 'SET_ERROR'; error: string }

export const initialStatus: EditorStatus = {
  loading: false,
  error: null,
  saving: false,
  saveStatus: null,
}

export function statusReducer(state: EditorStatus, action: StatusAction): EditorStatus {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null, saveStatus: null }
    case 'LOAD_SUCCESS':
      return { ...state, loading: false }
    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.error }
    case 'SAVE_START':
      return { ...state, saving: true, saveStatus: null }
    case 'SAVE_SUCCESS':
      return { ...state, saving: false, saveStatus: action.message }
    case 'SAVE_ERROR':
      return { ...state, saving: false, error: action.error }
    case 'SET_ERROR':
      return { ...state, error: action.error }
  }
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
