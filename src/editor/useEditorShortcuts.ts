import { isTypingTarget, useDocumentKeydown } from '../ui/useDocumentKeydown'

export type EditorShortcutHandlers = {
  /** Opens the add-card dialog. Bound to Ctrl/Cmd+Enter. */
  onAddCard: () => void
  /** Moves keyboard focus into the bottom action bar. Bound to Ctrl/Cmd+B. */
  onFocusActionBar: () => void
  /** Opens the shortcuts reference. Bound to `?`. */
  onShowShortcuts: () => void
}

/**
 * Page-level keyboard shortcuts for the list editors.
 *
 * All bindings are suppressed while any modal is open — every editor dialog is
 * a native `<dialog>`, so an open one is detectable without threading each
 * dialog's signal through here, and its own key handling (arrow navigation,
 * Enter to confirm) stays unambiguous.
 */
export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  useDocumentKeydown((e) => {
    if (document.querySelector('dialog[open]')) return
    // `?` is unmodified and printable, so unlike the chorded shortcuts below it
    // has to yield to any field the user could be typing into.
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      handlers.onShowShortcuts()
      return
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (e.key === 'Enter') {
      e.preventDefault()
      handlers.onAddCard()
    } else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault()
      handlers.onFocusActionBar()
    }
  })
}
