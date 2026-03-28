import { useEffect, useRef, useMemo } from 'preact/hooks'
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

export function CardContextMenu({
  cardName,
  card,
  anchorRect,
  onSetFoil,
  onSetCommander,
  onUnsetCommander,
  onClose,
  isCommander,
  hideCommander,
}: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const supportsFoil = card?.finishes?.includes('foil') ?? false

  const menuStyle = useMemo(() => {
    const spaceBelow = window.innerHeight - anchorRect.bottom - MENU_OFFSET
    // Flip above anchor when insufficient space below
    const top =
      spaceBelow >= MENU_HEIGHT_ESTIMATE
        ? anchorRect.bottom + MENU_OFFSET
        : anchorRect.top - MENU_HEIGHT_ESTIMATE - MENU_OFFSET
    // Right-align menu to the button's right edge; clamp so it doesn't overflow viewport
    const left = Math.min(anchorRect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)
    return { position: 'fixed' as const, top, left: Math.max(left, 8) }
  }, [anchorRect.bottom, anchorRect.top, anchorRect.right])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseRef.current()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  return (
    <div
      class="card-context-menu"
      ref={menuRef}
      style={menuStyle}
      role="menu"
      aria-label={`Options for ${cardName}`}
    >
      <button
        class={`card-context-menu-item${supportsFoil ? '' : ' card-context-menu-item--disabled'}`}
        onClick={() => {
          if (supportsFoil) onSetFoil()
        }}
        disabled={!supportsFoil}
      >
        Set as Foil
      </button>
      {!hideCommander &&
        (isCommander ? (
          <button class="card-context-menu-item" onClick={onUnsetCommander}>
            Unset as Commander
          </button>
        ) : (
          onSetCommander && (
            <button class="card-context-menu-item" onClick={onSetCommander}>
              Set as Commander
            </button>
          )
        ))}
    </div>
  )
}
