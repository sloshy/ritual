import { type Accessor, createEffect, createSignal, on, onCleanup } from 'solid-js'

export type DialogModalControls = {
  /** Ref setter for the native `<dialog>` element. */
  setDialog: (el: HTMLDialogElement) => void
  /** `onClick` handler that requests a close when the backdrop (the element itself) is clicked. */
  onBackdropClick: (e: MouseEvent) => void
  /**
   * Ask to close. Reports a user dismissal through `onDismiss` rather than
   * closing the element directly, so the owner stays the single source of truth
   * for `open` and the exit animation always gets to run.
   */
  requestClose: () => void
  /**
   * True while the dialog is animating out: still `[open]`, but on its way
   * closed. Bind it to an `is-closing` class on the dialog so CSS can drive the
   * exit.
   */
  exiting: Accessor<boolean>
  /**
   * Whether the dialog's content should be rendered: true while open, and for
   * the length of the exit animation afterwards so the closing animation has
   * content to animate. Gate children on this rather than on `open` directly.
   */
  mounted: Accessor<boolean>
  /**
   * Ref setter for the animating panel inside the dialog. Its box is pinned to
   * its last open size for the duration of the exit: callers routinely null out
   * the data a dialog renders from at the same moment they close it (e.g.
   * `<CardModal open={Boolean(card())} card={card()} />`), which empties the
   * panel and collapses it mid-animation. Keeping content mounted isn't enough
   * on its own — the content is there, it just has nothing to draw.
   */
  setPanel: (el: HTMLElement) => void
}

/** The panel's rendered box, captured while open to pin it during the exit. */
type PanelSize = { width: number; height: number }

type DialogModalOptions = {
  /**
   * Runs right after the dialog is shown — e.g. to seed and focus an input.
   * Invoked from the effect at open time, NOT tracked reactively: pass a stable
   * wrapper that reads any current prop/signal values when called (as `Modal`
   * does with `() => props.onOpen?.()`) rather than a raw reactive ref, or a
   * later update to that value would be invisible here.
   */
  onOpen?: () => void
  /**
   * Reports a user dismissal (Escape, backdrop, the close button). Conventionally
   * wired to the caller's `onClose` prop, whose owner then flips `open` to false;
   * this hook animates the element out and closes it once that lands.
   */
  onDismiss: () => void
  /**
   * How long this dialog's exit animation runs, matching its CSS transition —
   * see `.modal-panel` / `.sheet-panel` in modal.css. The element is held open
   * (and its content mounted) for this long after `open` goes false.
   */
  exitMs: number
}

/**
 * Drive a native `<dialog>` element from a reactive `open` accessor, with an
 * animated close.
 *
 * The element is *not* closed the moment `open` goes false. Instead it keeps its
 * `open` attribute, gains `exiting()` (bound to an `is-closing` class) for
 * `exitMs`, and only then actually closes. That ordering matters: a closed
 * `<dialog>` leaves the top layer immediately, and the CSS-only alternative for
 * animating it out — transitioning `display`/`overlay` with `allow-discrete` —
 * relies on the `overlay` property, which only Chromium implements. Holding the
 * element open instead animates identically in every browser, and keeps
 * `[open]`-scoped layout rules applying so the panel can't jump mid-flight.
 *
 * Dismissals never close the element directly; they report through `onDismiss`
 * so the owner of `open` stays in charge and the exit always plays.
 */
export function useDialogModal(
  open: Accessor<boolean>,
  options: DialogModalOptions,
): DialogModalControls {
  let dialog: HTMLDialogElement | undefined
  const [exiting, setExiting] = createSignal(false)

  // The panel's last measured size while open. Tracked with a ResizeObserver
  // rather than read at close time because by then Solid has already applied the
  // same update's DOM changes, so the panel may have collapsed already.
  let panel: HTMLElement | undefined
  let openSize: PanelSize | undefined

  const setPanel = (el: HTMLElement): void => {
    panel = el
    const observer = new ResizeObserver(() => {
      if (!open()) return
      const rect = el.getBoundingClientRect()
      if (rect.height > 0) openSize = { width: rect.width, height: rect.height }
    })
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  }

  const freezePanel = (frozen: boolean): void => {
    if (!panel) return
    if (frozen && openSize) {
      panel.style.width = `${openSize.width}px`
      panel.style.height = `${openSize.height}px`
    } else {
      panel.style.removeProperty('width')
      panel.style.removeProperty('height')
    }
  }

  createEffect(
    on(open, (isOpen) => {
      if (!dialog) return
      if (isOpen) {
        // Reopening mid-exit just cancels the exit — the element never closed.
        setExiting(false)
        freezePanel(false)
        if (!dialog.open) {
          dialog.showModal()
          options.onOpen?.()
        }
        return
      }
      if (!dialog.open) return
      setExiting(true)
      freezePanel(true)
      const timer = setTimeout(() => {
        dialog?.close()
        setExiting(false)
        freezePanel(false)
      }, options.exitMs)
      onCleanup(() => clearTimeout(timer))
    }),
  )

  return {
    exiting,
    mounted: () => open() || exiting(),
    setPanel,
    setDialog: (el) => {
      dialog = el
    },
    onBackdropClick: (e) => {
      if (e.target === dialog) options.onDismiss()
    },
    requestClose: () => options.onDismiss(),
  }
}
