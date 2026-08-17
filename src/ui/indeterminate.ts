import { createEffect } from 'solid-js'
import type { Accessor } from 'solid-js'

/**
 * Ref callback that mirrors `partial()` into a checkbox's `indeterminate` DOM
 * property. `indeterminate` has no JSX attribute form, so it must be written as
 * a property — and the effect is created inside the ref callback so it is bound
 * to the element's own lifetime: created at component scope it would run once
 * before the checkbox exists, read no signals, and never run again.
 */
export function indeterminateRef(partial: Accessor<boolean>): (el: HTMLInputElement) => void {
  return (el) => {
    createEffect(() => {
      el.indeterminate = partial()
    })
  }
}
