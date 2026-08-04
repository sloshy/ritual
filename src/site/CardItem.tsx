import type { Component } from 'solid-js'
import { createEffect, createSignal, For, on, Show } from 'solid-js'
import type { ScryfallCard } from '../types'
import type { CardLabel } from '../card-labels'
import { isCardSideways, isDoubleFacedCard, resolveCardImageSources } from './image-sources'
import { ManaCost } from './symbols'
import type { PriceCurrency } from '../price-currency'
import { DEFAULT_CURRENCY, getCardPrice, formatPrice, formatPriceOrNA } from '../price-currency'
import type { ViewMode } from './card-sorting'
import type { SelectionState } from './useCardSelection'
import { selectionModeActive } from './selection-mode'
import { capitalize } from './utils'

type ButtonMouseEvent = MouseEvent & { currentTarget: HTMLButtonElement }

/** Sorting/filtering hooks exposed on the tile root as data attributes. */
type CardDataAttrs = {
  'data-name': string
  'data-cmc': number
  'data-edhrec': number
  'data-price': number
  'data-type': string
  /** The entry's persistent card ID, for cross-list navigation (see card-nav.ts). */
  'data-card-id'?: number
}

/** Wraps a callback with stopPropagation so click events don't bubble to the card container. */
const stopPropAnd =
  (fn?: () => void): ((e: ButtonMouseEvent) => void) =>
  (e) => {
    e.stopPropagation()
    fn?.()
  }

/** Like stopPropAnd but passes the button's bounding rect to the callback. */
const stopPropAndRect =
  (fn?: (rect: DOMRect) => void): ((e: ButtonMouseEvent) => void) =>
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
  /**
   * Label badges rendered beside the printing label. List pages pass only the
   * entry's *override* (the ambient list default would badge every tile);
   * combined views pass effective labels, since there is no ambient default.
   */
  labelBadges?: CardLabel[]
  currency?: PriceCurrency
  /** The entry's persistent card ID, exposed as `data-card-id` for cross-list navigation. */
  cardId?: number
  editMode?: boolean
  onIncrement?: () => void
  onDecrement?: () => void
  onContextMenu?: (rect: DOMRect) => void
  /**
   * When provided, renders a single rightward "Move To…" button in place of the
   * edit/trade controls (used by the admin Move Cards page). Receives the button's
   * bounding rect so the caller can anchor the destination menu.
   */
  onMove?: (rect: DOMRect) => void
  onAddToTrade?: () => void
  addToTradeDisabled?: boolean
  /** Show the multi-select checkbox (top-left on art views, far-left in list view). */
  selectable?: boolean
  /** Selection state of this tile: none, partial (some copies of a quantity group), or all. */
  selectState?: SelectionState
  onToggleSelect?: () => void
}

/**
 * Multi-select checkbox overlaid on a card. `overlay` variant is absolutely
 * positioned in the card's top-left corner (binder / overlap / stack); `list`
 * variant sits inline at the far left of a list-view row. Clicking toggles the
 * selection without bubbling to the card's own click (modal / tooltip). A
 * quantity group that is only partially selected shows a dash rather than a check.
 */
type SelectCheckboxProps = {
  state?: SelectionState
  onToggle?: () => void
  variant: 'overlay' | 'list'
}

const SelectCheckbox: Component<SelectCheckboxProps> = (props) => {
  const selected = () => props.state === 'all'
  const partial = () => props.state === 'partial'
  return (
    <button
      type="button"
      class={`card-select-checkbox card-select-checkbox--${props.variant}`}
      classList={{ selected: selected(), partial: partial() }}
      aria-pressed={selected() ? true : partial() ? 'mixed' : false}
      aria-label={props.state === 'all' ? 'Deselect card' : 'Select card'}
      onClick={(e) => {
        e.stopPropagation()
        props.onToggle?.()
      }}
    >
      <span class="card-select-check" aria-hidden="true">
        {partial() ? '–' : '✓'}
      </span>
    </button>
  )
}

/**
 * Renders a card's art. For double-faced cards (a non-empty `backImage`) it
 * builds a 3D flip structure so the {@link FlipButton} can rotate the front and
 * back faces in place; otherwise it renders a plain `<img>`. The flip only
 * affects the art — surrounding badges, labels and buttons stay put.
 */
type CardFaceProps = {
  frontImage: string
  backImage: string
  flipped: boolean
  alt: string
}

