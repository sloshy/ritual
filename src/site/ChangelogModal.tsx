import type { Component } from 'solid-js'
import { createSignal, createEffect, createMemo, onCleanup, Show, For } from 'solid-js'
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

export const ChangelogModal: Component<ChangelogModalProps> = (props) => {
  const [page, setPage] = createSignal(0)
  const [cardModalName, setCardModalName] = createSignal<string | null>(null)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  createEffect(() => {
    if (!props.open || cardModalName()) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', handler)
    onCleanup(() => document.removeEventListener('keydown', handler))
  })

  const totalPages = createMemo(() => props.changelog.length)
  const currentPage = createMemo(() => props.changelog[page()])

  const formattedTimestamp = createMemo(() => {
    const cp = currentPage()
    if (!cp) return ''
    try {
      return new Date(cp.timestamp).toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return cp.timestamp
    }
  })

  const cardModalCard = createMemo((): ScryfallCard | null => {
    const name = cardModalName()
    if (!name) return null
    return props.cards[name] ?? null
  })

  const cardModalPrintings = createMemo(() => {
    const name = cardModalName()
    if (!name) return []
    return props.printings[name] ?? []
  })

  return (
    <Show when={props.open && props.changelog.length > 0}>
      <div
        class="changelog-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
        }}
      >
        <div class="changelog-modal">
          <div class="changelog-modal-header">
            <h3>Change History</h3>
            <button class="modal-close" aria-label="Close" onClick={props.onClose}>
              &times;
            </button>
          </div>

          <div class="changelog-modal-body">
            <Show when={currentPage()}>
              <div class="changelog-timestamp">{formattedTimestamp()}</div>
              <For each={currentPage()!.changes}>
                {(change) => {
                  const additive = isAdditiveAction(change.action)
                  const card = props.cards[change.cardName] ?? null
                  const imageUrl =
                    card && props.useScryfallImgUrls !== undefined
                      ? getCardImageUrl(card, props.useScryfallImgUrls!)
                      : null
                  const { prefix, suffix } = formatChangeText(change)
                  const colorClass = additive
                    ? 'changelog-change-item--add'
                    : change.action === 'Removed'
                      ? 'changelog-change-item--remove'
                      : 'changelog-change-item--other'

                  return (
                    <div class={`changelog-change-item ${colorClass}`}>
                      <span class="changelog-change-icon">{additive ? '+' : '−'}</span>
                      <span>
                        {prefix}
                        <span
                          class={card ? 'changelog-card-link' : ''}
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
                }}
              </For>
            </Show>
          </div>

          <Show when={totalPages() > 1}>
            <div class="changelog-modal-footer">
              <button disabled={page() <= 0} onClick={() => setPage((p) => p - 1)}>
                ← Newer
              </button>
              <span>
                {page() + 1} / {totalPages()}
              </span>
              <button disabled={page() >= totalPages() - 1} onClick={() => setPage((p) => p + 1)}>
                Older →
              </button>
            </div>
          </Show>
        </div>

        {/* Hover tooltip */}
        <div
          ref={tooltipRef}
          class={`changelog-card-tooltip ${tooltip() ? 'visible' : ''}`}
          style={{ left: `${tooltipPos().left}px`, top: `${tooltipPos().top}px` }}
        >
          <Show when={tooltip()}>
            <img src={tooltip()!.src} alt="" />
          </Show>
        </div>
      </div>

      {/* Secondary card modal (rendered above changelog via CSS z-index) */}
      <CardModal
        open={Boolean(cardModalCard())}
        card={cardModalCard()}
        cardName={cardModalName()}
        symbolMap={props.symbolMap}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency}
        printings={cardModalPrintings()}
        onClose={() => setCardModalName(null)}
        backdropClass="changelog-card-modal"
      />
    </Show>
  )
}
