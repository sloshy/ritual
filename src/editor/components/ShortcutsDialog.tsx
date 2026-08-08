import { type Component, For } from 'solid-js'
import { Modal } from '../../ui/Modal'
import { KeyChips } from '../../ui/KeyHints'
import { useT, useTKey } from '../../ui/i18n'
import { EDITOR_SHORTCUTS } from '../shortcuts'

type ShortcutsDialogProps = {
  open: boolean
  onClose: () => void
}

/** The editor's keyboard shortcut reference, opened by `?` or the bar's help button. */
export const ShortcutsDialog: Component<ShortcutsDialogProps> = (props) => {
  const t = useT()
  // `EDITOR_SHORTCUTS` holds message keys, resolved here so a locale switch
  // re-renders the reference instead of leaving the module-load language behind.
  const tKey = useTKey()
  return (
    <Modal open={props.open} onClose={props.onClose} size="lg" panelClass="shortcuts-dialog">
      <h3>{t('ui.shortcuts.title')}</h3>
      <div class="shortcuts-groups">
        <For each={EDITOR_SHORTCUTS}>
          {(group) => (
            <section class="shortcuts-group">
              <h4 class="shortcuts-group-title">{tKey(group.title)}</h4>
              <For each={group.hints}>
                {(hint) => (
                  <div class="shortcuts-row">
                    <span class="shortcuts-keys">
                      <KeyChips keys={hint.keys} />
                    </span>
                    <span class="shortcuts-label">{tKey(hint.label)}</span>
                  </div>
                )}
              </For>
            </section>
          )}
        </For>
      </div>
      <p class="shortcuts-note">{t('ui.shortcuts.macNote')}</p>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={props.onClose}>
          {t('ui.dialog.done')}
        </button>
      </div>
    </Modal>
  )
}
