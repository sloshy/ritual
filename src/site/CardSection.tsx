import type { JSX } from 'solid-js'
import { Show, For } from 'solid-js'
import type { CardData } from '../list-view/card-sorting'
import type { PriceCurrency } from '../pricing/price-currency'
import { formatPrice } from '../pricing/price-currency'
import { groupTotalPrice } from '../list-view/card-sorting'
import { pricesEnabled } from '../list-view/price-view'
import { foldCardCategory, primaryCardCategory, type CardCategory } from '../card/card-categories'
import { useT } from '../ui/i18n'

interface CardSectionProps<T extends CardData = CardData> {
  label: string
  cards: T[]
  currency: PriceCurrency
  renderCard: (card: T, index: number) => JSX.Element
  /**
   * The category this section *is*, under the "Categories (all)" grouping. When
   * given, each tile is wrapped in a `.card-slot` — every tile, so the grid stays
   * uniform — and the ones whose primary category differs get
   * `.card-slot--secondary` plus an "also" marker naming their primary. Absent
   * for every other grouping, where the tiles render exactly as before.
   */
  secondaryOf?: CardCategory
}

export function CardSection<T extends CardData = CardData>(
  props: CardSectionProps<T>,
): JSX.Element {
  const t = useT()
  const sectionId = () => props.label.replace(/[^a-zA-Z0-9]/g, '_')
  const sectionTotal = () => groupTotalPrice(props.cards)
  // Folded on both sides for the same reason the grouper buckets by fold: two
  // spellings of one category are one category.
  const isSecondary = (card: T): boolean =>
    props.secondaryOf !== undefined &&
    foldCardCategory(primaryCardCategory(card.categories) ?? '') !==
      foldCardCategory(props.secondaryOf)

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
          <Show when={props.secondaryOf !== undefined && props.cards.some(isSecondary)}>
            <span class="section-note">{t('site.cardSection.secondaryCountNote')}</span>
          </Show>
          <Show when={pricesEnabled()}>
            <span class="section-price">{formatPrice(sectionTotal(), props.currency)}</span>
          </Show>
        </div>
        <div class="binder-grid">
          <For each={props.cards}>
            {(card, i) => (
              <Show when={props.secondaryOf !== undefined} fallback={props.renderCard(card, i())}>
                <div class={`card-slot${isSecondary(card) ? ' card-slot--secondary' : ''}`}>
                  {props.renderCard(card, i())}
                  <Show when={isSecondary(card)}>
                    <span
                      class="card-secondary-marker"
                      title={t('site.cardSection.alsoTitle', {
                        primary: primaryCardCategory(card.categories) ?? '',
                      })}
                    >
                      {t('site.cardSection.alsoMarker')}
                    </span>
                  </Show>
                </div>
              </Show>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
