import type { Component } from 'solid-js'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { Modal } from '../../ui/Modal'
import type { ScryfallCard } from '../../scryfall/types'
import type { PriceCurrency } from '../../pricing/price-currency'
import { type ChangeEvent, isAdditiveChange } from '../../changes/change-event'
import { formatChange } from '../../changes/change-message'
import { useTooltip } from '../../site/useTooltip'
import { getCardImageUrl } from '../../card/card-image'
import { CardModal } from '../../site/CardModal'
import { useT } from '../../ui/i18n'

interface ChangesDialogProps {
  open: boolean
  changes: ChangeEvent[]
  cards: Record<string, ScryfallCard | null>
  printings?: Record<string, ScryfallCard[]>
  symbolMap?: Record<string, string>
  useScryfallImgUrls?: boolean
  currency?: PriceCurrency
  onClose: () => void
}

export const ChangesDialog: Component<ChangesDialogProps> = (props) => {
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()
  const [selectedCard, setSelectedCard] = createSignal<string | null>(null)
  const t = useT()

  const modalCard = createMemo(() => {
    const name = selectedCard()
    return name ? (props.cards[name] ?? null) : null
  })
  const modalPrintings = createMemo(() => {
    const name = selectedCard()
    const printingsMap = props.printings ?? {}
    return name ? (printingsMap[name] ?? []) : []
  })

  return (
    <>
      <Modal
        open={props.open}
        onClose={props.onClose}
        size="lg"
        placement="top"
        panelClass="changes-modal"
        aria-label={t('ui.editor.pendingChanges')}
        overlay={
          <div
            ref={tooltipRef}
            class={`changes-card-tooltip ${tooltip() ? 'visible' : ''}`}
            style={`left:${tooltipPos().left}px;top:${tooltipPos().top}px;`}
          >
            <Show when={tooltip()?.src}>{(src) => <img src={src()} alt="" />}</Show>
          </div>
        }
      >
        <div class="search-modal-header">
          <h3 class="modal-heading">
            {t('ui.editor.pendingChangesTitle', { count: props.changes.length })}
          </h3>
          <button type="button" class="modal-close-btn" onClick={props.onClose}>
            &times;
          </button>
        </div>
        <div class="changes-dialog">
          <Show
            when={props.changes.length > 0}
            fallback={<div class="empty-state">{t('ui.editor.noPendingChanges')}</div>}
          >
            <For each={props.changes}>
              {(change) => {
                const additive = isAdditiveChange(change.action)
                // Section-meta changes carry no card, so there is nothing to link or preview.
                const cardName = 'cardName' in change ? change.cardName : null
                const card = cardName ? (props.cards[cardName] ?? null) : null
                const imageUrl = card ? getCardImageUrl(card) : null
                return (
                  <div
                    class={`change-item ${additive ? 'change-item--add' : 'change-item--remove'}`}
                  >
                    <span class="change-item-icon">{additive ? '+' : '−'}</span>
                    <ChangeText
                      change={change}
                      onCardClick={() => cardName && setSelectedCard(cardName)}
                      onHoverEnter={() =>
                        imageUrl ? setTooltip({ src: imageUrl, sideways: false }) : undefined
                      }
                      onHoverLeave={() => setTooltip(null)}
                    />
                  </div>
                )
              }}
            </For>
          </Show>
        </div>
      </Modal>

      {/* Card detail modal — a native dialog that stacks above this one in the top layer. */}
      <CardModal
        open={Boolean(modalCard())}
        card={modalCard()}
        cardName={selectedCard()}
        symbolMap={props.symbolMap ?? {}}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency ?? 'usd'}
        printings={modalPrintings()}
        onClose={() => setSelectedCard(null)}
      />
    </>
  )
}

type ChangeTextProps = {
  change: ChangeEvent
  onCardClick: () => void
  onHoverEnter: () => void
  onHoverLeave: () => void
}

const ChangeText: Component<ChangeTextProps> = (props) => {
  const parts = createMemo(() => {
    const formatted = formatChange(props.change)
    // Section-meta changes have no card name to isolate — render the line as plain text.
    const cardName = 'cardName' in props.change ? props.change.cardName : ''
    const idx = cardName ? formatted.indexOf(cardName) : -1
    if (idx === -1) return { formatted, before: null, cardName, after: null }
    return {
      formatted,
      before: formatted.slice(0, idx),
      cardName,
      after: formatted.slice(idx + cardName.length),
    }
  })

  return (
    <Show when={parts().before !== null} fallback={<span>{parts().formatted}</span>}>
      <span>
        {parts().before}
        <a
          href="#"
          class="changelog-card-link"
          onClick={(e: Event) => {
            e.preventDefault()
            e.stopPropagation()
            props.onCardClick()
          }}
          onMouseEnter={props.onHoverEnter}
          onMouseLeave={props.onHoverLeave}
        >
          {parts().cardName}
        </a>
        {parts().after}
      </span>
    </Show>
  )
}
