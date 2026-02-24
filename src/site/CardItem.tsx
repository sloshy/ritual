import type { FunctionalComponent } from 'preact'
import type { ScryfallCard } from '../types'
import { isDoubleFacedCard, resolveCardImageSources } from './image-sources'

interface CardItemProps {
  name: string
  quantity: number
  card: ScryfallCard | null
  symbolMap: Record<string, string>
  hideCount?: boolean
  useScryfallImgUrls?: boolean
}

export const CardItem: FunctionalComponent<CardItemProps> = ({
  name,
  quantity,
  card,
  symbolMap,
  hideCount,
  useScryfallImgUrls,
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
  const { frontImage, backImage } = resolveCardImageSources(card, Boolean(useScryfallImgUrls))
  const frontType = card.card_faces?.[0]?.type_line || card.type_line
  const isSideways = frontType.includes('Room') || frontType.includes('Battle')

  const oracleHtml = buildOracleHtml(card, isDFC, symbolMap)
  const manaCostHtml = buildManaCostHtml(card, isDFC, symbolMap)

  // Shared data attributes for modal + sorting
  const dataAttrs = {
    'data-name': name.toLowerCase(),
    'data-cmc': card.cmc,
    'data-edhrec': card.edhrec_rank || 999999,
    'data-price': parseFloat(card.prices.usd || '0'),
    'data-type': card.type_line,
    'data-modal-name': name,
    'data-modal-type': card.type_line,
    'data-modal-front': frontImage,
    'data-modal-back': backImage,
    'data-modal-sideways': isSideways ? 'true' : 'false',
    'data-modal-dfc': isDFC ? 'true' : 'false',
    'data-modal-price': card.prices.usd || '',
    'data-modal-set': `${card.set_name} (#${card.collector_number})`,
    'data-modal-rarity': card.rarity,
    'data-modal-oracle': oracleHtml,
    'data-modal-mana': manaCostHtml,
  }

  return (
    <div className="card-item" {...dataAttrs}>
      {/* Binder view */}
      <div className="card-binder">
        {frontImage && <img src={frontImage} alt={name} loading="lazy" />}
        {!hideCount && quantity > 1 && <span className="qty-badge">{quantity}x</span>}
        <span className="card-label">{name}</span>
      </div>

      {/* List view */}
      <div className="card-list" data-tooltip-src={frontImage}>
        {!hideCount && <span className="list-qty">{quantity}</span>}
        <span className="list-name">{name}</span>
        <span className="list-mana" dangerouslySetInnerHTML={{ __html: manaCostHtml }} />
        {card.prices.usd && <span className="list-price">${card.prices.usd}</span>}
      </div>

      {/* Overlap view */}
      <div className="card-overlap">
        {frontImage && <img src={frontImage} alt={name} loading="lazy" />}
        {!hideCount && quantity > 1 && <span className="qty-badge">{quantity}x</span>}
        <button className="overlap-details-btn" data-open-modal="true">
          Details
        </button>
      </div>
    </div>
  )
}

function buildManaCostHtml(
  card: ScryfallCard,
  isDFC: boolean,
  symbolMap: Record<string, string>,
): string {
  if (isDFC && card.card_faces) {
    return card.card_faces
      .map((f) => renderSymbolsToHtml(f.mana_cost || '', symbolMap))
      .filter(Boolean)
      .join(' // ')
  }
  return renderSymbolsToHtml(card.mana_cost || '', symbolMap)
}

function buildOracleHtml(
  card: ScryfallCard,
  isDFC: boolean,
  symbolMap: Record<string, string>,
): string {
  if (isDFC && card.card_faces) {
    return card.card_faces
      .map((face) => {
        const header = `<strong>${escapeHtml(face.name)}</strong> <em>(${escapeHtml(face.type_line)})</em>`
        const text = renderSymbolsToHtml(face.oracle_text || '', symbolMap)
        return `${header}\n${text}`
      })
      .join('\n\n---\n\n')
  }
  return renderSymbolsToHtml(card.oracle_text || '', symbolMap)
}

function renderSymbolsToHtml(text: string, symbolMap: Record<string, string>): string {
  if (!text) return ''
  const parts = text.split(/(\{.*?\})/g)
  return parts
    .map((part) => {
      if (symbolMap[part]) {
        return `<img src="${symbolMap[part]}" alt="${escapeHtml(part)}" style="display:inline-block;height:0.9rem;width:0.9rem;vertical-align:middle;margin:0 1px;">`
      }
      return escapeHtml(part)
    })
    .join('')
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
