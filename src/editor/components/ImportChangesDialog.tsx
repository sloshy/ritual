import { type Component, Show, For, createSignal } from 'solid-js'
import { type ChangeBundleList, parseChangeBundle } from '../change-bundle'
import type { ChangeEvent } from '../../change-event'
import { formatChange } from '../../change-message'
import { type ListType, listTypeLabel } from '../../list-type'
import type { ImportResult } from '../useEditor'
import { Modal } from '../../ui/Modal'
import { useT } from '../../ui/i18n'

type ImportChangesDialogProps = {
  open: boolean
  onClose: () => void
  /** The list kind being edited; an imported file must match it. */
  expectedKind: ListType
  /** Slug of the list being edited, to pick the right entry out of a multi-list bundle. */
  expectedSlug?: string
  /** Apply the matched change list's events; returns the import outcome. */
  onImport: (changes: ChangeEvent[]) => ImportResult
}

/**
 * Dialog to load a change-list JSON into the editor (used by the admin editor and
 * the public site's edit mode). The entry for the list being edited is picked
 * out of the bundle (the rest must be applied via the admin Import Changes page
 * or `ritual import-changes`). Validates the bundle, loads its changes as pending
 * edits (re-targeted to current card IDs by the editor), and reports any changes
 * that could not be matched.
 */
export const ImportChangesDialog: Component<ImportChangesDialogProps> = (props) => {
  const [text, setText] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [result, setResult] = createSignal<ImportResult | null>(null)
  const t = useT()

  const handleFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return
    setText(await file.text())
    setError(null)
  }

  /** Pick the bundle entry for the list being edited, or an error message. */
  const matchList = (lists: ChangeBundleList[]): ChangeBundleList | string => {
    const kindMatches = lists.filter((l) => l.kind === props.expectedKind)
    if (kindMatches.length === 0) {
      // `listTypeLabel` is the lowercase file-format vocabulary, not a display
      // name: it has no localized counterpart yet (the `domain.*` list-type
      // messages are capitalized titles, wrong mid-sentence), so this enumeration
      // stays English until one exists.
      const kinds = [...new Set(lists.map((l) => listTypeLabel(l.kind)))].join(', ')
      return t('ui.editor.importWrongKind', { listType: props.expectedKind, kinds })
    }
    const slugMatch = kindMatches.find((l) => l.slug === props.expectedSlug)
    if (slugMatch) return slugMatch
    if (kindMatches.length === 1) return kindMatches[0]!
    return t('ui.editor.importAmbiguous', {
      listType: props.expectedKind,
      count: kindMatches.length,
      command: '`ritual import-changes`',
    })
  }

  const handleImport = () => {
    setError(null)
    setResult(null)
    const parsed = parseChangeBundle(text())
    if (typeof parsed === 'string') {
      setError(parsed)
      return
    }
    const matched = matchList(parsed.lists)
    if (typeof matched === 'string') {
      setError(matched)
      return
    }
    setResult(props.onImport(matched.changes))
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      size="md"
      panelClass="modal-panel--prompt import-dialog"
      onOpen={() => {
        setText('')
        setError(null)
        setResult(null)
      }}
    >
      <h3>{t('ui.editor.importTitle')}</h3>

      <Show when={!result()}>
        <p class="dialog-message">{t('ui.editor.importPrompt')}</p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => void handleFile(e.currentTarget)}
        />
        <textarea
          class="form-input import-dialog-textarea"
          placeholder={t('ui.editor.importPastePlaceholder')}
          rows={8}
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <Show when={error()}>
          <p class="form-error">{error()}</p>
        </Show>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={props.onClose}>
            {t('ui.dialog.cancel')}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={text().trim() === ''}
            onClick={handleImport}
          >
            {t('ui.editor.importAction')}
          </button>
        </div>
      </Show>

      <Show when={result()}>
        {(r) => (
          <>
            <p class="dialog-message">{t('ui.editor.importLoaded', { count: r().loaded })}</p>
            <Show when={r().conflicts.length > 0}>
              <p class="form-error">
                {t('ui.editor.importConflicts', { count: r().conflicts.length })}
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
              <button type="button" class="btn btn-primary" onClick={props.onClose}>
                {t('ui.dialog.done')}
              </button>
            </div>
          </>
        )}
      </Show>
    </Modal>
  )
}
