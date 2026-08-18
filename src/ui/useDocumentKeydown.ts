import { type Accessor, createEffect, onCleanup } from 'solid-js'
import { anchoredMenuOpen } from './useAnchoredMenu'

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
 * Overlays that own the keyboard while they are up: `Modal` and `BottomSheet`
 * are native `<dialog>`s, and the surfaces that hand-roll their own backdrop
 * (Quick Switch, the theme editor, the trade printing picker) all carry
 * `role="dialog"`. Anchored menus are neither, hence the separate signal in
 * {@link isKeyboardClaimed}.
 */
const OVERLAY_SELECTOR = 'dialog[open], [role="dialog"]'

/**
 * Whether some overlay — a modal, a bottom sheet, an anchored menu — is holding
 * the keyboard, so a page-level handler must stand down. Typing behind an open
 * panel is never what the user meant.
 */
export function isKeyboardClaimed(): boolean {
  return anchoredMenuOpen() || document.querySelector(OVERLAY_SELECTOR) !== null
}

/**
 * Whether this keystroke is the user typing a character rather than issuing a
 * command: a lone printable key, landing outside any field.
 *
 * An IME's intermediate keydowns are excluded (`isComposing`) — the composed
 * text arrives as input on the focused field, and there is no field here yet.
 * Space is deliberately *not* decided here: it scrolls the page and activates
 * a focused button, so each caller answers it for itself.
 */
export function isPlainTypingKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  if (e.isComposing) return false
  // Code points, not UTF-16 units, so a key like an emoji still counts as one.
  if ([...e.key].length !== 1) return false
  return !isTypingTarget(e.target)
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
