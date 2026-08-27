import { For, Show, type Component } from 'solid-js'
import { useT } from '../../../ui/i18n'
import type { ScryfallCard } from '../../../scryfall/types'
import { getCardImageUrl } from '../../../card/card-image'
import { languageBadge, scryfallCardLanguage } from '../../../card/card-language'
import { PrintingFilter } from '../../../ui/PrintingFilter'
import { PriceSourceSelect } from '../../../list-view/PriceSourceSelect'
import { PrintingPrices } from '../../../list-view/PrintingPrices'
import type { PrintingCellOffset } from '../../printing-pagination'
import { PICKER_CURRENCY } from '../../card-search/add-resolution'
import { AddOptionsRow, type AddOptionsRowProps } from '../AddCardOptions'
import { StepHeader } from './StepHeader'

export type PrintingStepProps = AddOptionsRowProps & {
  cardName: string
  loading: boolean
  /** Whether any printing was fetched at all (an empty grid under a live filter says "no matches"). */
  hasPrintings: boolean
  /** The grid's rows narrowed by the collector query, and the page of them shown. */
  visibleCount: number
  paginatedPrintings: ScryfallCard[]
  /** Index into the visible printings of the first printing on the current page. */
  pageStart: number
  page: number
  totalPages: number
  highlightIndex: number
  cellOffset: PrintingCellOffset
  filter: string
  /** Whether the step is on screen — the type-to-filter capture gate. */
  active: boolean
  setFilterFellBack: boolean
  filterSets: readonly string[]
  /** Every commit path goes dead while the options row refuses the typed art. */
  blocked: boolean
  gridRef: (el: HTMLDivElement) => void
  onFilter: (value: string) => void
  onPage: (page: number) => void
  /** `null` commits "No specific printing". */
  onSelect: (printing: ScryfallCard | null) => void
  onBack: () => void
}

/** Step 2: pick a printing from the grid. */
export const PrintingStep: Component<PrintingStepProps> = (props) => {
  const t = useT()
  return (
    <>
      <StepHeader
        onBack={props.onBack}
        heading={t('ui.addCard.selectPrinting', { name: props.cardName })}
      >
        <PriceSourceSelect currency={PICKER_CURRENCY} id="add-card-price-source" />
      </StepHeader>
      <PrintingFilter value={props.filter} onChange={props.onFilter} active={props.active} />
      <div class="search-modal-body">
        <Show
          when={!props.loading}
          fallback={<div class="empty-state">{t('ui.addCard.loadingPrintings')}</div>}
        >
          <Show when={props.setFilterFellBack}>
            <div class="search-modal-hint">
              {t('ui.addCard.setFilterFellBack', {
                sets: props.filterSets.map((code) => code.toUpperCase()).join(', '),
              })}
            </div>
          </Show>
          <Show when={props.visibleCount === 0 && props.hasPrintings}>
            <div class="empty-state">{t('ui.printingFilter.noMatches')}</div>
          </Show>
          <div class="printing-select-grid" ref={props.gridRef}>
            <Show when={props.cellOffset === 1 && props.page === 0}>
              <button
                class={`printing-no-printing${props.highlightIndex === 0 ? ' printing-no-printing--highlighted' : ''}`}
                disabled={props.blocked}
                onClick={() => props.onSelect(null)}
              >
                {t('ui.addCard.noSpecificPrinting')}
              </button>
            </Show>
            <For each={props.paginatedPrintings}>
              {(printing, i) => {
                const cellIdx = (): number => props.pageStart + i() + props.cellOffset
                const imageUrl = getCardImageUrl(printing)
                return (
                  <button
                    class={`printing-select-card btn-unstyled${cellIdx() === props.highlightIndex ? ' printing-select-card--highlighted' : ''}`}
                    // A tile is a commit, so it goes dead with the rest of
                    // the add flow while the options row refuses the art.
                    disabled={props.blocked}
                    onClick={() => props.onSelect(printing)}
                  >
                    <Show when={imageUrl}>
                      {(url) => <img src={url()} alt={printing.name} loading="lazy" />}
                    </Show>
                    {/* A printing whose default object is non-English (e.g. a
                        Japanese-only alternate) wears its language code. */}
                    <Show when={languageBadge(scryfallCardLanguage(printing))}>
                      {(badge) => <span class="printing-lang-badge">{badge()}</span>}
                    </Show>
                    <div class="printing-label">
                      <span class="printing-label-set">
                        {printing.set.toUpperCase()} #{printing.collector_number}
                      </span>
                      {' · '}
                      <PrintingPrices
                        printing={printing}
                        currency={PICKER_CURRENCY}
                        class="printing-label-price"
                      />
                    </div>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
      </div>
      <Show when={props.totalPages > 1}>
        <div class="printing-select-pagination">
          <button disabled={props.page === 0} onClick={() => props.onPage(props.page - 1)}>
            {t('ui.addCard.prevPage')}
          </button>
          <span>
            {t('ui.addCard.pageOf', {
              page: props.page + 1,
              total: props.totalPages,
            })}
          </span>
          <button
            disabled={props.page >= props.totalPages - 1}
            onClick={() => props.onPage(props.page + 1)}
          >
            {t('ui.addCard.nextPage')}
          </button>
        </div>
      </Show>
      <AddOptionsRow addOptions={props.addOptions} options={props.options} />
    </>
  )
}
