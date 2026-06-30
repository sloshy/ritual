import { type Component, Show } from 'solid-js'
import { Modal } from './Modal'

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
 * A small yes/no confirmation modal — the in-app replacement for `window.confirm`.
 * Used wherever an action needs a plain confirmation without a typed value.
 */
export const ConfirmDialog: Component<ConfirmDialogProps> = (props) => {
  return (
    <Modal open={props.open} onClose={props.onCancel} size="md" panelClass="modal-panel--prompt">
      <h3>{props.title}</h3>
      <Show when={props.message}>
        <p class="dialog-message">{props.message}</p>
      </Show>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          class={props.destructive ? 'btn btn-danger' : 'btn btn-primary'}
          onClick={props.onConfirm}
        >
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
