import type { Component } from 'solid-js'
import { createMemo, onMount, onCleanup, Show } from 'solid-js'
import type { Finish, ScryfallCard } from '../../../types'

const MENU_WIDTH = 180
const MENU_OFFSET = 4
const MENU_HEIGHT_ESTIMATE = 80

interface CardContextMenuProps {
  cardName: string
  card: ScryfallCard | null
  anchorRect: DOMRect
  currentFinish?: Finish
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
  const supportsNonfoil = createMemo(() => props.card?.finishes?.includes('nonfoil') ?? false)
  const isFoilOrEtched = createMemo(
    () => props.currentFinish === 'foil' || props.currentFinish === 'etched',
  )
  const foilButtonLabel = createMemo(() => (isFoilOrEtched() ? 'Set as Nonfoil' : 'Set as Foil'))
  const foilButtonDisabled = createMemo(() =>
    isFoilOrEtched() ? !supportsNonfoil() : !supportsFoil(),
  )

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
        class={`card-context-menu-item${foilButtonDisabled() ? ' card-context-menu-item--disabled' : ''}`}
        onClick={() => {
          if (!foilButtonDisabled()) props.onSetFoil()
        }}
        disabled={foilButtonDisabled()}
      >
        {foilButtonLabel()}
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
