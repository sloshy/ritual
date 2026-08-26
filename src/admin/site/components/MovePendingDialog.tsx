import { type Component, For, Show } from 'solid-js'
import { formatPrintingAnnotation } from '../../../changes/change-event'
import { LIST_TYPE_DISPLAY } from '../../../list/list-type'
import type { PendingMove } from '../move-overlay'
import { Modal } from '../../../ui/Modal'
import { useT } from '../../../ui/i18n'

interface MovePendingDialogProps {
  open: boolean
  pending: PendingMove[]
  onRemove: (id: string) => void
  onDiscardAll: () => void
  onClose: () => void
}

/** `name (SET:CN) [finish]` label for a queued move's card. */
function cardLabel(move: PendingMove): string {
  return `${move.source.name}${formatPrintingAnnotation({
    set: move.dest.set,
    collectorNumber: move.dest.collectorNumber,
    finish: move.dest.finish,
    condition: move.dest.condition,
  })}`
}

/** Lists every queued move (from → to) with per-row removal, mirroring the editor's changes dialog. */
export const MovePendingDialog: Component<MovePendingDialogProps> = (props) => {
  const t = useT()
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      size="md"
      panelClass="modal-panel--prompt move-pending-dialog"
    >
      <h3>{t('admin.movePending.title', { count: props.pending.length })}</h3>
      <Show
        when={props.pending.length > 0}
        fallback={<p class="dialog-message">{t('admin.movePending.empty')}</p>}
      >
        <ul class="move-pending-list">
          <For each={props.pending}>
            {(move) => (
              <li class="move-pending-row">
                <span class="move-pending-card">{cardLabel(move)}</span>
                <span class="move-pending-route">
                  <span class="move-pending-from">
                    {LIST_TYPE_DISPLAY[move.from.type].icon} {move.from.name}
                  </span>
                  <span class="move-pending-arrow">→</span>
                  <span class="move-pending-to">
                    {LIST_TYPE_DISPLAY[move.to.type].icon} {move.to.name}
                  </span>
                </span>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm move-pending-remove"
                  onClick={() => props.onRemove(move.id)}
                  aria-label={t('admin.movePending.discardOne', { name: move.source.name })}
                >
                  {t('admin.movePending.discard')}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="confirm-dialog-actions">
        <Show when={props.pending.length > 0}>
          <button type="button" class="btn btn-danger" onClick={props.onDiscardAll}>
            {t('admin.movePending.discardAll')}
          </button>
        </Show>
        <button type="button" class="btn btn-secondary" onClick={props.onClose}>
          {t('ui.dialog.done')}
        </button>
      </div>
    </Modal>
  )
}
