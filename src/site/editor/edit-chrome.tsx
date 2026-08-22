import {
  createContext,
  useContext,
  createSignal,
  type Accessor,
  type Setter,
  type ParentComponent,
} from 'solid-js'

/** Which version of the list the visitor is currently looking at. */
export type EditView = 'edited' | 'original'

/**
 * The controls an active list editor exposes to the global navbar. The editor
 * (an EditView mounted as route content) registers this while editing so the
 * header can render the edit row — the Original/Edited toggle, Discard, Export,
 * Load Changes, and the exit action — instead of a separate sticky banner that
 * the filter toolbar would overlap.
 */
export type EditChrome = {
  changeCount: Accessor<number>
  view: Accessor<EditView>
  setView: (view: EditView) => void
  onDiscard: () => void
  onExport: () => void
  /** Open the dialog to load a change-list JSON into the current edits. */
  onLoadChanges: () => void
  /**
   * Open the "Swap Printings" wizard over the whole list. Registered by the
   * deck and collection editors only — a wanted list holds no physical cards
   * to swap — so the row shows the button only when present.
   */
  onSwapPrintings?: () => void
  /** Leave edit mode (confirming first if there are unsaved changes). */
  onExit: () => void
}

type EditChromeStore = {
  current: Accessor<EditChrome | null>
  setCurrent: Setter<EditChrome | null>
}

const EditChromeContext = createContext<EditChromeStore>()

/** Holds the active editor's chrome so the navbar and the editor body stay in sync. */
export const EditChromeProvider: ParentComponent = (props) => {
  const [current, setCurrent] = createSignal<EditChrome | null>(null)
  return (
    <EditChromeContext.Provider value={{ current, setCurrent }}>
      {props.children}
    </EditChromeContext.Provider>
  )
}

export function useEditChrome(): EditChromeStore {
  const ctx = useContext(EditChromeContext)
  if (!ctx) throw new Error('useEditChrome must be used within an EditChromeProvider')
  return ctx
}
