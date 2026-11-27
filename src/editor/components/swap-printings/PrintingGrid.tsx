import {
  createDeferred,
  createMemo,
  For,
  isPending,
  Show,
  type Accessor,
  type Component,
} from 'solid-js'
import {
  type Finish,
  defaultPrintingFinish,
  printingFinishes,
} from '../../../card/finish-condition'
import type { ScryfallCard } from '../../../scryfall/types'
import type { PriceCurrency } from '../../../pricing/price-currency'
import { dedupePrintingsByKey, type CardPrintingsLookup } from '../../../card/card-printing'
import { filterPrintingsByQuery } from '../../../card/collector-query'
import { getCardImageUrl } from '../../../card/card-image'
import { scryfallCardLanguage, storedLanguage } from '../../../card/card-language'
import { printingLabel } from '../../../card/card-line-tail'
import { PrintingPrices } from '../../../list-view/PrintingPrices'
import { usePrintingQuotes } from '../../../list-view/printing-quotes'
import { finishChipName } from '../../../list-view/printing-display'
import { useT } from '../../../ui/i18n'
import { PrintingFilter } from '../../../ui/PrintingFilter'
import type { ChosenPrinting } from '../../swap-printings'
import { useCardPreviewHandlers } from './shared'

export type PrintingGridProps = {
  /** The card whose every Scryfall printing is offered. */
  cardName: Accessor<string>
  printings: CardPrintingsLookup
  query: Accessor<string>
  setQuery: (query: string) => void
  /** Whether the grid is showing (gates the type-anywhere capture and the quote fetch). */
  active: Accessor<boolean>
  currency: PriceCurrency
  /** A printing was chosen at a finish (the tile's default, or a finish chip's). */
  onChoose: (card: ScryfallCard, finish: Finish) => void
}

/** One card's printing load: what arrived, and whether the fetch failed. */
type PrintingsLoad = { printings: ScryfallCard[]; failed: boolean }

/**
 * The full printing grid the wizard chooses arbitrary printings from — for a
 * printing-less candidate (which printing is it?) and for a source list's
 * replacement (which printing does it get back?): every Scryfall printing of
 * the card under the collector-grammar type-to-filter, each tile choosing its
 * default finish and offering a chip per further finish.
 */
export const PrintingGrid: Component<PrintingGridProps> = (props) => {
  const t = useT()
  // Deferred with an `undefined` loading value: nothing suspends, a new card
  // keeps the last grid on screen until its printings land (`isPending` shows
  // the wait), and a failed load is an answer of its own rather than a throw.
  const allPrintings = createDeferred<PrintingsLoad | undefined>(
    async () => {
      const name = props.cardName()
      try {
        return { printings: dedupePrintingsByKey(await props.printings(name)), failed: false }
      } catch {
        return { printings: [], failed: true }
      }
    },
    { loadingValue: undefined },
  )
  const loaded = createMemo<ScryfallCard[]>(() => allPrintings()?.printings ?? [])
  const gridPrintings = createMemo<ScryfallCard[]>(() =>
    filterPrintingsByQuery(props.query(), loaded()),
  )
  // The grid prices printings no list displays, so under the Card Kingdom
  // source their quotes must be requested here — gated on the grid being
  // shown, like the add-card dialog's printing step.
  usePrintingQuotes(() => (props.active() ? loaded() : []))

  return (
    <>
      <PrintingFilter value={props.query()} onChange={props.setQuery} active={props.active()} />
      <Show when={allPrintings()?.failed}>
        <p class="swap-wizard-note swap-wizard-note--warning" role="status">
          {t('ui.swap.pick.printingsFailed')}
        </p>
      </Show>
      <Show
        when={allPrintings() !== undefined && !isPending(() => allPrintings())}
        fallback={<div class="empty-state">{t('ui.addCard.loadingPrintings')}</div>}
      >
        <Show when={!allPrintings()?.failed && gridPrintings().length === 0}>
          <div class="empty-state">{t('ui.printingFilter.noMatches')}</div>
        </Show>
        <div class="printing-select-grid">
          <For each={gridPrintings()}>
            {(printing) => {
              const imageUrl = getCardImageUrl(printing)
              const finishes = printingFinishes(printing)
              return (
                <div class="swap-wizard-grid-tile">
                  <button
                    type="button"
                    class="printing-select-card btn-unstyled"
                    {...useCardPreviewHandlers(() => printing)}
                    onClick={() => props.onChoose(printing, defaultPrintingFinish(printing))}
                  >
                    <Show when={imageUrl}>
                      {(url) => <img src={url()} alt={printing.name} loading="lazy" />}
                    </Show>
                    <div class="printing-label">
                      <span class="printing-label-set">
                        {printingLabel(printing.set, printing.collector_number)}
                      </span>
                      {' · '}
                      <PrintingPrices
                        printing={printing}
                        currency={props.currency}
                        class="printing-label-price"
                      />
                    </div>
                  </button>
                  <Show when={finishes.length > 1}>
                    <div class="swap-wizard-grid-finishes">
                      <For each={finishes}>
                        {(finish) => (
                          <button
                            type="button"
                            class="swap-wizard-chip swap-wizard-chip-button"
                            onClick={() => props.onChoose(printing, finish)}
                          >
                            {finishChipName(t, finish)}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </>
  )
}

/** A {@link ChosenPrinting}-shaped record from a grid choice (set lowercase, language when non-English). */
export function chosenFromGrid(card: ScryfallCard, finish: Finish): ChosenPrinting {
  const printing: ChosenPrinting = {
    card,
    set: card.set.toLowerCase(),
    collectorNumber: card.collector_number,
    finish,
  }
  const language = storedLanguage(scryfallCardLanguage(card))
  if (language !== undefined) printing.language = language
  return printing
}
