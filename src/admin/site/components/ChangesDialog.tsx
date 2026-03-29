import type { FunctionalComponent } from 'preact'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import type { ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import { type ChangeEvent, isAdditiveChange, formatChange } from '../types/deck-changes'
import { useTooltip } from '../../../site/useTooltip'
import { getCardImageUrl } from '../card-utils'
import { CardModal } from '../../../site/CardModal'

interface ChangesDialogProps {
  open: boolean
  changes: ChangeEvent[]
  cards: Record<string, ScryfallCard | null>
  printings?: Record<string, ScryfallCard[]>
  symbolMap?: Record<string, string>
  useScryfallImgUrls?: boolean
  currency?: PriceCurrency
  onClose: () => void
}

export const ChangesDialog: FunctionalComponent<ChangesDialogProps> = ({
  open,
  changes,
  cards,
  printings = {},
  symbolMap = {},
  useScryfallImgUrls,
  currency = 'usd',
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const selectedCardRef = useRef<string | null>(null)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  selectedCardRef.current = selectedCard

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  // Intercept Escape: close CardModal first, then allow dialog to close
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleCancel = (e: Event) => {
      if (selectedCardRef.current) {
        e.preventDefault()
        setSelectedCard(null)
      }
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [])

  const handleBackdropClick = useCallback((e: MouseEvent) => {
    if ((e.target as Element) === dialogRef.current) dialogRef.current?.close()
  }, [])

  const modalCard = selectedCard ? (cards[selectedCard] ?? null) : null
  const modalPrintings = selectedCard ? (printings[selectedCard] ?? []) : []

  return (
    <dialog
      ref={dialogRef}
      class="changes-dialog-native"
      onClose={onClose}
      onClick={handleBackdropClick}
    >
      <div class="search-modal changes-modal">
        <div class="search-modal-header">
          <h3 class="modal-heading">Pending Changes ({changes.length})</h3>
          <button type="button" class="modal-close" onClick={() => dialogRef.current?.close()}>
            &times;
          </button>
        </div>
        <div class="changes-dialog">
          {changes.length === 0 ? (
            <div class="empty-state">No pending changes</div>
          ) : (
            changes.map((change) => {
              const additive = isAdditiveChange(change.action)
              const card = cards[change.cardName] ?? null
              const imageUrl = card ? getCardImageUrl(card) : null
              return (
                <div
                  key={change.id}
                  class={`change-item ${additive ? 'change-item--add' : 'change-item--remove'}`}
                >
                  <span class="change-item-icon">{additive ? '+' : '−'}</span>
                  <ChangeText
                    change={change}
                    onCardClick={() => setSelectedCard(change.cardName)}
                    onHoverEnter={() =>
                      imageUrl ? setTooltip({ src: imageUrl, sideways: false }) : undefined
                    }
                    onHoverLeave={() => setTooltip(null)}
                  />
                  {change.cardId !== undefined && (
                    <span class="change-item-id">&amp;{change.cardId}</span>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Card hover tooltip — rendered outside modal div to avoid clipping */}
      <div
        ref={tooltipRef}
        class={`changes-card-tooltip ${tooltip ? 'visible' : ''}`}
        style={`left:${tooltipPos.left}px;top:${tooltipPos.top}px;`}
      >
        {tooltip && <img src={tooltip.src} alt="" />}
      </div>

      {/* Card detail modal opened from change item */}
      <CardModal
        key={selectedCard ?? ''}
        open={Boolean(modalCard)}
        card={modalCard}
        cardName={selectedCard}
        symbolMap={symbolMap}
        useScryfallImgUrls={useScryfallImgUrls}
        currency={currency}
        printings={modalPrintings}
        onClose={() => setSelectedCard(null)}
        backdropClass="changelog-card-modal"
      />
    </dialog>
  )
}

type ChangeTextProps = {
  change: ChangeEvent
  onCardClick: () => void
  onHoverEnter: () => void
  onHoverLeave: () => void
}

function ChangeText({ change, onCardClick, onHoverEnter, onHoverLeave }: ChangeTextProps) {
  const formatted = formatChange(change)
  const cardName = change.cardName
  const idx = formatted.indexOf(cardName)
  if (idx === -1) {
    return <span>{formatted}</span>
  }
  const before = formatted.slice(0, idx)
  const after = formatted.slice(idx + cardName.length)
  return (
    <span>
      {before}
      <a
        href="#"
        class="changelog-card-link"
        onClick={(e: Event) => {
          e.preventDefault()
          e.stopPropagation()
          onCardClick()
        }}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
      >
        {cardName}
      </a>
      {after}
    </span>
  )
}
