import type { Component } from 'solid-js'
import { Show } from 'solid-js'

interface CoverCardProps {
  name: string
  image: string | null
  subtitle?: string
  cardCount: number
  priceLabel: string
  secondaryPriceLabel?: string
}

export const CoverCard: Component<CoverCardProps> = (props) => {
  return (
    <div class="deck-cover">
      <div class="cover-image">
        <Show when={props.image} fallback={<div class="cover-placeholder">No Image</div>}>
          {(src) => <img src={src()} alt={props.name} />}
        </Show>
        <div class="cover-overlay" />
        <div class="cover-info">
          <h2>{props.name}</h2>
          <Show when={props.subtitle}>
            <p class="cover-subtitle">{props.subtitle}</p>
          </Show>
        </div>
      </div>
      <div class="cover-cardcount">
        <span>{props.cardCount} cards</span>
        <span class="cover-prices">
          <span>{props.priceLabel}</span>
          <Show when={props.secondaryPriceLabel}>
            <span class="cover-lowest">low {props.secondaryPriceLabel}</span>
          </Show>
        </span>
      </div>
    </div>
  )
}
