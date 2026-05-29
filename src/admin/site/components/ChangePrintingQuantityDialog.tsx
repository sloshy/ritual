import type { Component } from 'solid-js'
import { QuantityDialog } from './QuantityDialog'

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
 * collection tile groups several identical copies. A thin wrapper over the shared
 * {@link QuantityDialog}.
 */
export const ChangePrintingQuantityDialog: Component<ChangePrintingQuantityDialogProps> = (
  props,
) => {
  return (
    <QuantityDialog
      open={props.open}
      title="Change printing"
      message={`How many of the ${props.total} copies of ${props.cardName} should get the new printing?`}
      total={props.total}
      confirmLabel="Continue"
      inputId="change-printing-qty"
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    />
  )
}
