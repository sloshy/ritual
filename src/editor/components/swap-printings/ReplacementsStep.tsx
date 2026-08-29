import { batch, createSignal, For, Show, type Accessor, type Component } from 'solid-js'
import type { PriceCurrency } from '../../../pricing/price-currency'
import type { CardPrintingsLookup } from '../../../card/card-printing'
import { printingLabel } from '../../../card/card-line-tail'
import { useT } from '../../../ui/i18n'
import { replacementKey } from '../../swap-printings'
import type { ChosenPrinting, PriceOf, SwapMove } from '../../swap-printings'
import { PrintingGrid, chosenFromGrid } from './PrintingGrid'
import {
  CardThumb,
  FinishChip,
  LanguageChip,
  ListName,
  PriceText,
  useCardPreviewHandlers,
} from './shared'

export type ReplacementsStepProps = {
  /** The planned `in` moves that pin name-only cards — one row per source list and printing taken. */
  moves: Accessor<SwapMove[]>
  /** The replacement chosen per {@link replacementKey}; a missing entry means none. */
  picks: Accessor<ReadonlyMap<string, ChosenPrinting>>
  onPick: (key: string, printing: ChosenPrinting | undefined) => void
  query: Accessor<string>
  setQuery: (query: string) => void
  /** Whether the step is showing (gates the type-anywhere capture). */
  active: Accessor<boolean>
  printings: CardPrintingsLookup
  priceOf: PriceOf
  currency: PriceCurrency
}

/** One row of the step: the moves sharing a replacement key, folded to one line. */
type ReplacementRow = { key: string; move: SwapMove; count: number }

/** The move a grid choice is for. */
type GridTarget = { key: string; cardName: string }

/**
 * The Replacements step: for every printing the pinning moves take out of a
 * source list, an optional printing that list receives back — a source deck
 * that lent its copy still lists the card afterwards, under the printing the
 * user says it now runs. Rows without a pick leave the source one copy short.
 */
export const ReplacementsStep: Component<ReplacementsStepProps> = (props) => {
  const t = useT()
  const [grid, setGrid] = createSignal<GridTarget | null>(null)
  const rows = (): ReplacementRow[] => {
    const byKey = new Map<string, ReplacementRow>()
    for (const move of props.moves()) {
      const key = replacementKey(move)
      const row = byKey.get(key)
      if (row) row.count += move.count
      else byKey.set(key, { key, move, count: move.count })
    }
    return [...byKey.values()]
  }

  return (
    <div class="swap-wizard-step-body">
      <Show
        when={grid()}
        fallback={
          <>
            <h4 class="swap-wizard-heading">{t('ui.swap.replacements.heading')}</h4>
            <p class="swap-wizard-note">{t('ui.swap.replacements.hint')}</p>
            <ul class="swap-wizard-rows">
              <For each={rows()}>
                {(row) => {
                  const pick = (): ChosenPrinting | undefined => props.picks().get(row.key)
                  return (
                    <li
                      class="swap-wizard-row swap-wizard-replacement-row"
                      classList={{ 'swap-wizard-row--taken': pick() !== undefined }}
                    >
                      <span class="swap-wizard-row-main">
                        <CardThumb card={pick()?.card ?? row.move.card} name={row.move.cardName} />
                        <span class="swap-wizard-row-text">
                          <span class="swap-wizard-row-title">
                            {t('ui.swap.replacements.taken', {
                              count: row.count,
                              name: row.move.cardName,
                              printing: printingLabel(row.move.set, row.move.collectorNumber),
                            })}{' '}
                            <ListName list={row.move.from} />
                          </span>
                          <span class="swap-wizard-row-sub">
                            <Show
                              when={pick()}
                              fallback={
                                <span class="swap-wizard-muted">
                                  {t('ui.swap.replacements.none')}
                                </span>
                              }
                            >
                              {(chosen) => (
                                <span {...useCardPreviewHandlers(() => chosen().card)}>
                                  <span class="swap-wizard-printing">
                                    {t('ui.swap.replacements.chosen', {
                                      count: row.count,
                                      printing: printingLabel(
                                        chosen().set,
                                        chosen().collectorNumber,
                                      ),
                                    })}
                                  </span>
                                  <FinishChip finish={chosen().finish} />
                                  <LanguageChip language={chosen().language} />
                                  <PriceText
                                    price={props.priceOf(
                                      chosen().card,
                                      chosen().finish,
                                      chosen().language,
                                    )}
                                    currency={props.currency}
                                  />
                                </span>
                              )}
                            </Show>
                          </span>
                        </span>
                        <span class="swap-wizard-step-tools">
                          <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            onClick={() =>
                              batch(() => {
                                props.setQuery('')
                                setGrid({ key: row.key, cardName: row.move.cardName })
                              })
                            }
                          >
                            {pick()
                              ? t('ui.swap.pick.changePrinting')
                              : t('ui.swap.replacements.choose')}
                          </button>
                          <Show when={pick()}>
                            <button
                              type="button"
                              class="btn btn-secondary btn-sm"
                              onClick={() => props.onPick(row.key, undefined)}
                            >
                              {t('ui.swap.replacements.clear')}
                            </button>
                          </Show>
                        </span>
                      </span>
                    </li>
                  )
                }}
              </For>
            </ul>
          </>
        }
      >
        {(target) => (
          <div class="swap-wizard-grid-view">
            <div class="swap-wizard-step-tools">
              <button type="button" class="search-tab-btn" onClick={() => setGrid(null)}>
                {t('ui.swap.replacements.backToRows')}
              </button>
              <h5 class="swap-wizard-subheading">
                {t('ui.swap.pick.choosePrinting', { name: target().cardName })}
              </h5>
            </div>
            <PrintingGrid
              cardName={() => target().cardName}
              printings={props.printings}
              query={props.query}
              setQuery={props.setQuery}
              active={() => props.active() && grid() !== null}
              currency={props.currency}
              onChoose={(card, finish) =>
                batch(() => {
                  props.onPick(target().key, chosenFromGrid(card, finish))
                  setGrid(null)
                })
              }
            />
          </div>
        )}
      </Show>
    </div>
  )
}
