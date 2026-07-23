import { type Component, type JSX, For, Show, createSignal, createMemo, onCleanup } from 'solid-js'
import type { UseEditorDefaultsResult } from '../useEditorDefaults'
import type { SectionInfo } from '../useEditor'
import { EditorDefaultsForm } from './EditorDefaultsForm'
import { Modal } from '../../ui/Modal'

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
  /** Opens the keyboard shortcuts reference (also bound to `?`). */
  onShowShortcuts: () => void
  /** When provided, shows an "Import…" button (admin only) to load an exported change file. */
  onImport?: () => void
  /** Show the primary Save button. Defaults to true; the public editor exports via its banner instead. */
  showSave?: boolean
  /** Show the Discard button. Defaults to true; the public editor discards via its banner instead. */
  showDiscard?: boolean
  /**
   * Ref for the bar element itself — used by the Ctrl+B shortcut to focus its
   * first button. Called with `undefined` when the bar unmounts (the editor
   * hides it while a list loads), so the owner never holds a detached node.
   */
  barRef?: (el: HTMLDivElement | undefined) => void
}

/** The bar's enabled buttons, in visual order. */
function barButtons(bar: HTMLElement): HTMLButtonElement[] {
  return [...bar.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
}

/**
 * Move focus to the first enabled button of `bar`. Exported so the editor shell
 * can drive it from a keyboard shortcut without reaching into the bar's markup.
 */
export function focusActionBar(bar: HTMLElement | undefined): void {
  if (!bar) return
  barButtons(bar)[0]?.focus()
}

export const EditorActionBar: Component<EditorActionBarProps> = (props) => {
  const [defaultsOpen, setDefaultsOpen] = createSignal(false)
  const [sectionsOpen, setSectionsOpen] = createSignal(false)
  const [newSectionName, setNewSectionName] = createSignal('')
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

  const closeSections = () => {
    setNewSectionName('')
    setSectionsOpen(false)
  }

  /**
   * Roving keyboard navigation once focus is in the bar (typically via Ctrl+B):
   * ←/→ wrap between buttons, Esc gives focus back to the page. Tab still walks
   * the buttons natively.
   */
  const handleBarKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (e) => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !e.currentTarget.contains(active)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      active.blur()
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const buttons = barButtons(e.currentTarget)
    const index = buttons.findIndex((button) => button === active)
    if (index === -1) return
    e.preventDefault()
    const delta = e.key === 'ArrowRight' ? 1 : buttons.length - 1
    buttons[(index + delta) % buttons.length]?.focus()
  }

  return (
    <div class="editor-action-dock">
      <Show when={defaultsOpen()}>
        <div class="editor-action-defaults">
          <EditorDefaultsForm defaults={props.defaults} showCondition={showCondition()} />
        </div>
      </Show>
      <div
        class="editor-action-bar"
        ref={(el) => {
          props.barRef?.(el)
          onCleanup(() => props.barRef?.(undefined))
        }}
        onKeyDown={handleBarKeyDown}
      >
        <button
          type="button"
          class="btn-add"
          title="Add a card (Ctrl+Enter)"
          onClick={props.onAddCard}
        >
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
            class="btn btn-danger"
            disabled={props.changeCount === 0}
            onClick={props.onDiscard}
          >
            Discard Changes
          </button>
        </Show>
        <button
          type="button"
          class="btn-shortcuts"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={props.onShowShortcuts}
        >
          ?
        </button>
      </div>

      <Modal
        open={sectionsOpen()}
        onClose={closeSections}
        size="md"
        panelClass="modal-panel--prompt section-manager"
      >
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
          <button type="button" class="btn btn-secondary" onClick={closeSections}>
            Done
          </button>
        </div>
      </Modal>
    </div>
  )
}
