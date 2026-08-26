import type { Component } from 'solid-js'
import { createSignal, createMemo, Show, For } from 'solid-js'
import { Modal } from '../ui/Modal'
import { formatDateTime } from '../ui/format'
import type { ChangelogPage } from '../changes/changelog-parser'
import type { ScryfallCard } from '../scryfall/types'
import type { PriceCurrency } from '../pricing/price-currency'
import { useTooltip } from './useTooltip'
import { resolveCardImageSources } from './image-sources'
import { CardModal } from './CardModal'
import { isAdditiveAction } from './changelog-format'
import { useT } from '../ui/i18n'
import { changeSegments, displayChangeFromLine } from '../changes/change-message'

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

export const ChangelogModal: Component<ChangelogModalProps> = (props) => {
  const t = useT()
  const [page, setPage] = createSignal(0)
  const [cardModalName, setCardModalName] = createSignal<string | null>(null)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  const totalPages = () => props.changelog.length
  const currentPage = createMemo(() => props.changelog[page()])

  const formattedTimestamp = createMemo(() => {
    const cp = currentPage()
    if (!cp) return ''
    try {
      return formatDateTime(cp.timestamp, {
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
    <>
      <Modal
        open={props.open && props.changelog.length > 0}
        onClose={props.onClose}
        size="lg"
        panelClass="changelog-modal"
        aria-label={t('site.changelog.title')}
        overlay={
          <div
            ref={tooltipRef}
            class={`changelog-card-tooltip ${tooltip() ? 'visible' : ''}`}
            style={{ left: `${tooltipPos().left}px`, top: `${tooltipPos().top}px` }}
          >
            <Show when={tooltip()?.src}>{(src) => <img src={src()} alt="" />}</Show>
          </div>
        }
      >
        <div class="changelog-modal-header">
          <h3>{t('site.changelog.title')}</h3>
          <button class="modal-close" aria-label={t('ui.dialog.close')} onClick={props.onClose}>
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
                    ? getCardImageUrl(card, props.useScryfallImgUrls)
                    : null
                // Segments, not a prefix/suffix pair: the translator decides
                // where the card name sits in the sentence, and only the
                // `name` parameter becomes the interactive node.
                // In a memo, not a plain call: the `<For>` item callback body runs
                // once per item outside any tracking scope, so a rendered-once
                // value would freeze this list in the boot language while the
                // modal chrome around it relabeled.
                const segments = createMemo(() => changeSegments(displayChangeFromLine(change)))
                // Every action is categorized as additive or destructive (see
                // isAdditiveAction), so there is no neutral middle state.
                const colorClass = additive
                  ? 'changelog-change-item--add'
                  : 'changelog-change-item--remove'

                return (
                  <div class={`changelog-change-item ${colorClass}`}>
                    <span class="changelog-change-icon">{additive ? '+' : '−'}</span>
                    <span>
                      <For each={segments()}>
                        {(segment) =>
                          segment.kind === 'param' && segment.name === 'name' ? (
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
                              {segment.value}
                            </span>
                          ) : (
                            segment.value
                          )
                        }
                      </For>
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
              {t('site.changelog.newer')}
            </button>
            <span>
              {page() + 1} / {totalPages()}
            </span>
            <button disabled={page() >= totalPages() - 1} onClick={() => setPage((p) => p + 1)}>
              {t('site.changelog.older')}
            </button>
          </div>
        </Show>
      </Modal>

      {/* Secondary card modal — a native dialog that stacks above the changelog in the top layer. */}
      <CardModal
        open={Boolean(cardModalCard())}
        card={cardModalCard()}
        cardName={cardModalName()}
        symbolMap={props.symbolMap}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency}
        printings={cardModalPrintings()}
        onClose={() => setCardModalName(null)}
      />
    </>
  )
}
