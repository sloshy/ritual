import type { Component } from 'solid-js'
import { For } from 'solid-js'
import { type ChangeEvent, isAdditiveChange, formatChange } from '../../change-event'
import { Modal } from '../../ui/Modal'

interface DiscardConfirmDialogProps {
  open: boolean
  changes: ChangeEvent[]
  onConfirm: () => void
  onCancel: () => void
}

export const DiscardConfirmDialog: Component<DiscardConfirmDialogProps> = (props) => {
  return (
    <Modal open={props.open} onClose={props.onCancel} size="md" panelClass="modal-panel--prompt">
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
        <button type="button" class="btn btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" class="btn btn-danger" onClick={props.onConfirm}>
          Yes, discard
        </button>
      </div>
    </Modal>
  )
}