const CardFace: Component<CardFaceProps> = (props) => (
  <Show
    when={props.backImage}
    fallback={<img src={props.frontImage} alt={props.alt} loading="lazy" />}
  >
    <div class="card-flip" classList={{ flipped: props.flipped }}>
      <img class="card-flip-front" src={props.frontImage} alt={props.alt} loading="lazy" />
      <img
        class="card-flip-back"
        src={props.backImage}
        alt={`${props.alt} (back)`}
        loading="lazy"
      />
    </div>
  </Show>
)

/**
 * Translucent "flip" button shown on hover over a double-faced card in the
 * image views (binder / overlap / stack). Toggles between the front and back
 * face; pressing it again on the back flips it back to the front.
 */
type FlipButtonProps = {
  flipped: boolean
  onFlip: () => void
}

const FlipButton: Component<FlipButtonProps> = (props) => (
  <button
    type="button"
    class="card-flip-btn"
    classList={{ flipped: props.flipped }}
    onClick={stopPropAnd(props.onFlip)}
    title={props.flipped ? 'Show front face' : 'Show back face'}
    aria-label={props.flipped ? 'Show front face' : 'Show back face'}
  >
    ⇄
  </button>
)

export const CardItem: Component<CardItemProps> = (props) => {
  const [flipped, setFlipped] = createSignal(false)
  const toggleFlip = () => setFlipped((f) => !f)
  // Reset to the front face whenever this tile is reused for a different card
  // (e.g. a keyed list slot swaps cards), so a new card never appears flipped.
  createEffect(
    on(
      () => props.card?.id,
      () => setFlipped(false),
      { defer: true },
    ),
  )
  return (
    <Show
      when={props.card}
      fallback={
        <div class="card-item" data-name={props.name.toLowerCase()} data-card-id={props.cardId}>
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
        // Everything derived from `card()` must be a reactive accessor, not a
        // captured const: this callback runs once per truthy transition of
        // `props.card` (untracked, per <Show>), so a plain `const` would freeze
        // its value from whatever card the tile first rendered — going stale if
        // the tile slot is reused for a different card, and likewise for the
        // asynchronously-resolved currency in the admin editors.
        const currency = () => props.currency ?? DEFAULT_CURRENCY
        const isDFC = () => isDoubleFacedCard(card())

        // Ctrl/Cmd-click toggles selection from anywhere on the card instead of
        // opening the modal (the standard multi-select modifier; Mac uses Cmd
        // since Ctrl-click maps to the context menu there). Touch selection mode
        // does the same for plain taps — touch has no modifier keys.
        const handleCardClick = (e: MouseEvent) => {
          if (props.selectable && (e.ctrlKey || e.metaKey || selectionModeActive())) {
            e.preventDefault()
            e.stopPropagation()
            props.onToggleSelect?.()
            return
          }
          props.onCardClick?.()
        }
        const images = () => resolveCardImageSources(card(), Boolean(props.useScryfallImgUrls))
        // A flippable face exists only for double-faced cards with a resolvable back image.
        const canFlip = () => isDFC() && Boolean(images().backImage)

        const price = () => getCardPrice(card(), currency())

        const dataAttrs = (): CardDataAttrs => ({
          'data-name': props.name.toLowerCase(),
          'data-cmc': card().cmc,
          'data-edhrec': card().edhrec_rank ?? 999999,
          'data-price': price(),
          'data-type': card().type_line,
          'data-card-id': props.cardId,
        })

        const isFoil = () =>
          props.collectionFinish
            ? props.collectionFinish !== 'nonfoil'
            : card().finishes?.length === 1 && card().finishes[0] !== 'nonfoil'

        const finishLabel = () => {
          const rawFinish =
            props.collectionFinish && props.collectionFinish !== 'nonfoil'
              ? props.collectionFinish
              : !props.collectionFinish &&
                  card().finishes?.length === 1 &&
                  card().finishes[0] !== 'nonfoil'
                ? card().finishes[0]
                : null
          return rawFinish ? capitalize(rawFinish) : null
        }

        const labelBadges = () => (props.labelBadges?.length ? props.labelBadges : null)

        /** The compact SALE/TRADE/KEEP tag run, shared by all three view modes. */
        const badgeRun = () => (
          <Show when={labelBadges()}>
            {(labels) => (
              <span class="card-label-badges">
                <For each={labels()}>
                  {(label) => <span class={`card-label-badge label-${label}`}>{label}</span>}
                </For>
              </span>
            )}
          </Show>
        )

        const binderClass = () => `card-binder${isFoil() ? ' foil-card' : ''}`
        const listClass = () => `card-list${isFoil() ? ' foil-card' : ''}`
        const overlapClass = () => `card-overlap${isFoil() ? ' foil-card' : ''}`
        const displayPrice = () =>
          props.collectionPrice !== undefined ? props.collectionPrice : price()
        const showPrice = () => displayPrice() > 0

        // List view groups the printing identity (set:number, finish, condition) into a
        // single parenthesised label rendered next to the card name. Reuses finishLabel so
        // the capitalised finish stays consistent with the binder/overlap views.
        const printingLabel = () => {
          const parts = [props.collectionSetCN, finishLabel(), props.collectionCondition].filter(
            (part): part is string => Boolean(part),
          )
          return parts.length > 0 ? `(${parts.join(' · ')})` : null
        }

        return (
          <div
            class="card-item"
            classList={{
              'is-selectable': props.selectable,
              'is-selected': props.selectState === 'all' || props.selectState === 'partial',
              'select-mode': props.selectable && selectionModeActive(),
            }}
            {...dataAttrs()}
          >
            {/* Binder view */}
            <Show when={props.viewMode === 'binder'}>
              <div class={binderClass()} onClick={handleCardClick}>
                <Show when={props.selectable}>
                  <SelectCheckbox
                    variant="overlay"
                    state={props.selectState}
                    onToggle={props.onToggleSelect}
                  />
                </Show>
                <Show when={images().frontImage}>
                  <CardFace
                    frontImage={images().frontImage}
                    backImage={images().backImage}
                    flipped={flipped()}
                    alt={props.name}
                  />
                </Show>
                <Show when={canFlip()}>
                  <FlipButton flipped={flipped()} onFlip={toggleFlip} />
                </Show>
                <Show when={!props.hideCount && props.quantity > 1}>
                  <span class="qty-badge">{props.quantity}x</span>
                </Show>
                {/* The ⋯ menu is offered whenever a handler is wired — read mode
                    included — while the quantity steppers stay edit-only. Unlike
                    its sibling buttons, the ⋯ onClick reads props.onContextMenu
                    at click time: its handler identity differs between read and
                    edit mode while the surrounding Show can stay truthy across
                    both, so an eager capture could go stale. */}
                <Show when={props.editMode || props.onContextMenu}>
                  <div class="edit-overlay">
                    <Show when={props.editMode}>
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
                    </Show>
                    <Show when={props.onContextMenu}>
                      <button
                        class="edit-btn edit-btn-context"
                        onClick={(e) => stopPropAndRect(props.onContextMenu)(e)}
                        title="More options"
                      >
                        ⋯
                      </button>
                    </Show>
                  </div>
                </Show>
                <Show when={props.onMove}>
                  <div class="edit-overlay">
                    <button
                      class="edit-btn edit-btn-move"
                      onClick={stopPropAndRect(props.onMove)}
                      title="Move To…"
                      aria-label="Move To…"
                    >
                      →
                    </button>
                  </div>
                </Show>
                <Show when={props.onAddToTrade !== undefined}>
                  <button
                    class="card-trade-btn"
                    onClick={stopPropAnd(props.onAddToTrade)}
                    disabled={props.addToTradeDisabled}
                    title={
                      props.addToTradeDisabled ? 'Already at maximum quantity' : 'Add to trade'
                    }
                    aria-label="Add to trade"
                  >
                    +
                  </button>
                </Show>
                <div class="card-label">
                  <span class="card-label-name">
                    {props.name}
                    <Show when={finishLabel()}>
                      <span class="card-label-finish"> ({finishLabel()})</span>
                    </Show>
                    {badgeRun()}
                  </span>
                  <Show when={showPrice()}>
                    <span class="card-label-price">{formatPrice(displayPrice(), currency())}</span>
                  </Show>
                </div>
              </div>
            </Show>

            {/* List view */}
            <Show when={props.viewMode === 'list'}>
              <div
                class={listClass()}
                onClick={handleCardClick}
                onMouseEnter={() => {
                  const { frontImage } = images()
                  if (frontImage) props.onTooltipEnter?.(frontImage, isCardSideways(card()))
                }}
                onMouseLeave={() => props.onTooltipLeave?.()}
              >
                <Show when={props.selectable}>
                  <SelectCheckbox
                    variant="list"
                    state={props.selectState}
                    onToggle={props.onToggleSelect}
                  />
                </Show>
                <Show when={!props.hideCount}>
                  <span class="list-qty">{props.quantity}</span>
                </Show>
                <span class="list-name-group">
                  <span class="list-name">{props.name}</span>
                  <Show when={printingLabel()}>
                    <span class="list-printing">{printingLabel()}</span>
                  </Show>
                  {badgeRun()}
                </span>
                <span class="list-mana">
                  <ManaCost card={card()} isDFC={isDFC()} symbolMap={props.symbolMap} />
                </span>
                <Show when={props.editMode || props.onContextMenu}>
                  <span class="edit-controls-list">
                    <Show when={props.editMode}>
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
                    </Show>
                    <Show when={props.onContextMenu}>
                      <button
                        class="edit-btn-list"
                        onClick={(e) => stopPropAndRect(props.onContextMenu)(e)}
                        title="More options"
                      >
                        ⋯
                      </button>
                    </Show>
                  </span>
                </Show>
                <Show when={props.onMove}>
                  <span class="edit-controls-list">
                    <button
                      class="edit-btn-list edit-btn-move"
                      onClick={stopPropAndRect(props.onMove)}
                      title="Move To…"
                      aria-label="Move To…"
                    >
                      →
                    </button>
                  </span>
                </Show>
                <Show when={props.onAddToTrade !== undefined}>
                  <button
                    class="list-trade-btn"
                    onClick={stopPropAnd(props.onAddToTrade)}
                    disabled={props.addToTradeDisabled}
                    title={
                      props.addToTradeDisabled ? 'Already at maximum quantity' : 'Add to trade'
                    }
                  >
                    + Trade
                  </button>
                </Show>
                <span class="list-price">{formatPriceOrNA(displayPrice(), currency())}</span>
              </div>
            </Show>

            {/* Overlap / Stack view */}
            <Show when={props.viewMode === 'overlap' || props.viewMode === 'stack'}>
              <div class={overlapClass()} onClick={handleCardClick}>
                <Show when={props.selectable}>
                  <SelectCheckbox
                    variant="overlay"
                    state={props.selectState}
                    onToggle={props.onToggleSelect}
                  />
                </Show>
                <Show when={images().frontImage}>
                  <CardFace
                    frontImage={images().frontImage}
                    backImage={images().backImage}
                    flipped={flipped()}
                    alt={props.name}
                  />
                </Show>
                <Show when={canFlip()}>
                  <FlipButton flipped={flipped()} onFlip={toggleFlip} />
                </Show>
                <Show when={!props.hideCount && props.quantity > 1}>
                  <span class="qty-badge">{props.quantity}x</span>
                </Show>
                <Show when={props.editMode || props.onContextMenu}>
                  <div class="edit-overlay">
                    <Show when={props.editMode}>
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
                    </Show>
                    <Show when={props.onContextMenu}>
                      <button
                        class="edit-btn edit-btn-context"
                        onClick={(e) => stopPropAndRect(props.onContextMenu)(e)}
                        title="More options"
                      >
                        ⋯
                      </button>
                    </Show>
                  </div>
                </Show>
                <Show when={props.onMove}>
                  <div class="edit-overlay">
                    <button
                      class="edit-btn edit-btn-move"
                      onClick={stopPropAndRect(props.onMove)}
                      title="Move To…"
                      aria-label="Move To…"
                    >
                      →
                    </button>
                  </div>
                </Show>
                <Show when={props.onAddToTrade !== undefined}>
                  <button
                    class="card-trade-btn"
                    onClick={stopPropAnd(props.onAddToTrade)}
                    disabled={props.addToTradeDisabled}
                    title={
                      props.addToTradeDisabled ? 'Already at maximum quantity' : 'Add to trade'
                    }
                    aria-label="Add to trade"
                  >
                    +
                  </button>
                </Show>
                <div class="card-label">
                  <span class="card-label-name">
                    {props.name}
                    <Show when={finishLabel()}>
                      <span class="card-label-finish"> ({finishLabel()})</span>
                    </Show>
                    {badgeRun()}
                  </span>
                  <Show when={showPrice()}>
                    <span class="card-label-price">{formatPrice(displayPrice(), currency())}</span>
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
