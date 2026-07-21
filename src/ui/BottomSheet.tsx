import { type Component, type JSX, Show } from 'solid-js'
import { useDialogModal } from './useDialogModal'

/** Slide-out duration; matches the `.sheet-shell` / `.sheet-panel` transitions in modal.css. */
const SHEET_EXIT_MS = 200

export type BottomSheetProps = {
  open: boolean
  /** Fired on a genuine user dismissal (Escape, backdrop tap, the × button). */
  onClose: () => void
  /** Title rendered in the sheet's header row, next to the close button. */
  title?: string
  /** Accessible label for the dialog when it has no title. */
  'aria-label'?: string
  children: JSX.Element
}

/**
 * The mobile counterpart to {@link Modal}: a native `<dialog>` that slides a
 * full-width panel up from the bottom of the viewport. Used on touch devices in
 * place of anchored popover menus (filters, selection actions, export formats,
 * the toolbar's sort & group controls), where a phone-sized screen has no room
 * to anchor a dropdown and small menu rows are hard to hit. Dismissal mirrors
 * Modal: Escape, backdrop tap, or the header's × button.
 */
export const BottomSheet: Component<BottomSheetProps> = (props) => {
  const dialog = useDialogModal(() => props.open, {
    onDismiss: () => props.onClose(),
    exitMs: SHEET_EXIT_MS,
  })

  return (
    <dialog
      ref={dialog.setDialog}
      class="sheet-shell"
      classList={{ 'is-closing': dialog.exiting() }}
      aria-label={props['aria-label'] ?? props.title}
      onCancel={(e) => {
        // Escape would close the element outright, skipping the slide-out.
        e.preventDefault()
        dialog.requestClose()
      }}
      onClick={dialog.onBackdropClick}
    >
      <div ref={dialog.setPanel} class="sheet-panel">
        <div class="sheet-grip" aria-hidden="true" />
        <div class="sheet-header">
          <span class="sheet-title">{props.title}</span>
          <button
            type="button"
            class="sheet-close"
            aria-label="Close"
            onClick={dialog.requestClose}
          >
            ✕
          </button>
        </div>
        <div class="sheet-body">
          {/* Render content only while open (plus the closing animation), mirroring
              Modal: a closed, settled dialog leaves no queryable/focusable DOM behind. */}
          <Show when={dialog.mounted()}>{props.children}</Show>
        </div>
      </div>
    </dialog>
  )
}
