import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { useT } from '../ui/i18n'

interface CoverCardProps {
  name: string
  image: string | null
  subtitle?: string
  /** Primary label shown on the bottom-left (e.g. "Commander" or "42 cards"). */
  label: string
  /** Optional smaller parenthetical, e.g. "(62 cards)" when unusual for the format. */
  labelSuffix?: string
  priceLabel?: string
  secondaryPriceLabel?: string
}

export const CoverCard: Component<CoverCardProps> = (props) => {
  const t = useT()
  return (
    <div class="deck-cover">
      <div class="cover-image">
        <Show
          when={props.image}
          fallback={<div class="cover-placeholder">{t('site.cover.noImage')}</div>}
        >
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
        <span class="cover-label">
          <span>{props.label}</span>
          <Show when={props.labelSuffix}>
            <span class="cover-label-suffix">{props.labelSuffix}</span>
          </Show>
        </span>
        <span class="cover-prices">
          <span>{props.priceLabel}</span>
          <Show when={props.secondaryPriceLabel}>
            <span class="cover-lowest">
              {t('site.cover.lowPrice', { price: props.secondaryPriceLabel ?? '' })}
            </span>
          </Show>
        </span>
      </div>
    </div>
  )
}
