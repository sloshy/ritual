import { type Accessor, createEffect, onCleanup } from 'solid-js'

/**
 * Bind a document-level `keydown` listener for as long as `active()` holds.
 *
 * Keyboard affordances that aren't anchored to a focused element — page-level
 * shortcuts, arrow navigation over a grid whose tiles never take focus — all
 * need the same listen/teardown wiring, scoped to whatever state they belong
 * to. `active` defaults to always-on for listeners that live as long as their
 * owning component.
 *
 * `handler` is captured once, so it must read any state it depends on when the
 * event fires rather than closing over values from setup time.
 */
export function useDocumentKeydown(
  handler: (e: KeyboardEvent) => void,
  active: Accessor<boolean> = () => true,
): void {
  createEffect(() => {
    if (!active()) return
    document.addEventListener('keydown', handler)
    onCleanup(() => document.removeEventListener('keydown', handler))
  })
}
