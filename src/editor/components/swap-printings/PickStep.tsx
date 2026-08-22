import {
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  type Accessor,
  type Component,
} from 'solid-js'
import type { Finish, ScryfallCard } from '../../../types'
import type { PriceCurrency } from '../../../price-currency'
import { scryfallCardLanguage, storedLanguage } from '../../../card-language'
import { dedupePrintingsByKey, type CardPrintingsLookup } from '../../../card-printing'
import { filterPrintingsByQuery } from '../../../collector-query'
import { getCardImageUrl } from '../../../card-image'
import { defaultPrintingFinish, displayFinish, printingFinishes } from '../../../finish-condition'
import { formatPrintingLabel } from '../../../printing-key'
import { PrintingPrices } from '../../../site/PrintingPrices'
import { usePrintingQuotes } from '../../../site/printing-quotes'
import { finishChipName } from '../../../site/printing-display'
import { useT } from '../../../ui/i18n'
import { PrintingFilter } from '../../../ui/PrintingFilter'
import { candidatePrice, currentPrintingPrice } from '../../swap-printings'
import type {
  CardSwapPlan,
  ChosenPrinting,
  FinishFilter,
  PriceOf,
  SwapCandidate,
} from '../../swap-printings'
import {
  assignedCount,
  clampTakeCount,
  filterPickerRows,
  remainingAvailable,
  takeCountCeiling,
  type TakeCountBounds,
} from '../../swap-printings/wizard-state'
import { FinishFilterToggle } from './ModeStep'
import {
  CardThumb,
  FinishChip,
  LanguageChip,
  ListName,
  PriceText,
  useCardPreviewHandlers,
  candidatePrintingLabel,
  targetPrintingLabel,
} from './shared'

export type PickStepProps = {
  plan: Accessor<CardSwapPlan>
  /** Copies of each candidate group already claimed by other cards' plans. */
  consumed: Accessor<ReadonlyMap<string, number>>
  /** Position in the pick queue, 1-based, and its length. */
  index: number
  total: number
  onPrev: (() => void) | null
  onNext: (() => void) | null
  /** Set the copies taken from a candidate (0 drops it); `printing` for a printingless candidate. */
  onSetCount: (candidate: SwapCandidate, count: number, printing?: ChosenPrinting) => void
  finish: Accessor<FinishFilter>
  setFinish: (filter: FinishFilter) => void
  query: Accessor<string>
  setQuery: (query: string) => void
  /** Whether the step is showing (gates the type-anywhere capture). */
  active: Accessor<boolean>
  printings: CardPrintingsLookup
  priceOf: PriceOf
  currency: PriceCurrency
}

/**
 * The picker's inner view: the candidate rows, the printing-less prompt, or the
 * full printing grid for one printing-less candidate (`requested` is the count
 * the user asked for before the grid opened).
 */
type PickView =
  | { kind: 'rows' }
  | { kind: 'prompt' }
  | { kind: 'grid'; candidate: SwapCandidate; requested: number }

/** The grid view's payload. */
type GridView = Extract<PickView, { kind: 'grid' }>

/**
 * Step 4: one card's picker. Candidate rows list every copy the chosen
 * sources hold (after the finish quick-filter and the collector-grammar
 * query), each with a take-count control; printing-less rows route through the
 * "is it one of these?" prompt and then the full printing grid.
 */
