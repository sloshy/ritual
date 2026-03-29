import type { FunctionalComponent, ComponentChildren } from 'preact'
import type { CardData } from './card-sorting'
import type { PriceCurrency } from '../price-currency'
import { formatPrice } from '../price-currency'
import { groupTotalPrice } from './card-sorting'

interface CardSectionProps {
  label: string
  cards: CardData[]
  currency: PriceCurrency
  renderCard: (card: CardData, index: number) => ComponentChildren
}

export const CardSection: FunctionalComponent<CardSectionProps> = ({
  label,
  cards,
  currency,
  renderCard,
}) => {
  if (cards.length === 0) return null
  const sectionId = label.replace(/[^a-zA-Z0-9]/g, '_')
  const sectionTotal = groupTotalPrice(cards)
  return (
    <div key={label} data-section={label}>
      <div className="section-divider" id={sectionId}>
        <h2>
          <a
            href={`#${sectionId}`}
            className="section-header-link"
            onClick={(e) => {
              e.preventDefault()
              document
                .getElementById(sectionId)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            {label}
          </a>
        </h2>
        <span className="section-count">{cards.reduce((sum, c) => sum + c.quantity, 0)}</span>
        <span className="section-price">{formatPrice(sectionTotal, currency)}</span>
      </div>
      <div className="binder-grid">{cards.map((card, i) => renderCard(card, i))}</div>
    </div>
  )
}
