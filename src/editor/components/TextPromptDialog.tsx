import { type Component, createMemo, createSignal, Show } from 'solid-js'
import { Modal } from '../../ui/Modal'

type TextPromptDialogProps = {
  open: boolean
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  /** Returns an error message for an invalid value, or null when acceptable. */
  validate?: (value: string) => string | null
  onConfirm: (value: string) => void
  onCancel: () => void
}

/**
 * A small styled text-input modal — the in-app replacement for `window.prompt`. Used for naming a
 * new section or renaming one, with live validation and a disabled confirm while invalid/empty.
 */
export const TextPromptDialog: Component<TextPromptDialogProps> = (props) => {
  let inputRef: HTMLInputElement | undefined
  const [value, setValue] = createSignal('')

  const error = createMemo(() => props.validate?.(value()) ?? null)
  const canConfirm = () => error() === null && value().trim() !== ''
  // Surface the message only once the user has typed, so an empty field isn't pre-flagged.
  const showError = () => error() !== null && value().trim() !== ''

  const confirm = () => {
    if (canConfirm()) props.onConfirm(value())
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onCancel}
      size="md"
      panelClass="modal-panel--prompt text-prompt"
      // Seed the draft and focus the input when the dialog opens.
      onOpen={() => {
        setValue(props.initialValue)
        // Defer a microtask so the seeded value lands and the dialog is in the
        // top layer before we focus and select the input.
        queueMicrotask(() => {
          inputRef?.focus()
          inputRef?.select()
        })
      }}
    >
      <h3>{props.title}</h3>
      <div class="text-prompt-field">
        <label class="text-prompt-label" for="text-prompt-input">
          {props.label}
        </label>
        <input
          id="text-prompt-input"
          ref={inputRef}
          type="text"
          class={`form-input${showError() ? ' form-input--invalid' : ''}`}
          value={value()}
          aria-invalid={showError() ? 'true' : undefined}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              confirm()
            }
          }}
        />
        <Show when={showError()}>
          <p class="form-error">{error()}</p>
        </Show>
      </div>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" class="btn btn-primary" disabled={!canConfirm()} onClick={confirm}>
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
