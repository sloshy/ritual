import type { JSX } from 'solid-js'
import { Show, For } from 'solid-js'
import type { CardData } from './card-sorting'
import type { PriceCurrency } from '../pricing/price-currency'
import { formatPrice } from '../pricing/price-currency'
import { groupTotalPrice } from './card-sorting'
import { pricesEnabled } from './price-view'

interface CardSectionProps<T extends CardData = CardData> {
  label: string
  cards: T[]
  currency: PriceCurrency
  renderCard: (card: T, index: number) => JSX.Element
}

export function CardSection<T extends CardData = CardData>(
  props: CardSectionProps<T>,
): JSX.Element {
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
          <Show when={pricesEnabled()}>
            <span class="section-price">{formatPrice(sectionTotal(), props.currency)}</span>
          </Show>
        </div>
        <div class="binder-grid">
          <For each={props.cards}>{(card, i) => props.renderCard(card, i())}</For>
        </div>
      </div>
    </Show>
  )
}
