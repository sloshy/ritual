import type { FunctionalComponent } from 'preact'
import type { ScryfallCard } from '../types'
import { isDoubleFacedCard, resolveCardImageSources } from './image-sources'
import { ManaCost } from './symbols'

interface CardItemProps {
  name: string
  quantity: number
  card: ScryfallCard | null
  symbolMap: Record<string, string>
  hideCount?: boolean
  useScryfallImgUrls?: boolean
  onCardClick?: () => void
  onTooltipEnter?: (src: string, sideways: boolean) => void
  onTooltipLeave?: () => void
}

export const CardItem: FunctionalComponent<CardItemProps> = ({
  name,
  quantity,
  card,
  symbolMap,
  hideCount,
  useScryfallImgUrls,
  onCardClick,
  onTooltipEnter,
  onTooltipLeave,
}) => {
  if (!card) {
    return (
      <div className="card-item">
        <div
          className="card-binder"
          style="display:flex;align-items:center;justify-content:center;aspect-ratio:488/680;background:oklch(24% 0.02 260);border-radius:0.5rem;"
        >
          <span className="text-xs text-gray-500">{name}</span>
        </div>
        <div
          className="card-list"
          style="padding:0.35rem 0.5rem;font-size:0.8rem;color:oklch(60% 0.02 260);"
        >
          {!hideCount && <span className="list-qty">{quantity}</span>}
          <span className="list-name">{name}</span>
        </div>
        <div
          className="card-overlap"
          style="aspect-ratio:488/680;background:oklch(24% 0.02 260);border-radius:0.5rem;display:flex;align-items:center;justify-content:center;"
        >
          <span className="text-xs text-gray-500">{name}</span>
        </div>
      </div>
    )
  }

  const isDFC = isDoubleFacedCard(card)
  const { frontImage } = resolveCardImageSources(card, Boolean(useScryfallImgUrls))

  const frontType = card.card_faces?.[0]?.type_line || card.type_line || ''
  const isSideways = frontType.includes('Room') || frontType.includes('Battle')

  const dataAttrs = {
    'data-name': name.toLowerCase(),
    'data-cmc': card.cmc,
    'data-edhrec': card.edhrec_rank || 999999,
    'data-price': parseFloat(card.prices.usd || '0'),
    'data-type': card.type_line,
  }

  return (
    <div className="card-item" {...dataAttrs}>
      {/* Binder view */}
      <div className="card-binder" onClick={onCardClick}>
        {frontImage && <img src={frontImage} alt={name} loading="lazy" />}
        {!hideCount && quantity > 1 && <span className="qty-badge">{quantity}x</span>}
        <span className="card-label">{name}</span>
      </div>

      {/* List view */}
      <div
        className="card-list"
        onClick={onCardClick}
        onMouseEnter={() => frontImage && onTooltipEnter?.(frontImage, isSideways)}
        onMouseLeave={() => onTooltipLeave?.()}
      >
        {!hideCount && <span className="list-qty">{quantity}</span>}
        <span className="list-name">{name}</span>
        <span className="list-mana">
          <ManaCost card={card} isDFC={isDFC} symbolMap={symbolMap} />
        </span>
        {card.prices.usd && <span className="list-price">${card.prices.usd}</span>}
      </div>

      {/* Overlap view */}
      <div className="card-overlap" onClick={onCardClick}>
        {frontImage && <img src={frontImage} alt={name} loading="lazy" />}
        {!hideCount && quantity > 1 && <span className="qty-badge">{quantity}x</span>}
        <button className="overlap-details-btn" onClick={onCardClick}>
          Details
        </button>
      </div>
    </div>
  )
}
