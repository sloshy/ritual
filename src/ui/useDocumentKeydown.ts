import { type Accessor, createEffect, onCleanup } from 'solid-js'

/** Listener options for {@link useDocumentKeydown}. */
export type DocumentKeydownOptions = {
  /**
   * Bind in the capture phase, so the handler runs before the focused
   * element's own keydown handlers and can stop them with `stopPropagation`.
   */
  capture?: boolean
}

/** Whether the event landed in a field where the keystroke is text, not a command. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

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
  options: DocumentKeydownOptions = {},
): void {
  const capture = options.capture ?? false
  createEffect(() => {
    if (!active()) return
    document.addEventListener('keydown', handler, { capture })
    onCleanup(() => document.removeEventListener('keydown', handler, { capture }))
  })
}
