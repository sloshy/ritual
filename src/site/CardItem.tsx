import type { FunctionalComponent } from 'preact'
import type { JSX } from 'preact'
import type { ScryfallCard } from '../types'
import { isDoubleFacedCard, resolveCardImageSources } from './image-sources'
import { ManaCost } from './symbols'
import type { PriceCurrency } from '../price-currency'
import { getCardPrice, formatPrice } from '../price-currency'
import type { ViewMode } from './card-sorting'
import { capitalize } from './utils'

/** Wraps a callback with stopPropagation so click events don't bubble to the card container. */
const stopPropAnd =
  (fn?: () => void): JSX.MouseEventHandler<HTMLButtonElement> =>
  (e) => {
    e.stopPropagation()
    fn?.()
  }

/** Like stopPropAnd but passes the button's bounding rect to the callback. */
const stopPropAndRect =
  (fn?: (rect: DOMRect) => void): JSX.MouseEventHandler<HTMLButtonElement> =>
  (e) => {
    e.stopPropagation()
    fn?.(e.currentTarget.getBoundingClientRect())
  }

export interface CardItemProps {
  name: string
  quantity: number
  card: ScryfallCard | null
  symbolMap: Record<string, string>
  viewMode: ViewMode
  hideCount?: boolean
  useScryfallImgUrls?: boolean
  onCardClick?: () => void
  onTooltipEnter?: (src: string, sideways: boolean) => void
  onTooltipLeave?: () => void
  collectionFinish?: string
  collectionCondition?: string
  collectionSetCN?: string
  collectionPrice?: number
  currency?: PriceCurrency
  editMode?: boolean
  onIncrement?: () => void
  onDecrement?: () => void
  onContextMenu?: (rect: DOMRect) => void
}

