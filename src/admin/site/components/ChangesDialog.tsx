import type { FunctionalComponent } from 'preact'
import { useState, useEffect, useRef, useMemo } from 'preact/hooks'
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
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()
  const [selectedCard, setSelectedCard] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedCard) {
          setSelectedCard(null)
        } else {
          onCloseRef.current()
        }
      }
    }
    if (open) {
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }
  }, [open, selectedCard])

  const modalCard = useMemo(() => {
    if (!selectedCard) return null
    return cards[selectedCard] ?? null
  }, [selectedCard, cards])

  const modalPrintings = useMemo(() => {
    if (!selectedCard) return []
    return printings[selectedCard] ?? []
  }, [selectedCard, printings])

  if (!open) return null

  return (
    <div
      className="search-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="search-modal" style="max-width: 500px;">
        <div className="search-modal-header">
          <h3 style="margin: 0; font-size: 1rem; font-weight: 700;">
            Pending Changes ({changes.length})
          </h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="changes-dialog">
          {changes.length === 0 ? (
            <div style="padding: 24px; text-align: center; color: var(--text-muted);">
              No pending changes
            </div>
          ) : (
            changes.map((change) => {
              const additive = isAdditiveChange(change.action)
              const card = cards[change.cardName] ?? null
              const imageUrl = card ? getCardImageUrl(card) : null
              return (
                <div
                  key={change.id}
                  className={`change-item ${additive ? 'change-item--add' : 'change-item--remove'}`}
                >
                  <span className="change-item-icon">{additive ? '+' : '−'}</span>
                  <ChangeText
                    change={change}
                    onCardClick={() => setSelectedCard(change.cardName)}
                    onHoverEnter={() =>
                      imageUrl ? setTooltip({ src: imageUrl, sideways: false }) : undefined
                    }
                    onHoverLeave={() => setTooltip(null)}
                  />
                  {change.cardId !== undefined && (
                    <span className="change-item-id">&amp;{change.cardId}</span>
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
        className={`changes-card-tooltip ${tooltip ? 'visible' : ''}`}
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
    </div>
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
