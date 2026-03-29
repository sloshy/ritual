import type { FunctionalComponent } from 'preact'
import { useEffect, useRef, useCallback } from 'preact/hooks'
import { type ChangeEvent, isAdditiveChange, formatChange } from '../types/deck-changes'

interface DiscardConfirmDialogProps {
  open: boolean
  changes: ChangeEvent[]
  onConfirm: () => void
  onCancel: () => void
}

export const DiscardConfirmDialog: FunctionalComponent<DiscardConfirmDialogProps> = ({
  open,
  changes,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const handleBackdropClick = useCallback((e: MouseEvent) => {
    if ((e.target as Element) === dialogRef.current) dialogRef.current?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      class="discard-dialog-native"
      onClose={onCancel}
      onClick={handleBackdropClick}
    >
      <div class="confirm-dialog">
        <h3>
          Discard {changes.length} change{changes.length !== 1 ? 's' : ''}?
        </h3>
        <p class="dialog-message">The following changes will be lost:</p>
        <div class="changes-dialog changes-list-box">
          {changes.map((change) => {
            const additive = isAdditiveChange(change.action)
            return (
              <div
                key={change.id}
                class={`change-item ${additive ? 'change-item--add' : 'change-item--remove'}`}
              >
                <span class="change-item-icon">{additive ? '+' : '−'}</span>
                <span>{formatChange(change)}</span>
              </div>
            )
          })}
        </div>
        <div class="confirm-dialog-actions">
          <button
            type="button"
            class="btn btn-secondary"
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </button>
          <button type="button" class="btn-discard" onClick={onConfirm}>
            Yes, discard
          </button>
        </div>
      </div>
    </dialog>
  )
}
