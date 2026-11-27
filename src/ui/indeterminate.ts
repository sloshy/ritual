import { createEffect } from 'solid-js'
import type { Accessor } from 'solid-js'

/**
 * Ref factory that mirrors `partial()` into a checkbox's `indeterminate` DOM
 * property. `indeterminate` has no JSX attribute form, so it must be written as
 * a property. A two-phase directive: called while the element's owner renders,
 * it creates the effect there (bound to that owner's lifetime), and the
 * returned ref callback only captures the element and writes its first value.
 */
export function indeterminateRef(partial: Accessor<boolean>): (el: HTMLInputElement) => void {
  let checkbox: HTMLInputElement | undefined
  createEffect(partial, (value) => {
    if (checkbox) checkbox.indeterminate = value
  })
  return (el) => {
    checkbox = el
    el.indeterminate = partial()
  }
}
