import type { FunctionalComponent } from 'preact'
import { useState, useEffect, useMemo, useRef } from 'preact/hooks'
import type { ChangelogPage } from '../changelog-parser'
import type { ScryfallCard } from '../types'
import type { PriceCurrency } from '../price-currency'
import { useTooltip } from './useTooltip'
import { resolveCardImageSources } from './image-sources'
import { CardModal } from './CardModal'

interface ChangelogModalProps {
  open: boolean
  changelog: ChangelogPage[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  onClose: () => void
}

function getCardImageUrl(card: ScryfallCard, useScryfallImgUrls: boolean): string | null {
  const sources = resolveCardImageSources(card, useScryfallImgUrls)
  return sources.frontImage || null
}

function isAdditiveAction(action: string): boolean {
  return action === 'Added' || action.startsWith('Set')
}

function formatChangeText(change: {
  action: string
  cardName: string
  set?: string
  collectorNumber?: string
  finish?: string
  condition?: string
}): { prefix: string; suffix: string } {
  const parts: string[] = []
  if (change.set && change.collectorNumber) {
    parts.push(`(${change.set.toUpperCase()}:${change.collectorNumber})`)
  }
  if (change.finish && change.finish !== 'nonfoil') {
    parts.push(`[${change.finish}]`)
  }
  if (change.condition && change.condition !== 'NM') {
    parts.push(`[${change.condition}]`)
  }

  let prefix: string
  if (change.action === 'Set as commander') {
    prefix = 'Set '
    return { prefix, suffix: ' as commander' }
  }
  if (change.action === 'Set finish') {
    prefix = 'Set '
    return { prefix, suffix: ` finish to ${change.finish ?? 'nonfoil'}` }
  }

  prefix = `${change.action} `
  return { prefix, suffix: parts.length > 0 ? ' ' + parts.join(' ') : '' }
}

export const ChangelogModal: FunctionalComponent<ChangelogModalProps> = ({
  open,
  changelog,
  cards,
  printings,
  symbolMap,
  useScryfallImgUrls,
  currency,
  onClose,
}) => {
  const [page, setPage] = useState(0)
  const [cardModalName, setCardModalName] = useState<string | null>(null)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    setPage(0)
    setCardModalName(null)
  }, [open])

  useEffect(() => {
    if (!open || cardModalName) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, cardModalName])

  const totalPages = changelog.length
  const currentPage = changelog[page]

  const formattedTimestamp = useMemo(() => {
    if (!currentPage) return ''
    try {
      return new Date(currentPage.timestamp).toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return currentPage.timestamp
    }
  }, [currentPage])

  const cardModalCard = useMemo((): ScryfallCard | null => {
    if (!cardModalName) return null
    return cards[cardModalName] ?? null
  }, [cardModalName, cards])

  const cardModalPrintings = useMemo(() => {
    if (!cardModalName) return []
    return printings[cardModalName] ?? []
  }, [cardModalName, printings])

  if (!open || changelog.length === 0) return null

  return (
    <>
      <div
        className="changelog-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="changelog-modal">
          <div className="changelog-modal-header">
            <h3>Change History</h3>
            <button className="modal-close" aria-label="Close" onClick={onClose}>
              &times;
            </button>
          </div>

          <div className="changelog-modal-body">
            {currentPage && (
              <>
                <div className="changelog-timestamp">{formattedTimestamp}</div>
                {currentPage.changes.map((change, i) => {
                  const additive = isAdditiveAction(change.action)
                  const card = cards[change.cardName] ?? null
                  const imageUrl =
                    card && useScryfallImgUrls !== undefined
                      ? getCardImageUrl(card, useScryfallImgUrls)
                      : null
                  const { prefix, suffix } = formatChangeText(change)
                  const colorClass = additive
                    ? 'changelog-change-item--add'
                    : change.action === 'Removed'
                      ? 'changelog-change-item--remove'
                      : 'changelog-change-item--other'

                  return (
                    <div key={`${page}-${i}`} className={`changelog-change-item ${colorClass}`}>
                      <span className="changelog-change-icon">{additive ? '+' : '−'}</span>
                      <span>
                        {prefix}
                        <span
                          className={card ? 'changelog-card-link' : ''}
                          onClick={card ? () => setCardModalName(change.cardName) : undefined}
                          onMouseEnter={
                            imageUrl
                              ? () => setTooltip({ src: imageUrl, sideways: false })
                              : undefined
                          }
                          onMouseLeave={imageUrl ? () => setTooltip(null) : undefined}
                        >
                          {change.cardName}
                        </span>
                        {suffix}
                      </span>
                    </div>
                  )
                })}
              </>
            )}
          </div>

          {totalPages > 1 && (
            <div className="changelog-modal-footer">
              <button disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                ← Newer
              </button>
              <span>
                {page + 1} / {totalPages}
              </span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                Older →
              </button>
            </div>
          )}
        </div>

        {/* Hover tooltip */}
        <div
          ref={tooltipRef}
          className={`changelog-card-tooltip ${tooltip ? 'visible' : ''}`}
          style={`left:${tooltipPos.left}px;top:${tooltipPos.top}px;`}
        >
          {tooltip && <img src={tooltip.src} alt="" />}
        </div>
      </div>

      {/* Secondary card modal (rendered above changelog via CSS z-index) */}
      <CardModal
        open={Boolean(cardModalCard)}
        card={cardModalCard}
        cardName={cardModalName}
        symbolMap={symbolMap}
        useScryfallImgUrls={useScryfallImgUrls}
        currency={currency}
        printings={cardModalPrintings}
        onClose={() => setCardModalName(null)}
        backdropClass="changelog-card-modal"
      />
    </>
  )
}
