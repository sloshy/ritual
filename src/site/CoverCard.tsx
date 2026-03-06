import type { FunctionalComponent } from 'preact'

interface CoverCardProps {
  name: string
  image: string | null
  subtitle?: string
  cardCount: number
  priceLabel: string
  secondaryPriceLabel?: string
}

export const CoverCard: FunctionalComponent<CoverCardProps> = ({
  name,
  image,
  subtitle,
  cardCount,
  priceLabel,
  secondaryPriceLabel,
}) => {
  return (
    <div className="deck-cover">
      <div className="cover-image">
        {image ? (
          <img src={image} alt={name} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            No Image
          </div>
        )}
        <div className="cover-overlay" />
        <div className="cover-info">
          <h2>{name}</h2>
          {subtitle && <p className="cover-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="cover-cardcount">
        <span>{cardCount} cards</span>
        <span className="cover-prices">
          <span>{priceLabel}</span>
          {secondaryPriceLabel && <span className="cover-lowest">low {secondaryPriceLabel}</span>}
        </span>
      </div>
    </div>
  )
}
