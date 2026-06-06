import { type Component, For, Show, createSignal, createEffect, createMemo } from 'solid-js'
import type { UseEditorDefaultsResult } from '../useEditorDefaults'
import type { SectionInfo } from '../useEditor'
import { EditorDefaultsForm } from './EditorDefaultsForm'

type EditorActionBarProps = {
  changeCount: number
  canUndo: boolean
  saving: boolean
  defaults: UseEditorDefaultsResult
  sections: SectionInfo[]
  onAddCard: () => void
  onShowChanges: () => void
  onUndo: () => void
  onSave: () => void
  onDiscard: () => void
  onAddSection: (name: string) => void
  onRequestRename: (name: string) => void
  onRemoveSection: (name: string) => void
  /** When provided, shows an "Import…" button (admin only) to load an exported change file. */
  onImport?: () => void
  /** Show the primary Save button. Defaults to true; the public editor exports via its banner instead. */
  showSave?: boolean
  /** Show the Discard button. Defaults to true; the public editor discards via its banner instead. */
  showDiscard?: boolean
}

export const EditorActionBar: Component<EditorActionBarProps> = (props) => {
  const [defaultsOpen, setDefaultsOpen] = createSignal(false)
  const [sectionsOpen, setSectionsOpen] = createSignal(false)
  const [newSectionName, setNewSectionName] = createSignal('')
  let sectionsDialogRef: HTMLDialogElement | undefined
  // Condition is tracked for every list kind except wanted lists; derive it
  // from the defaults discriminant rather than threading a separate prop.
  const showCondition = () => props.defaults.kind !== 'wanted'

  const trimmedName = () => newSectionName().trim()
  // The existing section whose name matches the draft case-insensitively (its canonical casing),
  // or undefined when the draft is free. Drives the duplicate highlight and the disabled state.
  const duplicateOf = createMemo(() => {
    const lower = trimmedName().toLowerCase()
    if (!lower) return undefined
    return props.sections.find((s) => s.name.toLowerCase() === lower)?.name
  })
  const canAddSection = () => trimmedName() !== '' && !duplicateOf()

  const submitNewSection = () => {
    if (!canAddSection()) return
    props.onAddSection(trimmedName())
    setNewSectionName('')
  }

  // Drive the native <dialog> from the open signal, matching the other editor dialogs.
  createEffect(() => {
    const dialog = sectionsDialogRef
    if (!dialog) return
    if (sectionsOpen() && !dialog.open) dialog.showModal()
    else if (!sectionsOpen() && dialog.open) dialog.close()
  })

  const closeSections = () => {
    setNewSectionName('')
    setSectionsOpen(false)
  }

  const handleSectionsBackdropClick = (e: MouseEvent) => {
    if ((e.target as Element) === sectionsDialogRef) sectionsDialogRef?.close()
  }

  return (
    <div class="editor-action-dock">
      <Show when={defaultsOpen()}>
        <div class="editor-action-defaults">
          <EditorDefaultsForm defaults={props.defaults} showCondition={showCondition()} />
        </div>
      </Show>
      <div class="editor-action-bar">
        <button type="button" class="btn-add" onClick={props.onAddCard}>
          + Add Card
        </button>
        <button
          type="button"
          class="btn-defaults"
          aria-expanded={defaultsOpen()}
          onClick={() => setDefaultsOpen((v) => !v)}
        >
          <span class="btn-defaults-caret">{defaultsOpen() ? '▾' : '▴'}</span>
          Add Card Defaults
          <Show when={props.defaults.hasActive()}>
            <span class="btn-defaults-dot" aria-label="defaults active" />
          </Show>
        </button>
        <button type="button" class="btn-sections" onClick={() => setSectionsOpen(true)}>
          Sections
        </button>
        <Show when={props.onImport}>
          <button type="button" class="btn-import" onClick={() => props.onImport!()}>
            Import…
          </button>
        </Show>
        <button type="button" class="btn-changes" onClick={props.onShowChanges}>
          Changes
          <Show when={props.changeCount > 0}>
            <span class="changes-badge">{props.changeCount}</span>
          </Show>
        </button>
        <button type="button" class="btn-undo" disabled={!props.canUndo} onClick={props.onUndo}>
          Undo
        </button>
        <Show when={props.showSave ?? true}>
          <button
            type="button"
            class="btn-save"
            disabled={props.changeCount === 0 || props.saving}
            onClick={props.onSave}
          >
            {props.saving ? 'Saving...' : 'Save Changes'}
          </button>
        </Show>
        <Show when={props.showDiscard ?? true}>
          <button
            type="button"
            class="btn-discard"
            disabled={props.changeCount === 0}
            onClick={props.onDiscard}
          >
            Discard Changes
          </button>
        </Show>
      </div>

      <dialog
        ref={sectionsDialogRef}
        class="discard-dialog-native"
        onClose={closeSections}
        onClick={handleSectionsBackdropClick}
      >
        <div class="confirm-dialog section-manager">
          <h3>Manage Sections</h3>
          <p class="dialog-message">
            Sections group cards on the list page. Names must be unique (case-insensitive).
          </p>

          <div class="section-manager-add">
            <input
              type="text"
              class={`form-input section-manager-input${duplicateOf() ? ' form-input--invalid' : ''}`}
              placeholder="New section name"
              aria-invalid={duplicateOf() ? 'true' : undefined}
              value={newSectionName()}
              onInput={(e) => setNewSectionName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitNewSection()
                }
              }}
            />
            <button
              type="button"
              class="btn section-manager-add-btn"
              disabled={!canAddSection()}
              onClick={submitNewSection}
            >
              Add Section
            </button>
          </div>
          <Show when={duplicateOf()}>
            {(name) => <p class="form-error">A section named “{name()}” already exists.</p>}
          </Show>

          <ul class="section-manager-list">
            <For each={props.sections}>
              {(section) => (
                <li
                  class={`section-manager-row${duplicateOf() === section.name ? ' section-manager-row--clash' : ''}`}
                >
                  <span class="section-manager-name">{section.name}</span>
                  <span class="section-manager-count">{section.count}</span>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm section-manager-rename"
                    onClick={() => props.onRequestRename(section.name)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm section-manager-delete"
                    disabled={section.count > 0}
                    title={section.count > 0 ? 'Only empty sections can be deleted' : undefined}
                    onClick={() => props.onRemoveSection(section.name)}
                  >
                    Delete
                  </button>
                </li>
              )}
            </For>
          </ul>

          <div class="confirm-dialog-actions">
            <button
              type="button"
              class="btn btn-secondary"
              onClick={() => sectionsDialogRef?.close()}
            >
              Done
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
