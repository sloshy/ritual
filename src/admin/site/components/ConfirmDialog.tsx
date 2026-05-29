import { type Component, Show } from 'solid-js'
import { useDialogModal } from '../hooks/useDialogModal'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message?: string
  confirmLabel: string
  /** Style the confirm button as a destructive action (red) rather than the default accent. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A small yes/no confirmation modal — the in-app replacement for `window.confirm`,
 * matching the other editor dialogs (`discard-dialog-native` shell + `confirm-dialog`
 * box). Used wherever an action needs a plain confirmation without a typed value.
 */
export const ConfirmDialog: Component<ConfirmDialogProps> = (props) => {
  const dialog = useDialogModal(() => props.open)

  return (
    <dialog
      ref={dialog.setDialog}
      class="discard-dialog-native"
      onClose={props.onCancel}
      onClick={dialog.onBackdropClick}
    >
      <div class="confirm-dialog">
        <h3>{props.title}</h3>
        <Show when={props.message}>
          <p class="dialog-message">{props.message}</p>
        </Show>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={dialog.close}>
            Cancel
          </button>
          <button
            type="button"
            class={props.destructive ? 'btn-discard' : 'btn'}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