export const PickStep: Component<PickStepProps> = (props) => {
  const t = useT()
  const [view, setView] = createSignal<PickView>({ kind: 'rows' })

  const target = (): CardSwapPlan['target'] => props.plan().target
  const rows = createMemo<SwapCandidate[]>(() =>
    filterPickerRows(props.plan().candidates, props.finish(), props.query()),
  )
  const printinglessCandidates = createMemo<SwapCandidate[]>(() =>
    props.plan().candidates.filter((candidate) => candidate.kind === 'printingless'),
  )
  const assigned = (): number => assignedCount(props.plan())
  const countFor = (candidate: SwapCandidate): number =>
    props.plan().allocations.find((a) => a.candidate.key === candidate.key)?.count ?? 0
  const chosenFor = (candidate: SwapCandidate): ChosenPrinting | undefined =>
    props.plan().allocations.find((a) => a.candidate.key === candidate.key)?.printing
  const availableFor = (candidate: SwapCandidate): number =>
    remainingAvailable(candidate, props.consumed())
  /** What a row's take-count may range over, given the card's other rows. */
  const boundsFor = (candidate: SwapCandidate): TakeCountBounds => ({
    available: availableFor(candidate),
    quantity: target().quantity,
    assignedElsewhere: assigned() - countFor(candidate),
  })
  // The full printing list for the printing-less grid, fetched once per card:
  // the name is latched when the grid first opens so closing and reopening the
  // grid shows the same list without a refetch.
  const [gridName, setGridName] = createSignal<string | undefined>(undefined)
  const enterGrid = (candidate: SwapCandidate, requested: number): void => {
    setGridName(target().cardName)
    setView({ kind: 'grid', candidate, requested })
  }
  const setCount = (candidate: SwapCandidate, requested: number): void => {
    const count = clampTakeCount(requested, boundsFor(candidate))
    if (candidate.kind === 'printingless' && count > 0 && !chosenFor(candidate)) {
      // A printingless copy needs a printing before it can count.
      enterGrid(candidate, count)
      return
    }
    props.onSetCount(candidate, count)
  }
  const openGrid = (candidate: SwapCandidate): void =>
    enterGrid(candidate, Math.max(1, countFor(candidate)))

  const currentPrice = (): number | null => currentPrintingPrice(target(), props.priceOf)

  const gridView = (): GridView | null => {
    const current = view()
    return current.kind === 'grid' ? current : null
  }
  const [allPrintings] = createResource<ScryfallCard[], string>(gridName, async (name) =>
    dedupePrintingsByKey(await props.printings(name)),
  )
  const gridPrintings = createMemo<ScryfallCard[]>(() =>
    allPrintings.error ? [] : filterPrintingsByQuery(props.query(), allPrintings.latest ?? []),
  )
  // The grid prices printings no list displays, so under the Card Kingdom
  // source their quotes must be requested here — gated on the grid being
  // shown, like the add-card dialog's printing step.
  usePrintingQuotes(() => (gridView() ? (allPrintings.latest ?? []) : []))

  const choosePrinting = (grid: GridView, card: ScryfallCard, finish: Finish): void => {
    const printing: ChosenPrinting = {
      card,
      set: card.set.toLowerCase(),
      collectorNumber: card.collector_number,
      finish,
    }
    const language = storedLanguage(scryfallCardLanguage(card))
    if (language !== undefined) printing.language = language
    const count = clampTakeCount(Math.max(1, grid.requested), boundsFor(grid.candidate))
    props.onSetCount(grid.candidate, count, printing)
    setView({ kind: 'rows' })
  }

  return (
    <div class="swap-wizard-step-body swap-wizard-pick">
      <div class="swap-wizard-step-head">
        <h4 class="swap-wizard-heading">
          {t('ui.swap.pick.heading', { name: target().cardName })}
        </h4>
        <div class="swap-wizard-step-tools">
          <span class="swap-wizard-muted">
            {t('ui.swap.pick.progress', { index: props.index, total: props.total })}
          </span>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            disabled={!props.onPrev}
            onClick={() => props.onPrev?.()}
          >
            {t('ui.swap.pick.prev')}
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            disabled={!props.onNext}
            onClick={() => props.onNext?.()}
          >
            {t('ui.swap.pick.next')}
          </button>
        </div>
      </div>

      <Show when={view().kind === 'rows'}>
        <div class="swap-wizard-pick-filters">
          <FinishFilterToggle
            value={props.finish()}
            onChange={props.setFinish}
            label={t('ui.swap.finish.label')}
          />
          <PrintingFilter value={props.query()} onChange={props.setQuery} active={props.active()} />
        </div>
        <ul class="swap-wizard-rows">
          <li class="swap-wizard-row swap-wizard-keep-row">
            <span class="swap-wizard-row-main">
              <CardThumb card={target().card} name={target().cardName} />
              <span class="swap-wizard-row-text">
                <span class="swap-wizard-row-title">{t('ui.swap.pick.keep')}</span>
                <span class="swap-wizard-row-sub">
                  <span class="swap-wizard-printing">{targetPrintingLabel(target())}</span>
                  <FinishChip finish={displayFinish(target().card, target().finish)} />
                  <LanguageChip language={target().language} />
                  <PriceText price={currentPrice()} currency={props.currency} />
                </span>
              </span>
              <span class="swap-wizard-qty">
                {t('ui.swap.copies', { count: props.plan().keep })}
              </span>
            </span>
          </li>
          <Show when={props.plan().candidates.length === 0}>
            <li class="empty-state">{t('ui.swap.pick.noCandidates')}</li>
          </Show>
          <Show when={props.plan().candidates.length > 0 && rows().length === 0}>
            <li class="empty-state">{t('ui.printingFilter.noMatches')}</li>
          </Show>
          <For each={rows()}>
            {(candidate) => (
              <li
                class="swap-wizard-row swap-wizard-candidate-row"
                classList={{
                  'swap-wizard-row--taken': countFor(candidate) > 0,
                  'swap-wizard-row--exhausted': availableFor(candidate) === 0,
                }}
              >
                <span class="swap-wizard-row-main">
                  <CardThumb
                    card={chosenFor(candidate)?.card ?? candidate.card}
                    name={target().cardName}
                  />
                  <span class="swap-wizard-row-text">
                    <span class="swap-wizard-row-title">
                      <ListName list={candidate.source} />
                    </span>
                    <span class="swap-wizard-row-sub">
                      <Show
                        when={candidate.kind === 'printing'}
                        fallback={
                          <PrintinglessRowDetail
                            chosen={chosenFor(candidate)}
                            currency={props.currency}
                            priceOf={props.priceOf}
                            onOpen={() => setView({ kind: 'prompt' })}
                            onChange={() => openGrid(candidate)}
                          />
                        }
                      >
                        <span class="swap-wizard-printing">
                          {candidatePrintingLabel(candidate)}
                        </span>
                        <FinishChip finish={candidate.finish} />
                        <LanguageChip language={candidate.language} />
                        <PriceText
                          price={candidatePrice(candidate, props.priceOf)}
                          currency={props.currency}
                        />
                      </Show>
                      <span class="swap-wizard-muted">
                        {t('ui.swap.pick.available', { count: availableFor(candidate) })}
                      </span>
                    </span>
                  </span>
                  <TakeCount
                    value={countFor(candidate)}
                    max={takeCountCeiling(boundsFor(candidate))}
                    onChange={(next) => setCount(candidate, next)}
                  />
                </span>
              </li>
            )}
          </For>
        </ul>
        <p class="swap-wizard-note" role="status">
          {t('ui.swap.pick.assigned', { assigned: assigned(), total: target().quantity })}
        </p>
      </Show>

      <Show when={view().kind === 'prompt'}>
        <div class="swap-wizard-prompt">
          <h5 class="swap-wizard-subheading">{t('ui.swap.pick.printinglessPrompt')}</h5>
          <p class="swap-wizard-note">{t('ui.swap.pick.printinglessHint')}</p>
          <ul class="swap-wizard-rows">
            <For each={printinglessCandidates()}>
              {(candidate) => (
                <li class="swap-wizard-row">
                  <button
                    type="button"
                    class="swap-wizard-row-main btn-unstyled swap-wizard-row-button"
                    onClick={() => openGrid(candidate)}
                  >
                    <span class="swap-wizard-row-text">
                      <span class="swap-wizard-row-title">
                        <ListName list={candidate.source} />
                      </span>
                      <span class="swap-wizard-row-sub swap-wizard-muted">
                        {t('ui.swap.pick.available', { count: availableFor(candidate) })}
                      </span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <button type="button" class="btn btn-secondary" onClick={() => setView({ kind: 'rows' })}>
            {t('ui.swap.pick.printinglessNo')}
          </button>
        </div>
      </Show>

      <Show when={gridView()}>
        {(grid) => (
          <div class="swap-wizard-grid-view">
            <div class="swap-wizard-step-tools">
              <button
                type="button"
                class="search-tab-btn"
                onClick={() => setView({ kind: 'rows' })}
              >
                {t('ui.swap.pick.backToRows')}
              </button>
              <h5 class="swap-wizard-subheading">
                {t('ui.swap.pick.choosePrinting', { name: target().cardName })}
              </h5>
            </div>
            <PrintingFilter
              value={props.query()}
              onChange={props.setQuery}
              active={props.active()}
            />
            <Show when={allPrintings.error}>
              <p class="swap-wizard-note swap-wizard-note--warning" role="status">
                {t('ui.swap.pick.printingsFailed')}
              </p>
            </Show>
            <Show
              when={!allPrintings.loading}
              fallback={<div class="empty-state">{t('ui.addCard.loadingPrintings')}</div>}
            >
              <Show when={!allPrintings.error && gridPrintings().length === 0}>
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
                          onClick={() =>
                            choosePrinting(grid(), printing, defaultPrintingFinish(printing))
                          }
                        >
                          <Show when={imageUrl}>
                            {(url) => <img src={url()} alt={printing.name} loading="lazy" />}
                          </Show>
                          <div class="printing-label">
                            <span class="printing-label-set">
                              {formatPrintingLabel(printing.set, printing.collector_number)}
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
                                  onClick={() => choosePrinting(grid(), printing, finish)}
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
          </div>
        )}
      </Show>
    </div>
  )
}

type PrintinglessRowDetailProps = {
  chosen: ChosenPrinting | undefined
  currency: PriceCurrency
  priceOf: PriceOf
  onOpen: () => void
  onChange: () => void
}

/** The printing half of a printing-less row: "No printing set" until a printing is chosen, then its label. */
const PrintinglessRowDetail: Component<PrintinglessRowDetailProps> = (props) => {
  const t = useT()
  return (
    <Show
      when={props.chosen}
      fallback={
        <button type="button" class="swap-wizard-link" onClick={props.onOpen}>
          {t('ui.swap.pick.printingless')}
        </button>
      }
    >
      {(chosen) => (
        <>
          <span class="swap-wizard-printing">
            {t('ui.swap.pick.chosen', {
              printing: formatPrintingLabel(chosen().set, chosen().collectorNumber),
            })}
          </span>
          <FinishChip finish={chosen().finish} />
          <LanguageChip language={chosen().language} />
          <PriceText
            price={props.priceOf(chosen().card, chosen().finish, chosen().language)}
            currency={props.currency}
          />
          <button type="button" class="swap-wizard-link" onClick={props.onChange}>
            {t('ui.swap.pick.changePrinting')}
          </button>
        </>
      )}
    </Show>
  )
}

type TakeCountProps = {
  value: number
  max: number
  onChange: (next: number) => void
}

/** The −/N/+ control deciding how many copies a row supplies. */
const TakeCount: Component<TakeCountProps> = (props) => {
  const t = useT()
  return (
    <span class="swap-wizard-take">
      <button
        type="button"
        class="swap-wizard-take-btn"
        aria-label={t('ui.quantity.decreaseLabel')}
        disabled={props.value <= 0}
        onClick={() => props.onChange(props.value - 1)}
      >
        −
      </button>
      <input
        type="number"
        class="swap-wizard-take-input"
        aria-label={t('ui.swap.pick.take')}
        min={0}
        max={props.max}
        value={props.value}
        // Committed on change (blur / Enter) rather than per keystroke, then the
        // clamped value is written back: when the clamp lands on the count the
        // row already held, no signal changes and the bound `value` would not
        // otherwise overwrite what was typed.
        onChange={(e) => {
          props.onChange(e.currentTarget.valueAsNumber)
          e.currentTarget.value = String(props.value)
        }}
      />
      <button
        type="button"
        class="swap-wizard-take-btn"
        aria-label={t('ui.quantity.increaseLabel')}
        disabled={props.value >= props.max}
        onClick={() => props.onChange(props.value + 1)}
      >
        +
      </button>
    </span>
  )
}
