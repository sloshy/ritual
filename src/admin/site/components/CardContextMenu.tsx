import type { Component } from 'solid-js'
import { createMemo, onMount, onCleanup, Show } from 'solid-js'
import type { ScryfallCard } from '../../../types'

const MENU_WIDTH = 180
const MENU_OFFSET = 4
const MENU_HEIGHT_ESTIMATE = 80

interface CardContextMenuProps {
  cardName: string
  card: ScryfallCard | null
  anchorRect: DOMRect
  onSetFoil: () => void
  onSetCommander?: () => void
  onUnsetCommander: () => void
  onClose: () => void
  isCommander?: boolean
  hideCommander?: boolean
}

export const CardContextMenu: Component<CardContextMenuProps> = (props) => {
  let menuRef: HTMLDivElement | undefined

  const supportsFoil = createMemo(() => props.card?.finishes?.includes('foil') ?? false)

  const menuStyle = createMemo(() => {
    const spaceBelow = window.innerHeight - props.anchorRect.bottom - MENU_OFFSET
    const top =
      spaceBelow >= MENU_HEIGHT_ESTIMATE
        ? props.anchorRect.bottom + MENU_OFFSET
        : props.anchorRect.top - MENU_HEIGHT_ESTIMATE - MENU_OFFSET
    const left = Math.min(props.anchorRect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)
    return { position: 'fixed' as const, top: `${top}px`, left: `${Math.max(left, 8)}px` }
  })

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        props.onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    })
  })

  return (
    <div
      class="card-context-menu"
      ref={menuRef!}
      style={menuStyle()}
      role="menu"
      aria-label={`Options for ${props.cardName}`}
    >
      <button
        class={`card-context-menu-item${supportsFoil() ? '' : ' card-context-menu-item--disabled'}`}
        onClick={() => {
          if (supportsFoil()) props.onSetFoil()
        }}
        disabled={!supportsFoil()}
      >
        Set as Foil
      </button>
      <Show when={!props.hideCommander}>
        <Show
          when={props.isCommander}
          fallback={
            <Show when={props.onSetCommander}>
              {(setCommander) => (
                <button class="card-context-menu-item" onClick={() => setCommander()()}>
                  Set as Commander
                </button>
              )}
            </Show>
          }
        >
          <button class="card-context-menu-item" onClick={props.onUnsetCommander}>
            Unset as Commander
          </button>
        </Show>
      </Show>
    </div>
  )
}
