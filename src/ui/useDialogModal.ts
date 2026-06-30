import { type Accessor, createEffect } from 'solid-js'

export type DialogModalControls = {
  /** Ref setter for the native `<dialog>` element. */
  setDialog: (el: HTMLDialogElement) => void
  /** `onClick` handler that closes the dialog when its backdrop (the element itself) is clicked. */
  onBackdropClick: (e: MouseEvent) => void
  /** Imperatively close the dialog (fires its `onClose`, conventionally wired to `onCancel`). */
  close: () => void
  /**
   * Wrap a user-close callback for the dialog's `onClose` so the *programmatic*
   * close — the one this hook triggers when `open` flips false — is not mistaken
   * for a user dismissal. Only genuine dismissals (Escape, backdrop, an explicit
   * `close()`) reach `userClose`; the close that follows a confirm/advance is
   * swallowed. This absorbs the `advancing`-flag workaround the dialogs used to
   * each reimplement.
   */
  handleClose: (userClose: () => void) => void
}

type DialogModalOptions = {
  /**
   * Runs right after the dialog is shown — e.g. to seed and focus an input.
   * Invoked from the effect at open time, NOT tracked reactively: pass a stable
   * wrapper that reads any current prop/signal values when called (as `Modal`
   * does with `() => props.onOpen?.()`) rather than a raw reactive ref, or a
   * later update to that value would be invisible here.
   */
  onOpen?: () => void
}

/**
 * Drive a native `<dialog>` element from a reactive `open` accessor: calls
 * `showModal()` / `close()` to track `open`, and exposes a backdrop-click handler,
 * an imperative `close()`, and `handleClose` to distinguish user vs. programmatic
 * closes. Closing the element fires its `onClose` event, which callers route
 * through `handleClose` to their cancel handler — so a single path (element close)
 * always notifies the parent, exactly once. Replaces the boilerplate duplicated
 * across the dialog components.
 */
export function useDialogModal(
  open: Accessor<boolean>,
  options?: DialogModalOptions,
): DialogModalControls {
  let dialog: HTMLDialogElement | undefined
  // True while the effect below is closing the dialog because `open` flipped
  // false, so the resulting `close` event isn't treated as a user dismissal.
  let closingProgrammatically = false

  createEffect(() => {
    if (!dialog) return
    if (open() && !dialog.open) {
      dialog.showModal()
      options?.onOpen?.()
    } else if (!open() && dialog.open) {
      closingProgrammatically = true
      dialog.close()
    }
  })

  return {
    setDialog: (el) => {
      dialog = el
    },
    onBackdropClick: (e) => {
      if (e.target === dialog) dialog?.close()
    },
    close: () => dialog?.close(),
    handleClose: (userClose) => {
      if (closingProgrammatically) {
        closingProgrammatically = false
        return
      }
      userClose()
    },
  }
}
