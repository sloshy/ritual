import type { Component } from 'solid-js'
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import type { ScryfallCard } from '../types'
import type { CardLabel, PricelessReason } from '../card-labels'
import { languageBadge } from '../card-language'
import { isCardSideways, isDoubleFacedCard, resolveCardImageSources } from './image-sources'
import { ManaCost } from './symbols'
import type { PriceCurrency } from '../price-currency'
import { DEFAULT_CURRENCY, getCardPrice, formatPrice, formatPriceOrNA } from '../price-currency'
import { BUYLIST_CURRENCY, type ViewMode } from './card-sorting'
import type { SelectionState } from './useCardSelection'
import { selectionModeActive } from './selection-mode'
import { finishName } from './printing-display'
import { pricelessMarkerText } from './priceless'
import { useT } from '../ui/i18n'

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
  /**
   * The entry's custom art (`art/<relpath>` or a URL), replacing the card's own
   * front image everywhere this tile shows it — grid, binder, stacks, and the
   * list view's hover tooltip. A double-faced card keeps its real back.
   */
  customArt?: string
  symbolMap: Record<string, string>
  viewMode: ViewMode
  hideCount?: boolean
  useScryfallImgUrls?: boolean
  onCardClick?: () => void
  onTooltipEnter?: (src: string, sideways: boolean) => void
  onTooltipLeave?: () => void
  collectionFinish?: string
  collectionCondition?: string
  /**
   * The entry's non-English language code (`ja`), when it has one. Rendered
   * uppercase beside the finish/condition chips; English entries pass nothing.
   */
  collectionLanguage?: string
  collectionSetCN?: string
  collectionPrice?: number
  /**
   * The selected buyer's active per-copy offer for this printing (USD), when
   * sell mode is on and they are buying it. Rendered beside the retail price;
   * omitted or 0 renders the tile exactly as it would outside sell mode.
   */
  buylistPrice?: number
  /**
   * Label badges rendered beside the printing label. List pages pass only the
   * entry's *override* (the ambient list default would badge every tile);
   * combined views pass effective labels, since there is no ambient default.
   */
  labelBadges?: CardLabel[]
  /**
   * Why this copy carries no price, when it carries none: a marker (`PROXY` /
   * `CUSTOM`) then replaces the price text in every view. Passed rather than
   * derived, because the tile sees only the *override* labels while the rule
   * runs on the effective ones — see `cardPricelessReason`.
   */
  priceless?: PricelessReason
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
  const t = useT()
  const selected = () => props.state === 'all'
  const partial = () => props.state === 'partial'
  return (
    <button
      type="button"
      class={`card-select-checkbox card-select-checkbox--${props.variant}`}
      classList={{ selected: selected(), partial: partial() }}
      aria-pressed={selected() ? true : partial() ? 'mixed' : false}
      aria-label={props.state === 'all' ? t('site.card.deselect') : t('site.card.select')}
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

const CardFace: Component<CardFaceProps> = (props) => {
  const t = useT()
  return (
    <Show
      when={props.backImage}
      fallback={<img src={props.frontImage} alt={props.alt} loading="lazy" />}
    >
      <div class="card-flip" classList={{ flipped: props.flipped }}>
        <img class="card-flip-front" src={props.frontImage} alt={props.alt} loading="lazy" />
        <img
          class="card-flip-back"
          src={props.backImage}
          alt={t('site.card.backFaceAlt', { name: props.alt })}
          loading="lazy"
        />
      </div>
    </Show>
  )
}

/**
 * Translucent "flip" button shown on hover over a double-faced card in the
 * image views (binder / overlap / stack). Toggles between the front and back
 * face; pressing it again on the back flips it back to the front.
 */
type FlipButtonProps = {
  flipped: boolean
  onFlip: () => void
}

const FlipButton: Component<FlipButtonProps> = (props) => {
  const t = useT()
  const label = () => (props.flipped ? t('site.card.showFront') : t('site.card.showBack'))
  return (
    <button
      type="button"
      class="card-flip-btn"
      classList={{ flipped: props.flipped }}
      onClick={stopPropAnd(props.onFlip)}
      title={label()}
      aria-label={label()}
    >
      ⇄
    </button>
  )
}

/**
 * The art shown for a tile whose card never resolved: its custom art when it
 * has some, else the card's name on the empty placeholder. Custom art is the
 * entry's own image rather than the printing's, so it renders even with no
 * Scryfall object behind it — the case a proxy of an unknown card is exactly.
 */
type EmptyCardFaceProps = {
  name: string
  customArt?: string
}

const EmptyCardFace: Component<EmptyCardFaceProps> = (props) => (
  <Show when={props.customArt} fallback={<span class="card-empty-label">{props.name}</span>}>
    {(art) => <img src={art()} alt={props.name} loading="lazy" />}
  </Show>
)

export const CardItem: Component<CardItemProps> = (props) => {
  const t = useT()
  // Memoized because each view mode reads it twice (the `disabled` binding and
  // the tooltip's ternary) and the callers compute it by scanning the trade
  // board — without this every board mutation runs that scan twice per tile.
  const tradeDisabled = createMemo(() => props.addToTradeDisabled)
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
            <div class="card-binder" classList={{ 'card-binder--empty': !props.customArt }}>
              <EmptyCardFace name={props.name} customArt={props.customArt} />
            </div>
          </Show>
          <Show when={props.viewMode === 'list'}>
            <div
              class="card-list card-list--empty"
              onMouseEnter={() => {
                if (props.customArt) props.onTooltipEnter?.(props.customArt, false)
              }}
              onMouseLeave={() => props.onTooltipLeave?.()}
            >
              <Show when={!props.hideCount}>
                <span class="list-qty">{props.quantity}</span>
              </Show>
              <span class="list-name">{props.name}</span>
            </div>
          </Show>
          <Show when={props.viewMode === 'overlap' || props.viewMode === 'stack'}>
            <div class="card-overlap" classList={{ 'card-overlap--empty': !props.customArt }}>
              <EmptyCardFace name={props.name} customArt={props.customArt} />
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
        // A memo, not a plain accessor: every view mode reads it two or three
        // times per render (front, back, flip test), and each read would
        // otherwise rebuild the pair.
        const images = createMemo(() =>
          resolveCardImageSources(card(), Boolean(props.useScryfallImgUrls), props.customArt),
        )
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
          return rawFinish ? finishName(t, rawFinish) : null
        }

        // Uppercased for display, like set codes; null when the entry is English.
        const entryLanguageBadge = () => languageBadge(props.collectionLanguage)

        // The parenthetical after the name in the art views: finish, language, or
        // "Foil · JA" when both apply. Empty string (falsy) when neither does.
        const finishLanguageLabel = () =>
          [finishLabel(), entryLanguageBadge()]
            .filter((part): part is string => Boolean(part))
            .join(' · ')

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
        // A proxy or custom-art copy shows its marker where the price would be —
        // it is worth nothing, and "$0.00" would read as a price rather than as
        // the refusal to quote one.
        const pricelessMarker = () => pricelessMarkerText(t, props.priceless)
        const showPrice = () => pricelessMarker() !== undefined || displayPrice() > 0
        const buylistPrice = () => props.buylistPrice ?? 0
        const showBuylist = () => buylistPrice() > 0
        // One source for both view modes: the label had to be corrected twice
        // the last time its wording changed.
        const buylistLabel = () =>
          t('site.card.buylistOffer', { price: formatPrice(buylistPrice(), BUYLIST_CURRENCY) })

        // Buylist quotes are always the buyer's own currency (USD cash), never
        // the page's display currency, so this is formatted with BUYLIST_CURRENCY
        // and labeled — an unlabeled second figure beside a EUR price would read
        // as another EUR price.
        const priceRun = () => (
          <Show when={showPrice() || showBuylist()}>
            <span class="card-label-prices">
              <Show when={showPrice()}>
                <span class="card-label-price">
                  {pricelessMarker() ?? formatPrice(displayPrice(), currency())}
                </span>
              </Show>
              <Show when={showBuylist()}>
                <span class="card-label-buylist" title={t('site.card.buylistTitle')}>
                  {buylistLabel()}
                </span>
              </Show>
            </span>
          </Show>
        )

        // List view groups the printing identity (set:number, finish, condition) into a
        // single parenthesised label rendered next to the card name. Reuses finishLabel so
        // the capitalised finish stays consistent with the binder/overlap views.
        const printingLabel = () => {
          const parts = [
            props.collectionSetCN,
            finishLabel(),
            props.collectionCondition,
            entryLanguageBadge(),
          ].filter((part): part is string => Boolean(part))
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
                        title={t('site.card.addCopy')}
                      >
                        +
                      </button>
                      <button
                        class="edit-btn edit-btn-decrement"
                        onClick={stopPropAnd(props.onDecrement)}
                        title={t('site.card.removeCopy')}
                      >
                        −
                      </button>
                    </Show>
                    <Show when={props.onContextMenu}>
                      <button
                        class="edit-btn edit-btn-context"
                        onClick={(e) => stopPropAndRect(props.onContextMenu)(e)}
                        title={t('site.card.moreOptions')}
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
                      title={t('site.card.moveTo')}
                      aria-label={t('site.card.moveTo')}
                    >
                      →
                    </button>
                  </div>
                </Show>
                <Show when={props.onAddToTrade !== undefined}>
                  <button
                    class="card-trade-btn"
                    onClick={stopPropAnd(props.onAddToTrade)}
                    disabled={tradeDisabled()}
                    title={
                      tradeDisabled() ? t('site.card.atMaxQuantity') : t('site.card.addToTrade')
                    }
                    aria-label={t('site.card.addToTrade')}
                  >
                    +
                  </button>
                </Show>
                <div class="card-label">
                  <span class="card-label-name">
                    {props.name}
                    <Show when={finishLanguageLabel()}>
                      {(label) => <span class="card-label-finish"> ({label()})</span>}
                    </Show>
                    {badgeRun()}
                  </span>
                  {priceRun()}
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
                    {(label) => <span class="list-printing">{label()}</span>}
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
                        title={t('site.card.addCopy')}
                      >
                        +
                      </button>
                      <button
                        class="edit-btn-list"
                        onClick={stopPropAnd(props.onDecrement)}
                        title={t('site.card.removeCopy')}
                      >
                        −
                      </button>
                    </Show>
                    <Show when={props.onContextMenu}>
                      <button
                        class="edit-btn-list"
                        onClick={(e) => stopPropAndRect(props.onContextMenu)(e)}
                        title={t('site.card.moreOptions')}
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
                      title={t('site.card.moveTo')}
                      aria-label={t('site.card.moveTo')}
                    >
                      →
                    </button>
                  </span>
                </Show>
                <Show when={props.onAddToTrade !== undefined}>
                  <button
                    class="list-trade-btn"
                    onClick={stopPropAnd(props.onAddToTrade)}
                    disabled={tradeDisabled()}
                    title={
                      tradeDisabled() ? t('site.card.atMaxQuantity') : t('site.card.addToTrade')
                    }
                  >
                    {t('site.card.tradeButton')}
                  </button>
                </Show>
                <span class="list-price">
                  {pricelessMarker() ?? formatPriceOrNA(displayPrice(), currency())}
                </span>
                <Show when={showBuylist()}>
                  <span class="list-buylist-price" title={t('site.card.buylistTitle')}>
                    {buylistLabel()}
                  </span>
                </Show>
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
                        title={t('site.card.addCopy')}
                      >
                        +
                      </button>
                      <button
                        class="edit-btn edit-btn-decrement"
                        onClick={stopPropAnd(props.onDecrement)}
                        title={t('site.card.removeCopy')}
                      >
                        −
                      </button>
                    </Show>
                    <Show when={props.onContextMenu}>
                      <button
                        class="edit-btn edit-btn-context"
                        onClick={(e) => stopPropAndRect(props.onContextMenu)(e)}
                        title={t('site.card.moreOptions')}
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
                      title={t('site.card.moveTo')}
                      aria-label={t('site.card.moveTo')}
                    >
                      →
                    </button>
                  </div>
                </Show>
                <Show when={props.onAddToTrade !== undefined}>
                  <button
                    class="card-trade-btn"
                    onClick={stopPropAnd(props.onAddToTrade)}
                    disabled={tradeDisabled()}
                    title={
                      tradeDisabled() ? t('site.card.atMaxQuantity') : t('site.card.addToTrade')
                    }
                    aria-label={t('site.card.addToTrade')}
                  >
                    +
                  </button>
                </Show>
                <div class="card-label">
                  <span class="card-label-name">
                    {props.name}
                    <Show when={finishLanguageLabel()}>
                      {(label) => <span class="card-label-finish"> ({label()})</span>}
                    </Show>
                    {badgeRun()}
                  </span>
                  {priceRun()}
                </div>
              </div>
            </Show>
          </div>
        )
      }}
    </Show>
  )
}
