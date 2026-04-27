import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import type { ScryfallCard } from '../types'
import { isCardSideways, isDoubleFacedCard, resolveCardImageSources } from './image-sources'
import { ManaCost } from './symbols'
import type { PriceCurrency } from '../price-currency'
import { getCardPrice, formatPrice } from '../price-currency'
import type { ViewMode } from './card-sorting'
import { capitalize } from './utils'

/** Wraps a callback with stopPropagation so click events don't bubble to the card container. */
const stopPropAnd =
  (fn?: () => void): ((e: MouseEvent & { currentTarget: HTMLButtonElement }) => void) =>
  (e) => {
    e.stopPropagation()
    fn?.()
  }

/** Like stopPropAnd but passes the button's bounding rect to the callback. */
const stopPropAndRect =
  (
    fn?: (rect: DOMRect) => void,
  ): ((e: MouseEvent & { currentTarget: HTMLButtonElement }) => void) =>
  (e) => {
    e.stopPropagation()
    fn?.(e.currentTarget.getBoundingClientRect())
  }

export interface CardItemProps {
  name: string
  quantity: number
  card: ScryfallCard | null
  symbolMap: Record<string, string>
  viewMode: ViewMode
  hideCount?: boolean
  useScryfallImgUrls?: boolean
  onCardClick?: () => void
  onTooltipEnter?: (src: string, sideways: boolean) => void
  onTooltipLeave?: () => void
  collectionFinish?: string
  collectionCondition?: string
  collectionSetCN?: string
  collectionPrice?: number
  currency?: PriceCurrency
  editMode?: boolean
  onIncrement?: () => void
  onDecrement?: () => void
  onContextMenu?: (rect: DOMRect) => void
}

