import type { FunctionalComponent } from 'preact'
import { useState, useEffect, useMemo, useRef } from 'preact/hooks'
import type { ScryfallCard } from '../types'
import { isDoubleFacedCard, resolveCardImageSources } from './image-sources'
import { ManaCost, OracleText } from './symbols'
import type { PriceCurrency } from '../price-currency'
import { getCardPrice, getCardPriceForFinish, formatPrice } from '../price-currency'
import { capitalize } from './utils'

type PrintingsSortField = 'released_at' | 'set_name' | 'price'

interface CardModalMetaEntry {
  label: string
  value: string
}

interface CardModalProps {
  open: boolean
  card: ScryfallCard | null
  cardName: string | null
  symbolMap: Record<string, string>
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  printings: ScryfallCard[]
  onClose: () => void
  meta?: CardModalMetaEntry[]
  note?: string
  backdropClass?: string
}

export const CardModal: FunctionalComponent<CardModalProps> = ({
  open,
  card,
  cardName,
  symbolMap,
  useScryfallImgUrls,
  currency,
  printings,
  onClose,
  meta,
  note,
  backdropClass,
}) => {
  const [showingBack, setShowingBack] = useState(false)
  const [showPrintings, setShowPrintings] = useState(false)
  const [printingsPage, setPrintingsPage] = useState(0)
  const [printingsSortField, setPrintingsSortField] = useState<PrintingsSortField>('released_at')
  const [printingsSortReversed, setPrintingsSortReversed] = useState(false)

  useEffect(() => {
    setShowingBack(false)
    setShowPrintings(false)
    setPrintingsPage(0)
    setPrintingsSortField('released_at')
    setPrintingsSortReversed(false)
  }, [cardName])

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const isDfc = card ? isDoubleFacedCard(card) : false
  const imgSources = card ? resolveCardImageSources(card, Boolean(useScryfallImgUrls)) : null

  const frontType = card?.card_faces?.[0]?.type_line ?? card?.type_line ?? ''
  const isSideways = frontType.includes('Room') || frontType.includes('Battle')

  const scryfallUrl = card ? `https://scryfall.com/card/${card.set}/${card.collector_number}` : null

  const defaultMeta = useMemo((): CardModalMetaEntry[] => {
    if (meta) return meta
    const parts: CardModalMetaEntry[] = []
    if (card) {
      const price = getCardPrice(card, currency)
      if (price > 0) parts.push({ label: 'price', value: formatPrice(price, currency) })
      parts.push({ label: 'set', value: `${card.set_name} (#${card.collector_number})` })
      parts.push({
        label: 'rarity',
        value: capitalize(card.rarity),
      })
    }
    return parts
  }, [meta, card, currency])

  const PRINTINGS_PAGE_SIZE = 8

  const sortedPrintings = useMemo(() => {
    const sorted = [...printings]
    const dir = printingsSortReversed ? -1 : 1
    sorted.sort((a, b) => {
      switch (printingsSortField) {
        case 'released_at': {
          const da = a.released_at ?? ''
          const db = b.released_at ?? ''
          return dir * db.localeCompare(da)
        }
        case 'set_name': {
          const cmp = a.set_name.localeCompare(b.set_name)
          if (cmp !== 0) return dir * cmp
          const na = parseInt(a.collector_number, 10) || 0
          const nb = parseInt(b.collector_number, 10) || 0
          return dir * (na - nb)
        }
        case 'price': {
          const pa = getCardPrice(a, currency)
          const pb = getCardPrice(b, currency)
          return dir * (pb - pa)
        }
        default:
          return 0
      }
    })
    return sorted
  }, [printings, printingsSortField, printingsSortReversed, currency])

  const totalPrintingsPages = Math.ceil(sortedPrintings.length / PRINTINGS_PAGE_SIZE)
  const paginatedPrintings = sortedPrintings.slice(
    printingsPage * PRINTINGS_PAGE_SIZE,
    (printingsPage + 1) * PRINTINGS_PAGE_SIZE,
  )

  const renderPrintingsView = () => (
    <div className="modal-printings-view">
      <div className="modal-printings-header">
        <button className="modal-printings-back" onClick={() => setShowPrintings(false)}>
          ← Back
        </button>
        <h3>
          Other Printings of {card?.name ?? cardName ?? 'Unknown'} ({printings.length})
        </h3>
        <div className="printings-sort-controls">
          <select
            className="printings-sort-select"
            value={printingsSortField}
            onChange={(e) => {
              setPrintingsSortField((e.target as HTMLSelectElement).value as PrintingsSortField)
              setPrintingsPage(0)
            }}
          >
            <option value="released_at">Release Date</option>
            <option value="set_name">Set Name</option>
            <option value="price">Price</option>
          </select>
          <button
            className="printings-sort-reverse"
            title={printingsSortReversed ? 'Reversed' : 'Normal order'}
            onClick={() => {
              setPrintingsSortReversed((prev) => !prev)
              setPrintingsPage(0)
            }}
          >
            {printingsSortReversed ? '↑' : '↓'}
          </button>
        </div>
      </div>
      <div className="modal-printings-grid">
        {paginatedPrintings.map((p) => {
          const pImg = p.image_uris?.normal ?? p.card_faces?.[0]?.image_uris?.normal ?? ''
          const pUrl = `https://scryfall.com/card/${p.set}/${p.collector_number}`
          const isFoil = p.finishes?.length === 1 && p.finishes[0] !== 'nonfoil'
          const pPrice = getCardPriceForFinish(p, isFoil ? p.finishes[0]! : 'nonfoil', currency)
          return (
            <a
              key={`${p.set}-${p.collector_number}`}
              href={pUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`modal-printing-card${isFoil ? ' foil-card' : ''}`}
              title={`${p.set_name} (${p.set.toUpperCase()}:${p.collector_number})`}
            >
              {pImg && <img src={pImg} alt={`${p.name} (${p.set.toUpperCase()})`} loading="lazy" />}
              <div className="printing-label">
                <span className="printing-label-set">
                  {p.set.toUpperCase()}:{p.collector_number}
                </span>
                {pPrice > 0 && (
                  <>
                    {' '}
                    <span className="printing-label-price">{formatPrice(pPrice, currency)}</span>
                  </>
                )}
              </div>
            </a>
          )
        })}
      </div>
      {totalPrintingsPages > 1 && (
        <div className="modal-printings-pagination">
          <button
            disabled={printingsPage === 0}
            onClick={() => setPrintingsPage(printingsPage - 1)}
          >
            ← Prev
          </button>
          <span>
            Page {printingsPage + 1} of {totalPrintingsPages}
          </span>
          <button
            disabled={printingsPage >= totalPrintingsPages - 1}
            onClick={() => setPrintingsPage(printingsPage + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div
      className={`card-modal-backdrop ${open ? 'open' : ''}${backdropClass ? ` ${backdropClass}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Card details: ${card?.name ?? cardName ?? 'Card'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="card-modal" style="position:relative;">
        <button className="modal-close" aria-label="Close" onClick={onClose}>
          &times;
        </button>
        {showPrintings ? (
          renderPrintingsView()
        ) : (
          <>
            <div className="card-modal-image">
              {!showingBack ? (
                <img
                  src={imgSources?.frontImage ?? ''}
                  alt={cardName || ''}
                  className={isSideways ? 'sideways' : ''}
                />
              ) : (
                <img src={imgSources?.backImage ?? ''} alt={`${cardName ?? ''} (Back)`} />
              )}
              {isDfc && imgSources?.backImage && (
                <button className="flip-btn" onClick={() => setShowingBack((prev) => !prev)}>
                  Flip ↻
                </button>
              )}
            </div>
            <div className="card-modal-details">
              <div className="modal-card-name">{card?.name ?? cardName}</div>
              <div className="modal-type-line">{card?.type_line}</div>
              <div className="modal-mana-cost">
                {card && <ManaCost card={card} isDFC={isDfc} symbolMap={symbolMap} />}
              </div>
              <div className="modal-oracle-text">
                {card && <OracleText card={card} isDFC={isDfc} symbolMap={symbolMap} />}
              </div>
              <div className="modal-meta">
                {defaultMeta.map((m) => (
                  <span key={m.label}>{m.value}</span>
                ))}
              </div>
              {note && <div className="modal-note">NOTE: {note}</div>}
              <div className="modal-actions">
                {scryfallUrl && (
                  <a href={scryfallUrl} target="_blank" rel="noopener noreferrer">
                    View on Scryfall ↗
                  </a>
                )}
                {printings.length > 0 && (
                  <button onClick={() => setShowPrintings(true)}>
                    Other Printings ({printings.length})
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
