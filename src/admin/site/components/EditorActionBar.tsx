type EditorActionBarProps = {
  changeCount: number
  canUndo: boolean
  saving: boolean
  onShowChanges: () => void
  onUndo: () => void
  onSave: () => void
  onDiscard: () => void
}

export function EditorActionBar({
  changeCount,
  canUndo,
  saving,
  onShowChanges,
  onUndo,
  onSave,
  onDiscard,
}: EditorActionBarProps) {
  return (
    <div class="editor-action-bar">
      <button class="btn-changes" onClick={onShowChanges}>
        Changes
        {changeCount > 0 && <span class="changes-badge">{changeCount}</span>}
      </button>
      <button class="btn-undo" disabled={!canUndo} onClick={onUndo}>
        Undo
      </button>
      <button class="btn-save" disabled={changeCount === 0 || saving} onClick={onSave}>
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
      <button class="btn-discard" disabled={changeCount === 0} onClick={onDiscard}>
        Discard Changes
      </button>
    </div>
  )
}