export const CardItem: Component<CardItemProps> = (props) => {
  return (
    <Show
      when={props.card}
      fallback={
        <div class="card-item">
          <Show when={props.viewMode === 'binder'}>
            <div class="card-binder card-binder--empty">
              <span class="card-empty-label">{props.name}</span>
            </div>
          </Show>
          <Show when={props.viewMode === 'list'}>
            <div class="card-list card-list--empty">
              <Show when={!props.hideCount}>
                <span class="list-qty">{props.quantity}</span>
              </Show>
              <span class="list-name">{props.name}</span>
            </div>
          </Show>
          <Show when={props.viewMode === 'overlap' || props.viewMode === 'stack'}>
            <div class="card-overlap card-overlap--empty">
              <span class="card-empty-label">{props.name}</span>
            </div>
          </Show>
        </div>
      }
    >
      {(card) => {
        const currency = props.currency ?? 'usd'
        const isDFC = isDoubleFacedCard(card())
        const { frontImage } = resolveCardImageSources(card(), Boolean(props.useScryfallImgUrls))

        const isSideways = isCardSideways(card())

        const price = getCardPrice(card(), currency)

        const dataAttrs = {
          'data-name': props.name.toLowerCase(),
          'data-cmc': card().cmc,
          'data-edhrec': card().edhrec_rank ?? 999999,
          'data-price': price,
          'data-type': card().type_line,
        }

        const isFoil = props.collectionFinish
          ? props.collectionFinish !== 'nonfoil'
          : card().finishes?.length === 1 && card().finishes[0] !== 'nonfoil'

        const rawFinish =
          props.collectionFinish && props.collectionFinish !== 'nonfoil'
            ? props.collectionFinish
            : !props.collectionFinish &&
                card().finishes?.length === 1 &&
                card().finishes[0] !== 'nonfoil'
              ? card().finishes[0]
              : null
        const finishLabel = rawFinish ? capitalize(rawFinish) : null

        const binderClass = `card-binder${isFoil ? ' foil-card' : ''}`
        const listClass = `card-list${isFoil ? ' foil-card' : ''}`
        const overlapClass = `card-overlap${isFoil ? ' foil-card' : ''}`
        const displayPrice = props.collectionPrice !== undefined ? props.collectionPrice : price
        const showPrice = displayPrice > 0

        return (
          <div class="card-item" {...dataAttrs}>
            {/* Binder view */}
            <Show when={props.viewMode === 'binder'}>
              <div class={binderClass} onClick={props.onCardClick}>
                <Show when={frontImage}>
                  {(src) => <img src={src()} alt={props.name} loading="lazy" />}
                </Show>
                <Show when={!props.hideCount && props.quantity > 1}>
                  <span class="qty-badge">{props.quantity}x</span>
                </Show>
                <Show when={props.editMode}>
                  <div class="edit-overlay">
                    <button
                      class="edit-btn edit-btn-increment"
                      onClick={stopPropAnd(props.onIncrement)}
                      title="Add copy"
                    >
                      +
                    </button>
                    <button
                      class="edit-btn edit-btn-decrement"
                      onClick={stopPropAnd(props.onDecrement)}
                      title="Remove copy"
                    >
                      −
                    </button>
                    <button
                      class="edit-btn edit-btn-context"
                      onClick={stopPropAndRect(props.onContextMenu)}
                      title="More options"
                    >
                      ⋯
                    </button>
                  </div>
                </Show>
                <div class="card-label">
                  <span class="card-label-name">
                    {props.name}
                    <Show when={finishLabel}>
                      <span class="card-label-finish"> ({finishLabel})</span>
                    </Show>
                  </span>
                  <Show when={showPrice}>
                    <span class="card-label-price">{formatPrice(displayPrice, currency)}</span>
                  </Show>
                </div>
              </div>
            </Show>

            {/* List view */}
            <Show when={props.viewMode === 'list'}>
              <div
                class={listClass}
                onClick={props.onCardClick}
                onMouseEnter={() => frontImage && props.onTooltipEnter?.(frontImage, isSideways)}
                onMouseLeave={() => props.onTooltipLeave?.()}
              >
                <Show when={!props.hideCount}>
                  <span class="list-qty">{props.quantity}</span>
                </Show>
                <span class="list-name">{props.name}</span>
                <Show when={props.collectionSetCN}>
                  <span class="list-set-cn">{props.collectionSetCN}</span>
                </Show>
                <Show when={props.collectionFinish && props.collectionFinish !== 'nonfoil'}>
                  <span class="list-finish">{props.collectionFinish}</span>
                </Show>
                <Show when={props.collectionCondition}>
                  <span class="list-condition">{props.collectionCondition}</span>
                </Show>
                <span class="list-mana">
                  <ManaCost card={card()} isDFC={isDFC} symbolMap={props.symbolMap} />
                </span>
                <Show when={props.editMode}>
                  <span class="edit-controls-list">
                    <button
                      class="edit-btn-list"
                      onClick={stopPropAnd(props.onIncrement)}
                      title="Add copy"
                    >
                      +
                    </button>
                    <button
                      class="edit-btn-list"
                      onClick={stopPropAnd(props.onDecrement)}
                      title="Remove copy"
                    >
                      −
                    </button>
                    <button
                      class="edit-btn-list"
                      onClick={stopPropAndRect(props.onContextMenu)}
                      title="More options"
                    >
                      ⋯
                    </button>
                  </span>
                </Show>
                <Show when={showPrice}>
                  <span class="list-price">{formatPrice(displayPrice, currency)}</span>
                </Show>
              </div>
            </Show>

            {/* Overlap / Stack view */}
            <Show when={props.viewMode === 'overlap' || props.viewMode === 'stack'}>
              <div class={overlapClass} onClick={props.onCardClick}>
                <Show when={frontImage}>
                  {(src) => <img src={src()} alt={props.name} loading="lazy" />}
                </Show>
                <Show when={!props.hideCount && props.quantity > 1}>
                  <span class="qty-badge">{props.quantity}x</span>
                </Show>
                <Show when={props.editMode}>
                  <div class="edit-overlay">
                    <button
                      class="edit-btn edit-btn-increment"
                      onClick={stopPropAnd(props.onIncrement)}
                      title="Add copy"
                    >
                      +
                    </button>
                    <button
                      class="edit-btn edit-btn-decrement"
                      onClick={stopPropAnd(props.onDecrement)}
                      title="Remove copy"
                    >
                      −
                    </button>
                    <button
                      class="edit-btn edit-btn-context"
                      onClick={stopPropAndRect(props.onContextMenu)}
                      title="More options"
                    >
                      ⋯
                    </button>
                  </div>
                </Show>
                <div class="card-label">
                  <span class="card-label-name">
                    {props.name}
                    <Show when={finishLabel}>
                      <span class="card-label-finish"> ({finishLabel})</span>
                    </Show>
                  </span>
                  <Show when={showPrice}>
                    <span class="card-label-price">{formatPrice(displayPrice, currency)}</span>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        )
      }}
    </Show>
  )
}
