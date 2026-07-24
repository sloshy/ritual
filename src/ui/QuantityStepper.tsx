import type { Component } from 'solid-js'
import { stepQuantity } from './quantity'

type QuantityStepperBase = {
  value: number
  /** Called with the new value, already clamped to `min`..`max`. */
  onChange: (next: number) => void
  /** Lowest selectable value. Defaults to 1. */
  min?: number
  /** Highest selectable value. Unbounded when omitted. */
  max?: number
  /** Tooltip explaining why the value cannot go higher, shown once at `max`. */
  maxReachedTitle?: string
  /** DOM id for the group element, so callers and tests can target it. */
  id?: string
}

/**
 * `focusable` makes the whole stepper a tab/arrow-navigable target: it takes
 * focus as one unit and ←/→ adjust the value while it holds focus. Off by
 * default, so steppers embedded in a row of controls stay out of the tab order.
 * A focusable stepper is a real focus stop, so it must carry an accessible name.
 */
type QuantityStepperFocus =
  | { focusable: true; label: string }
  | { focusable?: false; label?: undefined }

export type QuantityStepperProps = QuantityStepperBase & QuantityStepperFocus

/**
 * An inline `- N +` quantity ticker. Shared by the trade builder's rows and the
 * add-card dialog's final step. In `focusable` mode it behaves as a single
 * composite widget — one stop in the tab order, adjusted with ←/→ — so it can sit
 * alongside radio groups that navigate the same way.
 */
export const QuantityStepper: Component<QuantityStepperProps> = (props) => {
  const min = () => props.min ?? 1
  const max = () => props.max ?? Infinity
  const atMin = () => props.value <= min()
  const atMax = () => props.value >= max()

  const step = (delta: number) => {
    const next = stepQuantity(props.value, delta, min(), max())
    if (next !== props.value) props.onChange(next)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.focusable) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      step(-1)
    }
  }

  return (
    <div
      id={props.id}
      class="qty-stepper"
      classList={{ 'qty-stepper--focusable': props.focusable }}
      // A single focus stop whose value changes with ←/→ is the spinbutton
      // pattern; without it the value change is announced to nobody.
      role={props.focusable ? 'spinbutton' : 'group'}
      aria-label={props.label}
      aria-valuenow={props.focusable ? props.value : undefined}
      aria-valuemin={props.focusable ? min() : undefined}
      aria-valuemax={props.focusable && props.max !== undefined ? props.max : undefined}
      // The explanation for a dead "+" goes on the group: a disabled button
      // swallows the pointer events its own tooltip would need.
      title={atMax() ? props.maxReachedTitle : undefined}
      tabindex={props.focusable ? 0 : undefined}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        tabindex={props.focusable ? -1 : undefined}
        onClick={() => step(-1)}
        disabled={atMin()}
        title="Decrease"
        aria-label="Decrease quantity"
      >
        -
      </button>
      <span class="qty-val">{props.value}</span>
      <button
        type="button"
        tabindex={props.focusable ? -1 : undefined}
        onClick={() => step(1)}
        disabled={atMax()}
        title="Increase"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  )
}
