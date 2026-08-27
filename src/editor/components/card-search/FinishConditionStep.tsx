import { For, Show, type Component } from 'solid-js'
import { useT } from '../../../ui/i18n'
import type { ScryfallCard } from '../../../scryfall/types'
import {
  type Condition,
  type Finish,
  printingFinishes,
  VALID_CONDITIONS,
} from '../../../card/finish-condition'
import { KeyChips } from '../../../ui/KeyHints'
import { QuantityStepper } from '../../../ui/QuantityStepper'
import { pricesEnabled } from '../../../list-view/price-view'
import { finishPrice } from '../../card-search/add-resolution'
import { AddOptionsRow, type AddOptionsRowProps } from '../AddCardOptions'
import { StepHeader } from './StepHeader'

/** DOM id of the finish/condition step's quantity ticker, shared by its ↑/↓ navigation. */
export const QUANTITY_STEPPER_ID = 'add-card-qty'

export type FinishConditionStepProps = AddOptionsRowProps & {
  cardName: string
  printing: ScryfallCard
  finish: Finish
  condition: Condition
  quantity: number
  usesCondition: boolean
  usesQuantity: boolean
  canAddAnother: boolean
  isAddFlow: boolean
  /** Both commit buttons go dead while the options row refuses the typed art. */
  blocked: boolean
  /** The step's root, which the dialog's ↑/↓ group walk queries. */
  groupRef: (el: HTMLDivElement) => void
  onFinish: (finish: Finish) => void
  onCondition: (condition: Condition) => void
  onQuantity: (quantity: number) => void
  /** Commit; with `addAnother` the dialog restarts on a fresh search instead of closing. */
  onAdd: (addAnother: boolean) => void
  onBack: () => void
}

/** Step 3: confirm finish, condition and count for the picked printing. */
export const FinishConditionStep: Component<FinishConditionStepProps> = (props) => {
  const t = useT()

  /** The `×N` multiplier both commit buttons carry once more than one copy is queued. */
  const quantityBadge = () => (
    <Show when={props.usesQuantity && props.quantity > 1}>
      <span class="btn-qty-badge"> ×{props.quantity}</span>
    </Show>
  )

  return (
    <>
      <StepHeader
        onBack={props.onBack}
        heading={t('ui.addCard.finishConditionHeading', {
          name: props.cardName,
          set: props.printing.set.toUpperCase(),
          number: props.printing.collector_number,
        })}
      />
      <div class="search-modal-body">
        <div class="finish-condition-grid" ref={props.groupRef}>
          <Show
            when={
              printingFinishes(props.printing).length > 1 ||
              printingFinishes(props.printing).some((f) => f === 'foil' || f === 'etched')
            }
          >
            <div class="finish-condition-section">
              <h4>{t('ui.field.finish')}</h4>
              <div class="radio-group">
                {/* `printingFinishes`, not the raw Scryfall list: a finish
                    the domain does not model would otherwise render a radio
                    that cannot be selected and carries no price. */}
                <For each={printingFinishes(props.printing)}>
                  {(finish) => (
                    <label
                      class={`radio-option${props.finish === finish ? ' radio-option--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="finish"
                        value={finish}
                        checked={props.finish === finish}
                        onChange={() => props.onFinish(finish)}
                      />
                      {finish}
                      <Show when={pricesEnabled()}>
                        <span class="radio-option-price">
                          {finishPrice(t, props.printing, finish)}
                        </span>
                      </Show>
                    </label>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={props.usesCondition}>
            <div class="finish-condition-section">
              <h4>{t('ui.field.condition')}</h4>
              <div class="radio-group">
                <For each={VALID_CONDITIONS}>
                  {(condition) => (
                    <label
                      class={`radio-option${props.condition === condition ? ' radio-option--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="condition"
                        value={condition}
                        checked={props.condition === condition}
                        onChange={() => props.onCondition(condition)}
                      />
                      {condition}
                    </label>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={props.usesQuantity}>
            <div class="finish-condition-section">
              <h4>{t('ui.field.quantity')}</h4>
              <QuantityStepper
                id={QUANTITY_STEPPER_ID}
                value={props.quantity}
                onChange={props.onQuantity}
                focusable
                label={t('ui.addCard.quantityToAdd')}
              />
            </div>
          </Show>

          <AddOptionsRow addOptions={props.addOptions} options={props.options} />

          {/* Both commit buttons go dead while the options row refuses
              the typed art: the click would be a silent no-op otherwise,
              with the reason often scrolled out of sight above. */}
          <div class="add-card-actions">
            <button
              onClick={() => props.onAdd(false)}
              class="btn-add-card"
              disabled={props.blocked}
            >
              {t(props.isAddFlow ? 'ui.addCard.add' : 'ui.addCard.update')}
              {quantityBadge()}
              <span class="btn-key-hint" aria-hidden="true">
                <KeyChips keys={['Enter']} />
              </span>
            </button>
            <Show when={props.canAddAnother}>
              <button
                onClick={() => props.onAdd(true)}
                class="btn-add-card"
                disabled={props.blocked}
              >
                {t('ui.addCard.addAnother')}
                {quantityBadge()}
                <span class="btn-key-hint" aria-hidden="true">
                  <KeyChips keys={['Ctrl', 'Enter']} />
                </span>
              </button>
            </Show>
          </div>
        </div>
      </div>
    </>
  )
}
