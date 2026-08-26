import { type Component, Show, For, createSignal } from 'solid-js'
import {
  type ChangeBundle,
  type ChangeBundleListRef,
  listChangesFromBundle,
  parseChangeBundle,
} from '../change-bundle'
import type { ChangeEvent } from '../../changes/change-event'
import { IMPORT_CONFLICT_REASON_KEY } from '../import-changes'
import { formatChange } from '../../changes/change-message'
import { type ListType, listTypeLabel } from '../../list/list-type'
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
  /** Display name of the list being edited — the other key a bundle may name it by. */
  expectedName?: string
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

  /**
   * Pick the changes for the list being edited out of the bundle — its own
   * entry plus the moves leaving or arriving at it, denormalized back into
   * `move-from` / `move-to` events — or an error message. A bundle that names
   * exactly one list of this kind is taken to mean this one even when its slug
   * differs (the public site slugifies names; the admin keys by basename).
   */
  const matchList = (bundle: ChangeBundle): ChangeEvent[] | string => {
    const self: ChangeBundleListRef = {
      kind: props.expectedKind,
      slug: props.expectedSlug,
      name: props.expectedName ?? '',
    }
    const own = listChangesFromBundle(bundle, self)
    if (own) return own
    const [only, ...rest] = bundle.lists.filter((l) => l.kind === props.expectedKind)
    if (only && rest.length === 0) return listChangesFromBundle(bundle, only) ?? []
    if (!only) {
      // `listTypeLabel` is the lowercase file-format vocabulary, not a display
      // name: it has no localized counterpart yet (the `domain.*` list-type
      // messages are capitalized titles, wrong mid-sentence), so this enumeration
      // stays English until one exists.
      const kinds = [...new Set(bundle.lists.map((l) => listTypeLabel(l.kind)))].join(', ')
      return t('ui.editor.importWrongKind', { listType: props.expectedKind, kinds })
    }
    return t('ui.editor.importAmbiguous', {
      listType: props.expectedKind,
      count: rest.length + 1,
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
    const matched = matchList(parsed)
    if (typeof matched === 'string') {
      setError(matched)
      return
    }
    setResult(props.onImport(matched))
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
                      <span>
                        {t('ui.editor.importConflictItem', {
                          change: formatChange(c.change),
                          reason: t(IMPORT_CONFLICT_REASON_KEY[c.reason]),
                        })}
                      </span>
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
