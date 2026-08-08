import type { Component } from 'solid-js'
import { For } from 'solid-js'
import { type ChangeEvent, isAdditiveChange } from '../../change-event'
import { formatChange } from '../../change-message'
import { Modal } from '../../ui/Modal'
import { useT } from '../../ui/i18n'

interface DiscardConfirmDialogProps {
  open: boolean
  changes: ChangeEvent[]
  onConfirm: () => void
  onCancel: () => void
}

export const DiscardConfirmDialog: Component<DiscardConfirmDialogProps> = (props) => {
  const t = useT()
  return (
    <Modal open={props.open} onClose={props.onCancel} size="md" panelClass="modal-panel--prompt">
      <h3>{t('ui.editor.discardTitle', { count: props.changes.length })}</h3>
      <p class="dialog-message">{t('ui.editor.discardMessage')}</p>
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
          {t('ui.dialog.cancel')}
        </button>
        <button type="button" class="btn btn-danger" onClick={props.onConfirm}>
          {t('ui.editor.discardConfirm')}
        </button>
      </div>
    </Modal>
  )
}
