import type { Component } from 'solid-js'
import { createEffect, createSignal } from 'solid-js'

export interface QuantityDialogProps {
  open: boolean
  title: string
  message: string
  /** Total number of copies the targeted tile represents (the input's max). */
  total: number
  confirmLabel: string
  /** DOM id for the number input, so callers/tests can target it. */
  inputId: string
  /** Confirm with the chosen number of copies (1..total). */
  onConfirm: (count: number) => void
  onCancel: () => void
}

/**
 * A small "how many copies?" prompt shown before a multi-copy action (change
 * printing, move). Defaults to all copies on open and clamps the entered value
 * to 1..total. Shared by the change-printing and move flows.
 */
export const QuantityDialog: Component<QuantityDialogProps> = (props) => {
  let dialogRef: HTMLDialogElement | undefined
  // Set while confirming so the dialog's `close` event — which fires for *every* close,
  // including the programmatic one when `props.open` flips false on advance — is not mistaken
  // for a user cancellation. Without this, advancing would immediately abort the flow.
  let advancing = false
  const [count, setCount] = createSignal(1)

  createEffect(() => {
    const dialog = dialogRef
    if (!dialog) return
    if (props.open && !dialog.open) {
      // Default to all copies each time the dialog opens.
      advancing = false
      setCount(props.total)
      dialog.showModal()
    } else if (!props.open && dialog.open) {
      dialog.close()
    }
  })

  const clampedCount = (): number => {
    const n = Math.round(count())
    if (Number.isNaN(n)) return 1
    return Math.min(Math.max(n, 1), props.total)
  }

  const confirm = () => {
    advancing = true
    props.onConfirm(clampedCount())
  }

  // Only a genuine dismissal (Cancel button, backdrop, or Escape) cancels; the programmatic
  // close on advance is swallowed here.
  const handleClose = () => {
    if (advancing) {
      advancing = false
      return
    }
    props.onCancel()
  }

  const handleBackdropClick = (e: MouseEvent) => {
    if ((e.target as Element) === dialogRef) dialogRef?.close()
  }

  return (
    <dialog
      ref={dialogRef}
      class="discard-dialog-native"
      onClose={handleClose}
      onClick={handleBackdropClick}
    >
      <div class="confirm-dialog">
        <h3>{props.title}</h3>
        <p class="dialog-message">{props.message}</p>
        <div class="change-printing-qty-field">
          <label for={props.inputId}>Copies</label>
          <input
            id={props.inputId}
            type="number"
            min={1}
            max={props.total}
            value={count()}
            onInput={(e) => setCount(Number(e.currentTarget.value))}
          />
          <span class="text-muted">of {props.total}</span>
        </div>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={() => dialogRef?.close()}>
            Cancel
          </button>
          <button type="button" class="btn" onClick={confirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
