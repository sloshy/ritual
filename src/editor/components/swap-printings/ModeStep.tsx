import { For, Show, type Accessor, type Component, type JSX } from 'solid-js'
import { useT } from '../../../ui/i18n'
import type { ParameterlessKey } from '../../../i18n/t'
import { listRefKey, type ListRefKey, type NamedListRef } from '../../../site/combined-list'
import type { DisplacedPolicy, FinishFilter, SwapMode, UnpricedPolicy } from '../../swap-printings'

/** One radio in a labelled group: its value, caption key and one-line hint key. */
type RadioChoice<V extends string> = { value: V; label: ParameterlessKey; hint?: ParameterlessKey }

const MODE_CHOICES: readonly RadioChoice<SwapMode>[] = [
  { value: 'manual', label: 'ui.swap.mode.manual', hint: 'ui.swap.mode.manualHint' },
  {
    value: 'most-expensive',
    label: 'ui.swap.mode.mostExpensive',
    hint: 'ui.swap.mode.mostExpensiveHint',
  },
  {
    value: 'least-expensive',
    label: 'ui.swap.mode.leastExpensive',
    hint: 'ui.swap.mode.leastExpensiveHint',
  },
]

const UNPRICED_CHOICES: readonly RadioChoice<UnpricedPolicy>[] = [
  { value: 'skip', label: 'ui.swap.unpriced.skip', hint: 'ui.swap.unpriced.skipHint' },
  { value: 'ignore', label: 'ui.swap.unpriced.ignore', hint: 'ui.swap.unpriced.ignoreHint' },
  { value: 'force', label: 'ui.swap.unpriced.force', hint: 'ui.swap.unpriced.forceHint' },
]

/** The finish quick-filter choices, shared with the picker's toggle. */
export const FINISH_FILTER_CHOICES: readonly RadioChoice<FinishFilter>[] = [
  { value: 'any', label: 'ui.swap.finish.any' },
  { value: 'foil', label: 'ui.swap.finish.foil' },
  { value: 'nonfoil', label: 'ui.swap.finish.nonfoil' },
]

type RadioGroupProps<V extends string> = {
  name: string
  legend: string
  choices: readonly RadioChoice<V>[]
  value: V
  onChange: (value: V) => void
}

function RadioGroup<V extends string>(props: RadioGroupProps<V>): JSX.Element {
  const t = useT()
  return (
    <fieldset class="swap-wizard-fieldset">
      <legend class="swap-wizard-legend">{props.legend}</legend>
      <div class="swap-wizard-radios">
        <For each={props.choices}>
          {(choice) => (
            <label
              class="swap-wizard-radio"
              classList={{ 'swap-wizard-radio--selected': props.value === choice.value }}
            >
              <input
                type="radio"
                name={props.name}
                value={choice.value}
                checked={props.value === choice.value}
                onChange={() => props.onChange(choice.value)}
              />
              <span class="swap-wizard-radio-text">
                <span class="swap-wizard-radio-label">{t(choice.label)}</span>
                <Show when={choice.hint}>
                  {(hint) => <span class="swap-wizard-radio-hint">{t(hint())}</span>}
                </Show>
              </span>
            </label>
          )}
        </For>
      </div>
    </fieldset>
  )
}

export type FinishFilterToggleProps = {
  value: FinishFilter
  onChange: (value: FinishFilter) => void
  /** Accessible name of the group. */
  label: string
}

/** The any / foil / nonfoil segmented toggle, shared by the Mode step and the picker. */
export const FinishFilterToggle: Component<FinishFilterToggleProps> = (props) => {
  const t = useT()
  return (
    <div class="view-toggle swap-wizard-finish-toggle" role="group" aria-label={props.label}>
      <For each={FINISH_FILTER_CHOICES}>
        {(choice) => (
          <button
            type="button"
            classList={{ active: props.value === choice.value }}
            aria-pressed={props.value === choice.value}
            onClick={() => props.onChange(choice.value)}
          >
            {t(choice.label)}
          </button>
        )}
      </For>
    </div>
  )
}

