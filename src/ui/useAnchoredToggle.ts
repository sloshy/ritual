import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js'

export type AnchoredToggle = {
  /** Whether the popup is currently open. */
  open: Accessor<boolean>
  /** The trigger button's last-measured rect, fed to {@link useAnchoredMenu} for placement. */
  anchorRect: Accessor<DOMRect | null>
  /** Ref setter for the trigger button — attach via `ref={...}`. */
  setButtonRef: (el: HTMLButtonElement) => void
  /** The current trigger element, for the menu's `excludeEl` outside-click guard. */
  buttonEl: () => HTMLButtonElement | undefined
  /** Toggle open/closed; capturing the button's rect when opening. */
  toggleOpen: () => void
  /** Force the popup closed. */
  close: () => void
}

/**
 * Open-state + anchor-capture behaviour shared by toolbar dropdown buttons (the
 * Filters menu, the multi-select actions menu). Pairs with {@link useAnchoredMenu},
 * which owns the panel's positioning and dismissal — this hook owns the toggle
 * button side: the open signal, the measured anchor rect, and re-measuring it
 * while the page scrolls or resizes so the panel stays attached to the button.
 *
 * The scroll listener uses capture phase so it re-anchors before the menu's own
 * outside-click dismissal can run.
 */
export function useAnchoredToggle(): AnchoredToggle {
  const [open, setOpen] = createSignal(false)
  const [anchorRect, setAnchorRect] = createSignal<DOMRect | null>(null)
  let buttonRef: HTMLButtonElement | undefined

  const captureAnchor = () => {
    if (buttonRef) setAnchorRect(buttonRef.getBoundingClientRect())
  }

  const toggleOpen = () => {
    if (open()) {
      setOpen(false)
      return
    }
    captureAnchor()
    setOpen(true)
  }

  createEffect(() => {
    if (!open()) return
    window.addEventListener('scroll', captureAnchor, true)
    window.addEventListener('resize', captureAnchor)
    onCleanup(() => {
      window.removeEventListener('scroll', captureAnchor, true)
      window.removeEventListener('resize', captureAnchor)
    })
  })

  return {
    open,
    anchorRect,
    setButtonRef: (el) => {
      buttonRef = el
    },
    buttonEl: () => buttonRef,
    toggleOpen,
    close: () => setOpen(false),
  }
}
