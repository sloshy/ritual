import type { Component } from 'solid-js'
import { Show } from 'solid-js'

type EditorActionBarProps = {
  changeCount: number
  canUndo: boolean
  saving: boolean
  onShowChanges: () => void
  onUndo: () => void
  onSave: () => void
  onDiscard: () => void
}

export const EditorActionBar: Component<EditorActionBarProps> = (props) => {
  return (
    <div class="editor-action-bar">
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
  )
}
