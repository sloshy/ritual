import type { Component, JSX } from 'solid-js'
import { Show, For } from 'solid-js'
import type { CardData } from './card-sorting'
import type { PriceCurrency } from '../price-currency'
import { formatPrice } from '../price-currency'
import { groupTotalPrice } from './card-sorting'

interface CardSectionProps {
  label: string
  cards: CardData[]
  currency: PriceCurrency
  renderCard: (card: CardData, index: number) => JSX.Element
}

export const CardSection: Component<CardSectionProps> = (props) => {
  const sectionId = () => props.label.replace(/[^a-zA-Z0-9]/g, '_')
  const sectionTotal = () => groupTotalPrice(props.cards)

  return (
    <Show when={props.cards.length > 0}>
      <div data-section={props.label}>
        <div class="section-divider" id={sectionId()}>
          <h2>
            <a
              href={`#${sectionId()}`}
              class="section-header-link"
              onClick={(e) => {
                e.preventDefault()
                document
                  .getElementById(sectionId())
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {props.label}
            </a>
          </h2>
          <span class="section-count">{props.cards.reduce((sum, c) => sum + c.quantity, 0)}</span>
          <span class="section-price">{formatPrice(sectionTotal(), props.currency)}</span>
        </div>
        <div class="binder-grid">
          <For each={props.cards}>{(card, i) => props.renderCard(card, i())}</For>
        </div>
      </div>
    </Show>
  )
}
