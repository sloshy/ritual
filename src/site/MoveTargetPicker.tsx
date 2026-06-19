import type { Component } from 'solid-js'
import { For, onMount, onCleanup } from 'solid-js'
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
 * each app root, above the selection modal.
 */
export const MoveTargetPicker: Component<MoveTargetPickerProps> = (props) => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose()
  }
  // The picker only exists in the tree while a prompt is active (it is gated by a
  // <Show when={pendingMovePrompt()}> at the app root), so mount/unmount is the right
  // lifecycle for the Escape listener — no need to gate it on an `open` prop.
  onMount(() => document.addEventListener('keydown', onKey))
  onCleanup(() => document.removeEventListener('keydown', onKey))

  return (
    <div class="move-picker-overlay" onClick={props.onClose}>
      <div
        class="move-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.prompt.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="move-picker-header">
          <span class="move-picker-title">{props.prompt.title}</span>
          <button
            type="button"
            class="move-picker-close"
            aria-label="Close"
            onClick={props.onClose}
          >
            ✕
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
      </div>
    </div>
  )
}
