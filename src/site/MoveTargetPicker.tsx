import type { Component } from 'solid-js'
import { For } from 'solid-js'
import { Modal } from '../ui/Modal'
import { useT } from '../ui/i18n'
import type { MoveTargetPrompt } from './move-prompt'

export interface MoveTargetPickerProps {
  prompt: MoveTargetPrompt
  onClose: () => void
}

/**
 * A small modal listing the destinations for a card move (another list, or another
 * section of the current list) as buttons. Replaces the inline per-target menu
 * entries: the ⋯ context menu and the selection menus now show a single "Move to…"
 * item that opens this picker. Driven by the shared
 * {@link import('./move-prompt').pendingMovePrompt} singleton and rendered once at
 * each app root (gated by a `<Show>`), so it is always open while mounted.
 */
export const MoveTargetPicker: Component<MoveTargetPickerProps> = (props) => {
  const t = useT()
  return (
    <Modal
      open
      onClose={props.onClose}
      size="sm"
      aria-label={props.prompt.title}
      panelClass="move-picker-modal"
    >
      <div class="move-picker-header">
        <span class="move-picker-title">{props.prompt.title}</span>
        <button
          type="button"
          class="move-picker-close"
          aria-label={t('ui.dialog.close')}
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      <div class="move-picker-list">
        <For each={props.prompt.options}>
          {(option) => (
            <button
              type="button"
              class="move-picker-item"
              classList={{ 'move-picker-item--create': option.variant === 'create' }}
              onClick={() => {
                props.onClose()
                option.onSelect()
              }}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    </Modal>
  )
}
