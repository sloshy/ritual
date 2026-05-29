import { type Accessor, createEffect } from 'solid-js'

export type DialogModalControls = {
  /** Ref setter for the native `<dialog>` element. */
  setDialog: (el: HTMLDialogElement) => void
  /** `onClick` handler that closes the dialog when its backdrop (the element itself) is clicked. */
  onBackdropClick: (e: MouseEvent) => void
  /** Imperatively close the dialog (fires its `onClose`, conventionally wired to `onCancel`). */
  close: () => void
}

type DialogModalOptions = {
  /** Runs right after the dialog is shown — e.g. to seed and focus an input. */
  onOpen?: () => void
}

/**
 * Drive a native `<dialog>` element from a reactive `open` accessor: calls
 * `showModal()` / `close()` to track `open`, and exposes a backdrop-click handler
 * plus an imperative `close()`. Closing the element fires its `onClose` event,
 * which callers wire to their cancel handler — so a single path (element close)
 * always notifies the parent. Replaces the boilerplate duplicated across the
 * dialog components.
 */
export function useDialogModal(
  open: Accessor<boolean>,
  options?: DialogModalOptions,
): DialogModalControls {
  let dialog: HTMLDialogElement | undefined

  createEffect(() => {
    if (!dialog) return
    if (open() && !dialog.open) {
      dialog.showModal()
      options?.onOpen?.()
    } else if (!open() && dialog.open) {
      dialog.close()
    }
  })

  return {
    setDialog: (el) => {
      dialog = el
    },
    onBackdropClick: (e) => {
      if ((e.target as Element) === dialog) dialog?.close()
    },
    close: () => dialog?.close(),
  }
}