export type ModeStepProps = {
  mode: Accessor<SwapMode>
  setMode: (mode: SwapMode) => void
  unpriced: Accessor<UnpricedPolicy>
  setUnpriced: (policy: UnpricedPolicy) => void
  finish: Accessor<FinishFilter>
  setFinish: (filter: FinishFilter) => void
  displaced: Accessor<DisplacedPolicy>
  setDisplaced: (policy: DisplacedPolicy) => void
  displacedTargets: Accessor<NamedListRef[]>
}

/** Step 3: how replacements are chosen, and where the displaced copies go. */
export const ModeStep: Component<ModeStepProps> = (props) => {
  const t = useT()
  const overrideKey = (): ListRefKey | '' => {
    const policy = props.displaced()
    return policy.kind === 'override' ? listRefKey(policy.to) : ''
  }
  const selectOverride = (key: string): void => {
    const to = props.displacedTargets().find((ref) => listRefKey(ref) === key)
    if (to) props.setDisplaced({ kind: 'override', to })
  }
  return (
    <div class="swap-wizard-step-body">
      <h4 class="swap-wizard-heading">{t('ui.swap.mode.heading')}</h4>
      <RadioGroup
        name="swap-mode"
        legend={t('ui.swap.step.mode')}
        choices={MODE_CHOICES}
        value={props.mode()}
        onChange={props.setMode}
      />
      <Show when={props.mode() !== 'manual'}>
        <RadioGroup
          name="swap-unpriced"
          legend={t('ui.swap.unpriced.label')}
          choices={UNPRICED_CHOICES}
          value={props.unpriced()}
          onChange={props.setUnpriced}
        />
        <p class="swap-wizard-note">{t('ui.swap.unpriced.note')}</p>
      </Show>
      <div class="swap-wizard-field">
        <span class="swap-wizard-legend">{t('ui.swap.finish.label')}</span>
        <FinishFilterToggle
          value={props.finish()}
          onChange={props.setFinish}
          label={t('ui.swap.finish.label')}
        />
      </div>
      <fieldset class="swap-wizard-fieldset">
        <legend class="swap-wizard-legend">{t('ui.swap.displaced.label')}</legend>
        <div class="swap-wizard-radios">
          <label
            class="swap-wizard-radio"
            classList={{ 'swap-wizard-radio--selected': props.displaced().kind === 'swap' }}
          >
            <input
              type="radio"
              name="swap-displaced"
              value="swap"
              checked={props.displaced().kind === 'swap'}
              onChange={() => props.setDisplaced({ kind: 'swap' })}
            />
            <span class="swap-wizard-radio-text">
              <span class="swap-wizard-radio-label">{t('ui.swap.displaced.swap')}</span>
              <span class="swap-wizard-radio-hint">{t('ui.swap.displaced.swapHint')}</span>
            </span>
          </label>
          <label
            class="swap-wizard-radio"
            classList={{
              'swap-wizard-radio--selected': props.displaced().kind === 'override',
              'swap-wizard-radio--disabled': props.displacedTargets().length === 0,
            }}
          >
            <input
              type="radio"
              name="swap-displaced"
              value="override"
              disabled={props.displacedTargets().length === 0}
              checked={props.displaced().kind === 'override'}
              onChange={() => {
                const first = props.displacedTargets()[0]
                if (first) props.setDisplaced({ kind: 'override', to: first })
              }}
            />
            <span class="swap-wizard-radio-text">
              <span class="swap-wizard-radio-label">{t('ui.swap.displaced.override')}</span>
              <select
                class="swap-wizard-select"
                aria-label={t('ui.swap.displaced.override')}
                disabled={props.displaced().kind !== 'override'}
                onChange={(e) => selectOverride(e.currentTarget.value)}
              >
                {/* `selected` per option (not `value` on the select): a rebuilt
                    option list resets the select, and the key binding alone
                    would not re-run to put it back. */}
                <For each={props.displacedTargets()}>
                  {(ref) => (
                    <option value={listRefKey(ref)} selected={listRefKey(ref) === overrideKey()}>
                      {ref.name}
                    </option>
                  )}
                </For>
              </select>
            </span>
          </label>
        </div>
      </fieldset>
    </div>
  )
}
