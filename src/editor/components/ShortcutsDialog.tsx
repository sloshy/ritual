import { type Component, For } from 'solid-js'
import { Modal } from '../../ui/Modal'
import { KeyChips } from '../../ui/KeyHints'
import { EDITOR_SHORTCUTS } from '../shortcuts'

type ShortcutsDialogProps = {
  open: boolean
  onClose: () => void
}

/** The editor's keyboard shortcut reference, opened by `?` or the bar's help button. */
export const ShortcutsDialog: Component<ShortcutsDialogProps> = (props) => (
  <Modal open={props.open} onClose={props.onClose} size="lg" panelClass="shortcuts-dialog">
    <h3>Keyboard Shortcuts</h3>
    <div class="shortcuts-groups">
      <For each={EDITOR_SHORTCUTS}>
        {(group) => (
          <section class="shortcuts-group">
            <h4 class="shortcuts-group-title">{group.title}</h4>
            <For each={group.hints}>
              {(hint) => (
                <div class="shortcuts-row">
                  <span class="shortcuts-keys">
                    <KeyChips keys={hint.keys} />
                  </span>
                  <span class="shortcuts-label">{hint.label}</span>
                </div>
              )}
            </For>
          </section>
        )}
      </For>
    </div>
    <p class="shortcuts-note">On macOS, use Cmd wherever Ctrl is shown.</p>
    <div class="confirm-dialog-actions">
      <button type="button" class="btn btn-secondary" onClick={props.onClose}>
        Done
      </button>
    </div>
  </Modal>
)
