import { type Component, createSignal } from 'solid-js'
import { Modal } from './Modal'
import { clampQuantity } from './quantity'

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
  const [count, setCount] = createSignal(1)

  const clampedCount = (): number => clampQuantity(count(), 1, props.total)

  return (
    <Modal
      open={props.open}
      onClose={props.onCancel}
      size="md"
      panelClass="modal-panel--prompt"
      // Default to all copies each time the dialog opens.
      onOpen={() => setCount(props.total)}
    >
      <h3>{props.title}</h3>
      <p class="dialog-message">{props.message}</p>
      <div class="change-printing-qty-field">
        <label for={props.inputId}>Copies</label>
        <input
          id={props.inputId}
          class="form-input"
          type="number"
          min={1}
          max={props.total}
          value={count()}
          onInput={(e) => setCount(Number(e.currentTarget.value))}
        />
        <span class="text-muted">of {props.total}</span>
      </div>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => props.onConfirm(clampedCount())}
        >
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
