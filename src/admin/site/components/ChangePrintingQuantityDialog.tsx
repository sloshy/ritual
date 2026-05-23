import type { Component } from 'solid-js'
import { createEffect, createSignal } from 'solid-js'

interface ChangePrintingQuantityDialogProps {
  open: boolean
  cardName: string
  /** Total number of copies the targeted tile represents. */
  total: number
  /** Confirm with the chosen number of copies (1..total). */
  onConfirm: (count: number) => void
  onCancel: () => void
}

/**
 * Asks how many of a multi-copy card's copies should receive the new printing.
 * Shown before the printing picker when a deck entry has quantity > 1 or a
 * collection tile groups several identical copies.
 */
export const ChangePrintingQuantityDialog: Component<ChangePrintingQuantityDialogProps> = (
  props,
) => {
  let dialogRef: HTMLDialogElement | undefined
  // Defaulted to the tile's total on each open by the effect below; the static
  // initial value is never shown.
  const [count, setCount] = createSignal(1)

  createEffect(() => {
    const dialog = dialogRef
    if (!dialog) return
    if (props.open && !dialog.open) {
      // Default to changing all copies each time the dialog opens.
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
        <h3>Change printing</h3>
        <p class="dialog-message">
          How many of the {props.total} copies of {props.cardName} should get the new printing?
        </p>
        <div class="change-printing-qty-field">
          <label for="change-printing-qty">Copies</label>
          <input
            id="change-printing-qty"
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
          <button type="button" class="btn" onClick={() => props.onConfirm(clampedCount())}>
            Continue
          </button>
        </div>
      </div>
    </dialog>
  )
}
