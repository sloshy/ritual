import type { Component } from 'solid-js'
import { QuantityDialog } from '../../ui/QuantityDialog'
import { useT } from '../../ui/i18n'

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
 * {@link QuantityDialog}, which takes all of its text from here — the shared
 * dialog owns only its own chrome.
 */
export const ChangePrintingQuantityDialog: Component<ChangePrintingQuantityDialogProps> = (
  props,
) => {
  const t = useT()
  return (
    <QuantityDialog
      open={props.open}
      title={t('ui.editor.changePrintingTitle')}
      message={t('ui.editor.changePrintingPrompt', {
        total: props.total,
        name: props.cardName,
      })}
      total={props.total}
      confirmLabel={t('ui.dialog.continue')}
      inputId="change-printing-qty"
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    />
  )
}
