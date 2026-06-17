import { type Component, Show, For, createSignal, createEffect } from 'solid-js'
import { type ChangeFile, type ChangeFileKind, parseChangeFile } from '../change-file'
import { formatChange } from '../../change-event'
import type { ImportResult } from '../useEditor'
import { useDialogModal } from '../../ui/useDialogModal'

type ImportChangesDialogProps = {
  open: boolean
  onClose: () => void
  /** The list kind being edited; an imported file must match it. */
  expectedKind: ChangeFileKind
  /** Apply the parsed change file's events; returns the import outcome. */
  onImport: (file: ChangeFile) => ImportResult
}

const KIND_LABELS: Record<ChangeFileKind, string> = {
  deck: 'deck',
  collection: 'collection',
  wanted: 'wanted list',
}

/**
 * Dialog to load a change-list JSON into the editor (used by the admin editor and
 * the public site's edit mode). Validates the file, loads its changes as pending
 * edits (re-targeted to current card IDs by the editor), and reports any changes
 * that could not be matched.
 */
export const ImportChangesDialog: Component<ImportChangesDialogProps> = (props) => {
  const dialog = useDialogModal(() => props.open)
  const [text, setText] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [result, setResult] = createSignal<ImportResult | null>(null)

  createEffect(() => {
    if (props.open) {
      setText('')
      setError(null)
      setResult(null)
    }
  })

  const handleFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return
    setText(await file.text())
    setError(null)
  }

  const handleImport = () => {
    setError(null)
    setResult(null)
    const parsed = parseChangeFile(text())
    if (typeof parsed === 'string') {
      setError(parsed)
      return
    }
    if (parsed.kind !== props.expectedKind) {
      setError(
        `This file is for a ${KIND_LABELS[parsed.kind]}, but you're editing a ${KIND_LABELS[props.expectedKind]}.`,
      )
      return
    }
    setResult(props.onImport(parsed))
  }

  return (
    <dialog
      ref={dialog.setDialog}
      class="discard-dialog-native"
      onClose={props.onClose}
      onClick={dialog.onBackdropClick}
    >
      <div class="confirm-dialog import-dialog">
        <h3>Import changes</h3>

        <Show when={!result()}>
          <p class="dialog-message">
            Upload or paste a change-list JSON to import into the current editor view.
          </p>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void handleFile(e.currentTarget)}
          />
          <textarea
            class="form-input import-dialog-textarea"
            placeholder="…or paste JSON here"
            rows={8}
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <Show when={error()}>
            <p class="form-error">{error()}</p>
          </Show>
          <div class="confirm-dialog-actions">
            <button type="button" class="btn btn-secondary" onClick={dialog.close}>
              Cancel
            </button>
            <button
              type="button"
              class="btn"
              disabled={text().trim() === ''}
              onClick={handleImport}
            >
              Import
            </button>
          </div>
        </Show>

        <Show when={result()}>
          {(r) => (
            <>
              <p class="dialog-message">
                Loaded {r().loaded} change{r().loaded !== 1 ? 's' : ''} as pending edits. Review
                them, then save or export.
              </p>
              <Show when={r().conflicts.length > 0}>
                <p class="form-error">
                  {r().conflicts.length} change{r().conflicts.length !== 1 ? 's' : ''} could not be
                  matched to a card in this list and {r().conflicts.length !== 1 ? 'were' : 'was'}{' '}
                  skipped:
                </p>
                <div class="changes-dialog changes-list-box">
                  <For each={r().conflicts}>
                    {(c) => (
                      <div class="change-item change-item--remove">
                        <span>{formatChange(c.change)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <div class="confirm-dialog-actions">
                <button type="button" class="btn" onClick={dialog.close}>
                  Done
                </button>
              </div>
            </>
          )}
        </Show>
      </div>
    </dialog>
  )
}
