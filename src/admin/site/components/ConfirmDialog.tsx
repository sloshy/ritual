import { type Component, createEffect, Show } from 'solid-js'

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
  let dialogRef: HTMLDialogElement | undefined

  createEffect(() => {
    const dialog = dialogRef
    if (!dialog) return
    if (props.open && !dialog.open) dialog.showModal()
    else if (!props.open && dialog.open) dialog.close()
  })

  const handleBackdropClick = (e: MouseEvent) => {
    if ((e.target as Element) === dialogRef) dialogRef?.close()
  }

  return (
    <dialog
      ref={dialogRef}
      class="discard-dialog-native"
      onClose={props.onCancel}
      onClick={handleBackdropClick}
    >
      <div class="confirm-dialog">
        <h3>{props.title}</h3>
        <Show when={props.message}>
          <p class="dialog-message">{props.message}</p>
        </Show>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={() => dialogRef?.close()}>
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