export const CardItem: FunctionalComponent<CardItemProps> = ({
  name,
  quantity,
  card,
  symbolMap,
  viewMode,
  hideCount,
  useScryfallImgUrls,
  onCardClick,
  onTooltipEnter,
  onTooltipLeave,
  collectionFinish,
  collectionCondition,
  collectionSetCN,
  collectionPrice,
  currency = 'usd',
  editMode,
  onIncrement,
  onDecrement,
  onContextMenu,
}) => {
  if (!card) {
    return (
      <div className="card-item">
        {viewMode === 'binder' && (
          <div className="card-binder card-binder--empty">
            <span className="text-xs text-gray-500">{name}</span>
          </div>
        )}
        {viewMode === 'list' && (
          <div className="card-list card-list--empty">
            {!hideCount && <span className="list-qty">{quantity}</span>}
            <span className="list-name">{name}</span>
          </div>
        )}
        {(viewMode === 'overlap' || viewMode === 'stack') && (
          <div className="card-overlap card-overlap--empty">
            <span className="text-xs text-gray-500">{name}</span>
          </div>
        )}
      </div>
    )
  }

  const isDFC = isDoubleFacedCard(card)
  const { frontImage } = resolveCardImageSources(card, Boolean(useScryfallImgUrls))

  const frontType = card.card_faces?.[0]?.type_line ?? card.type_line ?? ''
  const isSideways = frontType.includes('Room') || frontType.includes('Battle')

  const price = getCardPrice(card, currency)

  const dataAttrs = {
    'data-name': name.toLowerCase(),
    'data-cmc': card.cmc,
    'data-edhrec': card.edhrec_rank ?? 999999,
    'data-price': price,
    'data-type': card.type_line,
  }

  const isFoil = collectionFinish
    ? collectionFinish !== 'nonfoil'
    : card.finishes?.length === 1 && card.finishes[0] !== 'nonfoil'

  const rawFinish =
    collectionFinish && collectionFinish !== 'nonfoil'
      ? collectionFinish
      : !collectionFinish && card.finishes?.length === 1 && card.finishes[0] !== 'nonfoil'
        ? card.finishes[0]
        : null
  const finishLabel = rawFinish ? capitalize(rawFinish) : null

  const binderClass = `card-binder${isFoil ? ' foil-card' : ''}`
  const displayPrice = collectionPrice !== undefined ? collectionPrice : price
  const showPrice = displayPrice > 0

  return (
    <div className="card-item" {...dataAttrs}>
      {/* Binder view */}
      {viewMode === 'binder' && (
        <div className={binderClass} onClick={onCardClick}>
          {frontImage && <img src={frontImage} alt={name} loading="lazy" />}
          {!hideCount && quantity > 1 && <span className="qty-badge">{quantity}x</span>}
          {editMode && (
            <div className="edit-overlay">
              <button
                className="edit-btn edit-btn-increment"
                onClick={stopPropAnd(onIncrement)}
                title="Add copy"
              >
                +
              </button>
              <button
                className="edit-btn edit-btn-decrement"
                onClick={stopPropAnd(onDecrement)}
                title="Remove copy"
              >
                −
              </button>
              <button
                className="edit-btn edit-btn-context"
                onClick={stopPropAndRect(onContextMenu)}
                title="More options"
              >
                ⋯
              </button>
            </div>
          )}
          <div className="card-label">
            <span className="card-label-name">
              {name}
              {finishLabel && <span className="card-label-finish"> ({finishLabel})</span>}
            </span>
            {showPrice && (
              <span className="card-label-price">{formatPrice(displayPrice, currency)}</span>
            )}
          </div>
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <div
          className="card-list"
          onClick={onCardClick}
          onMouseEnter={() => frontImage && onTooltipEnter?.(frontImage, isSideways)}
          onMouseLeave={() => onTooltipLeave?.()}
        >
          {!hideCount && <span className="list-qty">{quantity}</span>}
          <span className="list-name">{name}</span>
          {collectionSetCN && <span className="list-set-cn">{collectionSetCN}</span>}
          {collectionFinish && collectionFinish !== 'nonfoil' && (
            <span className="list-finish">{collectionFinish}</span>
          )}
          {collectionCondition && <span className="list-condition">{collectionCondition}</span>}
          <span className="list-mana">
            <ManaCost card={card} isDFC={isDFC} symbolMap={symbolMap} />
          </span>
          {editMode && (
            <span className="edit-controls-list">
              <button className="edit-btn-list" onClick={stopPropAnd(onIncrement)} title="Add copy">
                +
              </button>
              <button
                className="edit-btn-list"
                onClick={stopPropAnd(onDecrement)}
                title="Remove copy"
              >
                −
              </button>
              <button
                className="edit-btn-list"
                onClick={stopPropAndRect(onContextMenu)}
                title="More options"
              >
                ⋯
              </button>
            </span>
          )}
          {showPrice && <span className="list-price">{formatPrice(displayPrice, currency)}</span>}
        </div>
      )}

      {/* Overlap / Stack view */}
      {(viewMode === 'overlap' || viewMode === 'stack') && (
        <div className="card-overlap" onClick={onCardClick}>
          {frontImage && <img src={frontImage} alt={name} loading="lazy" />}
          {!hideCount && quantity > 1 && <span className="qty-badge">{quantity}x</span>}
          {editMode && (
            <div className="edit-overlay">
              <button
                className="edit-btn edit-btn-increment"
                onClick={stopPropAnd(onIncrement)}
                title="Add copy"
              >
                +
              </button>
              <button
                className="edit-btn edit-btn-decrement"
                onClick={stopPropAnd(onDecrement)}
                title="Remove copy"
              >
                −
              </button>
              <button
                className="edit-btn edit-btn-context"
                onClick={stopPropAndRect(onContextMenu)}
                title="More options"
              >
                ⋯
              </button>
            </div>
          )}
          <div className="card-label">
            <span className="card-label-name">
              {name}
              {finishLabel && <span className="card-label-finish"> ({finishLabel})</span>}
            </span>
            {showPrice && (
              <span className="card-label-price">{formatPrice(displayPrice, currency)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
