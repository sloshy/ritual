import type { FunctionalComponent } from 'preact'
import type { ScryfallCard } from '../types'
import classNames from 'classnames'

interface CardItemProps {
  name: string
  quantity: number
  card: ScryfallCard | null
  symbolMap: Record<string, string>
  hideCount?: boolean
}

export const CardItem: FunctionalComponent<CardItemProps> = ({
  name,
  quantity,
  card,
  symbolMap,
  hideCount,
}) => {
  const renderMana = (cost: string) => {
    if (!cost) return null
    const parts = cost.split(/(\{.*?\})/g)
    return parts.map((part, i) => {
      if (symbolMap[part]) {
        return (
          <img key={i} src={symbolMap[part]} alt={part} className="inline-block h-4 w-4 mx-0.5" />
        )
      }
      if (!part) return null
      return <span key={i}>{part}</span>
    })
  }

  if (!card) {
    return (
      <div className="p-2 border border-gray-700 rounded bg-gray-800">
        <span className="font-bold text-gray-400">
          {!hideCount && `${quantity}x`} {name} (Loading...)
        </span>
      </div>
    )
  }

  // True Double-Faced Cards have image_uris on faces but not top-level.
  // Split/Room cards have top-level image_uris, so they are effectively single-faced.
  const isDFC = !card.image_uris && card.card_faces && card.card_faces[0] && card.card_faces[1]

  let frontImage = card.image_uris?.normal ? `images/${card.id}.jpg` : ''
  let backImage = ''
  if (isDFC) {
    frontImage = `images/${card.id}.jpg`
    backImage = `images/${card.id}_back.jpg`
  } else if (card.image_uris?.normal) {
    frontImage = `images/${card.id}.jpg`
  }

  // Rotate Room cards (sideways text) and Battles (intended for sideways viewing).
  const frontType = card.card_faces?.[0]?.type_line || card.type_line
  const isSideways = frontType.includes('Room') || frontType.includes('Battle')

  return (
    <div
      className="group relative p-4 border border-gray-700 rounded bg-gray-800 hover:bg-gray-750 transition-colors card-item"
      data-name={name.toLowerCase()}
      data-cmc={card.cmc}
      data-edhrec={card.edhrec_rank || 999999}
      data-price={parseFloat(card.prices.usd || '0')}
      data-type={card.type_line}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="flex justify-between items-start">
            <div className="bg-transparent flex-1">
              <h3 className="font-bold text-lg">
                {!hideCount && <span className="text-blue-400 mr-2">{quantity}x</span>}
                {name}
              </h3>
              <p className="text-sm text-gray-300 italic">{card.type_line}</p>
            </div>

            <div className="ml-4 shrink-0 flex gap-2">
              {frontImage && (
                <div
                  data-preview-src={frontImage}
                  data-rotate={isSideways ? 'true' : 'false'}
                  className={classNames(
                    isSideways && 'w-24 h-16 flex items-center justify-center shrink-0',
                  )}
                >
                  <img
                    src={frontImage}
                    alt={name}
                    className={classNames(
                      'rounded border border-gray-600 cursor-help transition-transform',
                      isSideways ? 'w-16 rotate-90 origin-center' : 'w-16',
                    )}
                    loading="lazy"
                  />
                </div>
              )}
              {backImage && (
                <div data-preview-src={backImage}>
                  <img
                    src={backImage}
                    alt={`${name} (Back)`}
                    className="w-16 rounded border border-gray-600 cursor-help"
                    loading="lazy"
                  />
                </div>
              )}
            </div>
          </div>

          <details className="mt-2 text-sm text-gray-200">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-300">Details</summary>
            <div className="mt-2 pl-2 border-l-2 border-gray-600">
              {isDFC && card.card_faces ? (
                card.card_faces.map((face, i) => (
                  <div key={i} className="mb-4 last:mb-0">
                    <p className="font-bold text-gray-400 text-xs mb-1">
                      {face.name} <span className="font-normal italic">({face.type_line})</span>
                    </p>
                    {face.mana_cost && (
                      <p className="mb-1 text-gray-300 flex flex-wrap gap-1 items-center">
                        {renderMana(face.mana_cost)}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{renderMana(face.oracle_text || '')}</p>
                  </div>
                ))
              ) : (
                <>
                  {card.mana_cost && (
                    <p className="mb-2 text-gray-300 flex flex-wrap gap-1 items-center">
                      {renderMana(card.mana_cost)}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{renderMana(card.oracle_text || '')}</p>
                </>
              )}

              <div className="mt-2 text-xs text-gray-400 flex gap-2 pt-2 border-t border-gray-700">
                <span>USD: ${card.prices.usd || '---'}</span>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
