import type { FunctionalComponent } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
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
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRef.current()
    }
    if (open) {
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }
  }, [open])

  if (!open) return null

  return (
    <div
      class="confirm-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div class="confirm-dialog">
        <h3>
          Discard {changes.length} change{changes.length !== 1 ? 's' : ''}?
        </h3>
        <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 12px;">
          The following changes will be lost:
        </p>
        <div
          class="changes-dialog"
          style="max-height: 200px; margin-bottom: 16px; border: 1px solid var(--border); border-radius: 6px;"
        >
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
          <button class="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button class="btn-discard" onClick={onConfirm}>
            Yes, discard
          </button>
        </div>
      </div>
    </div>
  )
}
