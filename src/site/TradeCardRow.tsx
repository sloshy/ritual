import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { isCardSideways, resolveCardImageSources } from './image-sources'
import type { PriceCurrency } from '../price-currency'
import { formatPrice } from '../price-currency'
import type { TradeCardEntry } from './data-types'
import { languageBadge } from '../card-language'
import { QuantityStepper } from '../ui/QuantityStepper'
import { useT } from '../ui/i18n'
import { cardPricelessMarkerText } from './priceless'

export interface TradeCardRowProps {
  card: TradeCardEntry
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  onRemove: () => void
  onUpdateQty: (delta: number) => void
  onEdit?: () => void
  onTooltipEnter?: (src: string, sideways: boolean) => void
  onTooltipLeave?: () => void
}

type SourceTagClass = 'col' | 'deck' | 'want' | 'scry'

const SOURCE_TAG_CLASSES: Record<TradeCardEntry['source'], SourceTagClass> = {
  collection: 'col',
  deck: 'deck',
  wanted: 'want',
  scryfall: 'scry',
}

export const TradeCardRow: Component<TradeCardRowProps> = (props) => {
  const t = useT()
  const imageUrl = () => {
    const sf = props.card.scryfallCard
    if (!sf) return null
    return resolveCardImageSources(sf, Boolean(props.useScryfallImgUrls)).frontImage || null
  }

  const setCN = () => {
    const { set, collectorNumber, language } = props.card
    // Non-English rows carry their language beside the printing (`LEA:161 · JA`),
    // like the list tiles; a bare/en row shows the printing alone.
    const badge = languageBadge(language)
    const lang = badge ? ` · ${badge}` : ''
    if (set && collectorNumber) return `${set.toUpperCase()}:${collectorNumber}${lang}`
    if (set) return `${set.toUpperCase()}${lang}`
    return null
  }

  const sourceLabel = (): string => {
    switch (props.card.source) {
      case 'collection':
        return t('site.tradeRow.sourceCollection')
      case 'deck':
        return t('site.tradeRow.sourceDeck', { name: props.card.sourceName })
      case 'wanted':
        return t('site.tradeRow.sourceWanted')
      case 'scryfall':
        // Which backend answered this card's lookup — "Cache" on a hosted site,
        // "Scryfall" when the browser had to ask Scryfall itself.
        return props.card.sourceName
    }
  }

  const totalPrice = () => (props.card.price ?? 0) * props.card.qty

  /**
   * A copy that carries no price by rule shows its marker where the figure
   * would be. Its price is already 0 (set when the row was built), so the
   * column total and the balance need nothing from here.
   */
  const pricelessMarker = () => cardPricelessMarkerText(t, props.card)

  /** The priced rendering: the row's total, with the per-copy figure under it. */
  const priceRun = () => (
    <Show when={(props.card.price ?? 0) > 0} fallback="—">
      {formatPrice(totalPrice(), props.currency)}
      <Show when={props.card.qty > 1}>
        <span class="trade-row-price-each">
          {t('site.tradeRow.priceEach', {
            amount: formatPrice(props.card.price!, props.currency),
          })}
        </span>
      </Show>
    </Show>
  )

  const handleMouseEnter = () => {
    const src = imageUrl()
    if (!src) return
    props.onTooltipEnter?.(src, isCardSideways(props.card.scryfallCard))
  }

  return (
    <div class="trade-row" onMouseEnter={handleMouseEnter} onMouseLeave={props.onTooltipLeave}>
      <div class="trade-row-thumb">
        <Show when={imageUrl()} fallback={<div class="ph">{props.card.name.slice(0, 2)}</div>}>
          {(src) => <img src={src()} alt={props.card.name} loading="lazy" />}
        </Show>
      </div>
      <div class="trade-row-name">
        <span class="trade-row-name-text">{props.card.name}</span>
        <span class="trade-row-name-meta">
          <Show when={setCN()}>
            <span>{setCN()}</span>
          </Show>
          <span class={`src-tag ${SOURCE_TAG_CLASSES[props.card.source]}`}>{sourceLabel()}</span>
          {/* An explicit reminder that this card is labeled "To keep" — shown
              always, whether or not the add-time dialog has been acknowledged. */}
          <Show when={props.card.labels?.includes('keep')}>
            <span class="src-tag label-keep-tag">{t('site.tradeRow.keepBadge')}</span>
          </Show>
        </span>
      </div>
      {/* Reserves the edit-button column even when the card isn't editable, so
          rows in the same list keep their qty/price/remove columns aligned. */}
      <span class="trade-row-edit-slot">
        <Show when={props.card.editable && props.onEdit}>
          <button
            class="trade-row-edit"
            onClick={props.onEdit}
            title={t('site.tradeRow.editPrinting')}
            aria-label={t('site.tradeRow.editPrinting')}
          >
            ✎
          </button>
        </Show>
      </span>
      <Show
        when={props.card.maxQty !== 1}
        fallback={<span class="qty-val qty-val-fixed">{props.card.qty}</span>}
      >
        <QuantityStepper
          value={props.card.qty}
          max={props.card.maxQty}
          maxReachedTitle={t('site.tradeRow.maxAvailable', { count: props.card.maxQty ?? 0 })}
          onChange={(next) => props.onUpdateQty(next - props.card.qty)}
        />
      </Show>
      <span class="trade-row-price">{pricelessMarker() ?? priceRun()}</span>
      <button class="trade-row-remove" onClick={props.onRemove} title={t('site.tradeRow.remove')}>
        ✕
      </button>
    </div>
  )
}
