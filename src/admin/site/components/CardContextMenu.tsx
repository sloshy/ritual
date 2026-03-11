import { useEffect, useRef } from 'preact/hooks'
import type { ScryfallCard } from '../../../types'

interface CardContextMenuProps {
  cardName: string
  card: ScryfallCard | null
  onSetFoil: () => void
  onSetCommander: () => void
  onClose: () => void
  hideCommander?: boolean
}

export function CardContextMenu({
  cardName: _cardName,
  card,
  onSetFoil,
  onSetCommander,
  onClose,
  hideCommander,
}: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const supportsFoil = card?.finishes?.includes('foil') ?? false

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
    <div class="card-context-menu" ref={menuRef}>
      <button
        class={`card-context-menu-item${supportsFoil ? '' : ' card-context-menu-item--disabled'}`}
        onClick={() => {
          if (supportsFoil) onSetFoil()
        }}
        disabled={!supportsFoil}
      >
        Set as Foil
      </button>
      {!hideCommander && (
        <button class="card-context-menu-item" onClick={onSetCommander}>
          Set as Commander
        </button>
      )}
    </div>
  )
}
