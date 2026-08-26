import { createMemo, For, Show, type Accessor, type Component } from 'solid-js'
import type { PriceCurrency } from '../../../pricing/price-currency'
import type { ParameterlessKey } from '../../../i18n/t'
import { formatPrintingLabel } from '../../../card/printing-key'
import { useT } from '../../../ui/i18n'
import { allocationPrice, allocationPrinting, currentPrintingPrice } from '../../swap-printings'
import type { AllocatedPrinting, CardSwapPlan, PriceOf, SwapFlag } from '../../swap-printings'
import {
  FinishChip,
  LanguageChip,
  ListName,
  PriceText,
  TargetPrinting,
  useCardPreviewHandlers,
} from './shared'

export type ReviewStepProps = {
  /** The checked targets' keys, in list order — stable, so rows survive re-planning. */
  keys: Accessor<string[]>
  /** The live plan of a target (undefined when the key is unknown). */
  planFor: (key: string) => CardSwapPlan | undefined
  priceOf: PriceOf
  currency: PriceCurrency
  onChange: (key: string) => void
}

const FLAG_LABELS = {
  'no-candidates': 'ui.swap.flag.noCandidates',
  'unpriced-candidates': 'ui.swap.flag.unpriced',
  'needs-manual': 'ui.swap.flag.needsManual',
  partial: 'ui.swap.flag.partial',
  'needs-displaced-destination': 'ui.swap.flag.needsDisplaced',
} as const satisfies Record<SwapFlag, ParameterlessKey>

export type FlagChipsProps = { flags: readonly SwapFlag[] }

/** The attention chips a plan raised. */
export const FlagChips: Component<FlagChipsProps> = (props) => {
  const t = useT()
  return (
    <span class="swap-wizard-flags">
      <For each={props.flags}>
        {(flag) => (
          <span class={`swap-wizard-chip swap-wizard-chip--flag-${flag}`}>
            {t(FLAG_LABELS[flag])}
          </span>
        )}
      </For>
    </span>
  )
}

/** `SET:CN` of an allocated printing; null while a printingless pick has none chosen. */
function printingLabel(printing: AllocatedPrinting | null): string | null {
  return printing ? formatPrintingLabel(printing.set, printing.collectorNumber) : null
}

/** Step 5: what an auto mode chose per card, with a "Change…" into the manual picker. */
export const ReviewStep: Component<ReviewStepProps> = (props) => {
  const t = useT()
  return (
    <div class="swap-wizard-step-body">
      <h4 class="swap-wizard-heading">{t('ui.swap.review.heading')}</h4>
      <div class="swap-wizard-table-wrap">
        <table class="swap-wizard-table">
          <thead>
            <tr>
              <th>{t('ui.swap.review.card')}</th>
              <th>{t('ui.swap.review.current')}</th>
              <th>{t('ui.swap.review.chosen')}</th>
              <th>{t('ui.swap.review.value')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={props.keys()}>
              {(key) => {
                const plan = createMemo<CardSwapPlan | undefined>(() => props.planFor(key))
                return (
                  <Show when={plan()}>
                    {(plan) => <ReviewRow key={key} plan={plan} {...rowProps(props)} />}
                  </Show>
                )
              }}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** What a review row needs from the step besides its own plan. */
type ReviewRowContext = Pick<ReviewStepProps, 'priceOf' | 'currency' | 'onChange'>

function rowProps(props: ReviewStepProps): ReviewRowContext {
  return { priceOf: props.priceOf, currency: props.currency, onChange: props.onChange }
}

type ReviewRowProps = ReviewRowContext & { key: string; plan: Accessor<CardSwapPlan> }

const ReviewRow: Component<ReviewRowProps> = (props) => {
  const t = useT()
  const plan = (): CardSwapPlan => props.plan()
  const target = (): CardSwapPlan['target'] => props.plan().target
  return (
    <tr>
      <td {...useCardPreviewHandlers(() => target().card)}>
        <span class="swap-wizard-row-title">{target().cardName}</span>
        <span class="swap-wizard-qty">{t('ui.swap.quantity', { count: target().quantity })}</span>
        <FlagChips flags={plan().flags} />
      </td>
      <td {...useCardPreviewHandlers(() => target().card)}>
        <TargetPrinting target={target()} />
      </td>
      <td>
        <Show
          when={plan().allocations.length > 0}
          fallback={<span class="swap-wizard-muted">{t('ui.swap.review.unchanged')}</span>}
        >
          <ul class="swap-wizard-review-lines">
            <For each={plan().allocations}>
              {(allocation) => {
                // One read per line: the row's label, chips and preview must
                // agree on the printing this allocation brings in.
                const printing = allocationPrinting(allocation)
                return (
                  <li {...useCardPreviewHandlers(() => printing?.card ?? null)}>
                    <span class="swap-wizard-qty">
                      {t('ui.swap.quantity', { count: allocation.count })}
                    </span>{' '}
                    <span class="swap-wizard-printing">{printingLabel(printing)}</span>
                    <FinishChip finish={printing?.finish} />
                    <LanguageChip language={printing?.language} />{' '}
                    <ListName list={allocation.candidate.source} />
                  </li>
                )
              }}
            </For>
            <Show when={plan().keep > 0}>
              <li class="swap-wizard-muted">{t('ui.swap.review.keep', { count: plan().keep })}</li>
            </Show>
          </ul>
        </Show>
      </td>
      <td>
        <PriceText
          price={currentPrintingPrice(target(), props.priceOf)}
          currency={props.currency}
        />
        <Show when={plan().allocations.length > 0}>
          {' → '}
          <For each={plan().allocations}>
            {(allocation, i) => (
              <>
                <Show when={i() > 0}>{', '}</Show>
                <PriceText
                  price={allocationPrice(allocation, props.priceOf)}
                  currency={props.currency}
                />
              </>
            )}
          </For>
        </Show>
      </td>
      <td>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={() => props.onChange(props.key)}
        >
          {t('ui.swap.review.change')}
        </button>
      </td>
    </tr>
  )
}
