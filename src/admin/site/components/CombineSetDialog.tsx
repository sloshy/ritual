import { type Component, For } from 'solid-js'
import { useDialogModal } from '../hooks/useDialogModal'

/** A candidate change set to combine into, paired with its index in the full set list. */
export type CombineCandidate = {
  index: number
  timestamp: string
  changeCount: number
}

type CombineSetDialogProps = {
  open: boolean
  /** Timestamp of the set that survives the combine, keeping its timestamp. */
  targetTimestamp: string
  candidates: CombineCandidate[]
  onSelect: (index: number) => void
  onCancel: () => void
}

/**
 * Picks which other change set to merge into the target set: the chosen set's
 * entries are appended to the target (which keeps its timestamp) and the chosen
 * set is then deleted. Mirrors the CLI `history` command's combine prompt.
 */
export const CombineSetDialog: Component<CombineSetDialogProps> = (props) => {
  const dialog = useDialogModal(() => props.open)

  return (
    <dialog
      ref={dialog.setDialog}
      class="discard-dialog-native"
      onClose={props.onCancel}
      onClick={dialog.onBackdropClick}
    >
      <div class="confirm-dialog">
        <h3>Combine change sets</h3>
        <p class="dialog-message">
          Choose a set to merge into {props.targetTimestamp}. Its entries move in and it is then
          deleted; {props.targetTimestamp} keeps its timestamp.
        </p>
        <div class="history-combine-list">
          <For each={props.candidates}>
            {(candidate) => (
              <button
                type="button"
                class="history-combine-option"
                onClick={() => props.onSelect(candidate.index)}
              >
                <span class="history-set-time">{candidate.timestamp}</span>
                <span class="history-set-count">
                  {candidate.changeCount} change{candidate.changeCount === 1 ? '' : 's'}
                </span>
              </button>
            )}
          </For>
        </div>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={dialog.close}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  )
}
