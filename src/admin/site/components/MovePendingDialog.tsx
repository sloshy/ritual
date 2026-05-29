import { type Component, For, Show, createEffect } from 'solid-js'
import { formatPrintingAnnotation } from '../../../change-event'
import { LIST_TYPE_DISPLAY } from '../../../list-type'
import type { PendingMove } from '../move-overlay'

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
      onClose={props.onClose}
      onClick={handleBackdropClick}
    >
      <div class="confirm-dialog move-pending-dialog">
        <h3>Pending moves ({props.pending.length})</h3>
        <Show
          when={props.pending.length > 0}
          fallback={<p class="dialog-message">No moves queued yet.</p>}
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
                    aria-label={`Discard move of ${move.source.name}`}
                  >
                    Discard
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="confirm-dialog-actions">
          <Show when={props.pending.length > 0}>
            <button type="button" class="btn btn-danger" onClick={props.onDiscardAll}>
              Discard all
            </button>
          </Show>
          <button type="button" class="btn btn-secondary" onClick={() => dialogRef?.close()}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}
