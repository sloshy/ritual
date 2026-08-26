import { createMemo, For, Show, type Accessor, type Component } from 'solid-js'
import type { PriceCurrency } from '../../../pricing/price-currency'
import { formatPrice } from '../../../pricing/price-currency'
import { formatPrintingLabel } from '../../../card/printing-key'
import { listRefKey, type ListRefKey, type NamedListRef } from '../../../list-view/combined-list'
import { useT } from '../../../ui/i18n'
import type { ChosenPrinting, SwapCardDelta, SwapMove, SwapSummary } from '../../swap-printings'
import { groupMovesByList, type SwapListGroup } from '../../swap-printings/wizard-state'
import { FinishChip, LanguageChip, useCardPreviewHandlers } from './shared'

export type SummaryStepProps = {
  moves: Accessor<SwapMove[]>
  summary: Accessor<SwapSummary>
  /** Whether a displaced copy would land in a wanted list, so a real destination must be chosen. */
  needsFallback: Accessor<boolean>
  fallback: Accessor<NamedListRef | undefined>
  setFallback: (ref: NamedListRef | undefined) => void
  displacedTargets: Accessor<NamedListRef[]>
  currency: PriceCurrency
}

/** Step 6: the planned moves grouped by list, the value totals, and the wanted-displaced destination pick. */
export const SummaryStep: Component<SummaryStepProps> = (props) => {
  const t = useT()
  const groups = createMemo<SwapListGroup[]>(() => groupMovesByList(props.moves()))
  const money = (amount: number | null): string =>
    amount === null ? t('ui.swap.summary.unknown') : formatPrice(amount, props.currency)
  const changedDeltas = createMemo<SwapCardDelta[]>(() =>
    props.summary().deltas.filter((delta) => delta.before !== delta.after),
  )
  const fallbackKey = (): ListRefKey | '' => {
    const ref = props.fallback()
    return ref ? listRefKey(ref) : ''
  }
  const selectFallback = (key: string): void => {
    props.setFallback(props.displacedTargets().find((ref) => listRefKey(ref) === key))
  }

  return (
    <div class="swap-wizard-step-body">
      <h4 class="swap-wizard-heading">{t('ui.swap.summary.heading')}</h4>
      <Show when={props.needsFallback()}>
        <div class="swap-wizard-field swap-wizard-fallback">
          <label class="swap-wizard-legend" for="swap-wizard-fallback">
            {t('ui.swap.summary.fallbackLabel')}
          </label>
          <select
            id="swap-wizard-fallback"
            class="swap-wizard-select"
            onChange={(e) => selectFallback(e.currentTarget.value)}
          >
            <option value="" selected={fallbackKey() === ''}>
              {t('ui.swap.displaced.choose')}
            </option>
            <For each={props.displacedTargets()}>
              {(ref) => (
                <option value={listRefKey(ref)} selected={listRefKey(ref) === fallbackKey()}>
                  {ref.name}
                </option>
              )}
            </For>
          </select>
          <Show when={!props.fallback()}>
            <p class="swap-wizard-note swap-wizard-note--warning">
              {t('ui.swap.summary.fallbackRequired')}
            </p>
          </Show>
        </div>
      </Show>
      <Show
        when={props.moves().length > 0}
        fallback={<div class="empty-state">{t('ui.swap.summary.noMoves')}</div>}
      >
        <div class="swap-wizard-summary-groups">
          <For each={groups()}>
            {(group) => (
              <section class="swap-wizard-summary-group">
                <Show when={group.incoming.length > 0}>
                  <h5 class="swap-wizard-subheading">
                    {t('ui.swap.summary.takes', { list: group.list.name })}
                  </h5>
                  <ul class="swap-wizard-review-lines">
                    <For each={group.incoming}>
                      {(move) => (
                        <>
                          <MoveLine move={move} />
                          <Show when={move.replacement}>
                            {(replacement) => (
                              <ReplacementLine move={move} replacement={replacement()} />
                            )}
                          </Show>
                        </>
                      )}
                    </For>
                  </ul>
                </Show>
                <Show when={group.outgoing.length > 0}>
                  <h5 class="swap-wizard-subheading">
                    {t('ui.swap.summary.sends', { list: group.list.name })}
                  </h5>
                  <ul class="swap-wizard-review-lines">
                    <For each={group.outgoing}>{(move) => <MoveLine move={move} />}</For>
                  </ul>
                </Show>
              </section>
            )}
          </For>
        </div>
        <section class="swap-wizard-summary-group">
          <h5 class="swap-wizard-subheading">{t('ui.swap.summary.valueHeading')}</h5>
          <p class="swap-wizard-total">
            {t('ui.swap.summary.listTotal', {
              before: money(props.summary().before),
              after: money(props.summary().after),
            })}
          </p>
          <ul class="swap-wizard-review-lines swap-wizard-muted">
            <For each={changedDeltas()}>
              {(delta) => (
                <li {...useCardPreviewHandlers(() => delta.card)}>
                  {t('ui.swap.summary.cardDelta', {
                    name: delta.cardName,
                    before: money(delta.before),
                    after: money(delta.after),
                  })}
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  )
}

type ReplacementLineProps = { move: SwapMove; replacement: ChosenPrinting }

/** The printing a source list gets back for a pinning move's copies. */
const ReplacementLine: Component<ReplacementLineProps> = (props) => {
  const t = useT()
  return (
    <li
      class="swap-wizard-replacement-line"
      {...useCardPreviewHandlers(() => props.replacement.card)}
    >
      <span class="swap-wizard-move swap-wizard-move--replacement">↩</span>{' '}
      {t('ui.swap.summary.replacementLine', {
        count: props.move.count,
        name: props.move.cardName,
        printing: formatPrintingLabel(props.replacement.set, props.replacement.collectorNumber),
        list: props.move.from.name,
      })}
      <FinishChip finish={props.replacement.finish} />
      <LanguageChip language={props.replacement.language} />
    </li>
  )
}

type MoveLineProps = { move: SwapMove }

const MoveLine: Component<MoveLineProps> = (props) => {
  const t = useT()
  return (
    <li {...useCardPreviewHandlers(() => props.move.card)}>
      <span class={`swap-wizard-move swap-wizard-move--${props.move.direction}`}>
        {props.move.direction === 'in' ? '+' : '−'}
      </span>{' '}
      {t('ui.swap.summary.moveLine', {
        count: props.move.count,
        name: props.move.cardName,
        printing: formatPrintingLabel(props.move.set, props.move.collectorNumber),
      })}
      <FinishChip finish={props.move.finish} />
      <LanguageChip language={props.move.language} />
    </li>
  )
}
