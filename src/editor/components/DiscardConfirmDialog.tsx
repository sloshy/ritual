import type { Component } from 'solid-js'
import { For } from 'solid-js'
import { type ChangeEvent, isAdditiveChange, formatChange } from '../../change-event'
import { useDialogModal } from '../../ui/useDialogModal'

interface DiscardConfirmDialogProps {
  open: boolean
  changes: ChangeEvent[]
  onConfirm: () => void
  onCancel: () => void
}

export const DiscardConfirmDialog: Component<DiscardConfirmDialogProps> = (props) => {
  const dialog = useDialogModal(() => props.open)

  return (
    <dialog
      ref={dialog.setDialog}
      class="discard-dialog-native"
      onClose={props.onCancel}
      onClick={dialog.onBackdropClick}
    >
      <div class="confirm-dialog">
        <h3>
          Discard {props.changes.length} change{props.changes.length !== 1 ? 's' : ''}?
        </h3>
        <p class="dialog-message">The following changes will be lost:</p>
        <div class="changes-dialog changes-list-box">
          <For each={props.changes}>
            {(change) => {
              const additive = isAdditiveChange(change.action)
              return (
                <div class={`change-item ${additive ? 'change-item--add' : 'change-item--remove'}`}>
                  <span class="change-item-icon">{additive ? '+' : '−'}</span>
                  <span>{formatChange(change)}</span>
                </div>
              )
            }}
          </For>
        </div>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={dialog.close}>
            Cancel
          </button>
          <button type="button" class="btn-discard" onClick={props.onConfirm}>
            Yes, discard
          </button>
        </div>
      </div>
    </dialog>
  )
}
