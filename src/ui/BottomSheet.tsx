import { type Component, type JSX, Show } from 'solid-js'
import { useDialogModal } from './useDialogModal'

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
  const dialog = useDialogModal(() => props.open)

  return (
    <dialog
      ref={dialog.setDialog}
      class="sheet-shell"
      aria-label={props['aria-label'] ?? props.title}
      onClose={() => dialog.handleClose(props.onClose)}
      onClick={dialog.onBackdropClick}
    >
      <div class="sheet-panel">
        <div class="sheet-grip" aria-hidden="true" />
        <div class="sheet-header">
          <span class="sheet-title">{props.title}</span>
          <button
            type="button"
            class="sheet-close"
            aria-label="Close"
            onClick={() => dialog.close()}
          >
            ✕
          </button>
        </div>
        <div class="sheet-body">
          {/* Render content only while open, mirroring Modal: a closed (but
              still-mounted) dialog leaves no queryable/focusable DOM behind. */}
          <Show when={props.open}>{props.children}</Show>
        </div>
      </div>
    </dialog>
  )
}
