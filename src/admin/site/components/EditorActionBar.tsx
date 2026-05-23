import type { Component } from 'solid-js'
import { Show, createSignal } from 'solid-js'
import type { UseEditorDefaultsResult } from '../hooks/useEditorDefaults'
import { EditorDefaultsForm } from './EditorDefaultsForm'

type EditorActionBarProps = {
  changeCount: number
  canUndo: boolean
  saving: boolean
  defaults: UseEditorDefaultsResult
  onAddCard: () => void
  onShowChanges: () => void
  onUndo: () => void
  onSave: () => void
  onDiscard: () => void
}

export const EditorActionBar: Component<EditorActionBarProps> = (props) => {
  const [defaultsOpen, setDefaultsOpen] = createSignal(false)
  // Condition is tracked for every list kind except wanted lists; derive it
  // from the defaults discriminant rather than threading a separate prop.
  const showCondition = () => props.defaults.kind !== 'wanted'

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
        <button type="button" class="btn-changes" onClick={props.onShowChanges}>
          Changes
          <Show when={props.changeCount > 0}>
            <span class="changes-badge">{props.changeCount}</span>
          </Show>
        </button>
        <button type="button" class="btn-undo" disabled={!props.canUndo} onClick={props.onUndo}>
          Undo
        </button>
        <button
          type="button"
          class="btn-save"
          disabled={props.changeCount === 0 || props.saving}
          onClick={props.onSave}
        >
          {props.saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          type="button"
          class="btn-discard"
          disabled={props.changeCount === 0}
          onClick={props.onDiscard}
        >
          Discard Changes
        </button>
      </div>
    </div>
  )
}
