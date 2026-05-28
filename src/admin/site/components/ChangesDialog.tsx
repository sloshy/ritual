import type { Component } from 'solid-js'
import { createSignal, createEffect, createMemo, onCleanup, For, Show } from 'solid-js'
import type { ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import { type ChangeEvent, isAdditiveChange, formatChange } from '../../../change-event'
import { useTooltip } from '../../../site/useTooltip'
import { getCardImageUrl } from '../card-utils'
import { CardModal } from '../../../site/CardModal'

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
  let dialogRef: HTMLDialogElement | undefined

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()
  const [selectedCard, setSelectedCard] = createSignal<string | null>(null)

  createEffect(() => {
    const dialog = dialogRef
    if (!dialog) return
    if (props.open && !dialog.open) dialog.showModal()
    else if (!props.open && dialog.open) dialog.close()
  })

  // Intercept Escape: close CardModal first, then allow dialog to close
  createEffect(() => {
    const dialog = dialogRef
    if (!dialog) return
    const handleCancel = (e: Event) => {
      if (selectedCard()) {
        e.preventDefault()
        setSelectedCard(null)
      }
    }
    dialog.addEventListener('cancel', handleCancel)
    onCleanup(() => dialog.removeEventListener('cancel', handleCancel))
  })

  const handleBackdropClick = (e: MouseEvent) => {
    if ((e.target as Element) === dialogRef) dialogRef?.close()
  }

  const modalCard = () => {
    const name = selectedCard()
    return name ? (props.cards[name] ?? null) : null
  }
  const modalPrintings = () => {
    const name = selectedCard()
    const printingsMap = props.printings ?? {}
    return name ? (printingsMap[name] ?? []) : []
  }

  return (
    <dialog
      ref={dialogRef}
      class="changes-dialog-native"
      onClose={props.onClose}
      onClick={handleBackdropClick}
    >
      <div class="search-modal changes-modal">
        <div class="search-modal-header">
          <h3 class="modal-heading">Pending Changes ({props.changes.length})</h3>
          <button type="button" class="modal-close-btn" onClick={() => dialogRef?.close()}>
            &times;
          </button>
        </div>
        <div class="changes-dialog">
          <Show
            when={props.changes.length > 0}
            fallback={<div class="empty-state">No pending changes</div>}
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
      </div>

      {/* Card hover tooltip — rendered outside modal div to avoid clipping */}
      <div
        ref={tooltipRef}
        class={`changes-card-tooltip ${tooltip() ? 'visible' : ''}`}
        style={`left:${tooltipPos().left}px;top:${tooltipPos().top}px;`}
      >
        <Show when={tooltip()}>{(t) => <img src={t().src} alt="" />}</Show>
      </div>

      {/* Card detail modal opened from change item */}
      <CardModal
        open={Boolean(modalCard())}
        card={modalCard()}
        cardName={selectedCard()}
        symbolMap={props.symbolMap ?? {}}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency ?? 'usd'}
        printings={modalPrintings()}
        onClose={() => setSelectedCard(null)}
        backdropClass="changelog-card-modal"
      />
    </dialog>
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
