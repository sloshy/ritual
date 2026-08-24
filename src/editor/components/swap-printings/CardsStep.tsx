import { For, Show, type Accessor, type Component } from 'solid-js'
import { useT } from '../../../ui/i18n'
import type { SwapTarget } from '../../swap-printings'
import { CardThumb, TargetPrinting } from './shared'

export type CardsStepProps = {
  targets: readonly SwapTarget[]
  targetKey: (target: SwapTarget) => string
  checked: Accessor<ReadonlySet<string>>
  onToggle: (key: string) => void
  onSetAll: (checked: boolean) => void
}

/** Step 1: which lines of the edited list to re-pick (or, for name-only lines, set) printings for. */
export const CardsStep: Component<CardsStepProps> = (props) => {
  const t = useT()
  return (
    <div class="swap-wizard-step-body">
      <div class="swap-wizard-step-head">
        <h4 class="swap-wizard-heading">{t('ui.swap.cards.heading')}</h4>
        <div class="swap-wizard-step-tools">
          <span class="swap-wizard-muted" role="status">
            {t('ui.swap.cards.selected', {
              count: props.checked().size,
              total: props.targets.length,
            })}
          </span>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onClick={() => props.onSetAll(true)}
          >
            {t('ui.swap.cards.selectAll')}
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onClick={() => props.onSetAll(false)}
          >
            {t('ui.swap.cards.selectNone')}
          </button>
        </div>
      </div>
      <Show when={props.targets.length === 0}>
        <div class="empty-state">{t('ui.swap.cards.none')}</div>
      </Show>
      <ul class="swap-wizard-rows">
        <For each={props.targets}>
          {(target) => {
            const key = props.targetKey(target)
            return (
              <li class="swap-wizard-row swap-wizard-card-row">
                <label class="swap-wizard-row-main">
                  <input
                    type="checkbox"
                    checked={props.checked().has(key)}
                    onChange={() => props.onToggle(key)}
                  />
                  <CardThumb card={target.card} name={target.cardName} />
                  <span class="swap-wizard-row-text">
                    <span class="swap-wizard-row-title">{target.cardName}</span>
                    <span class="swap-wizard-row-sub">
                      <TargetPrinting target={target} />
                    </span>
                  </span>
                  <span class="swap-wizard-qty">
                    {t('ui.swap.quantity', { count: target.quantity })}
                  </span>
                </label>
              </li>
            )
          }}
        </For>
      </ul>
    </div>
  )
}
