import { type Component, type JSX, Show } from 'solid-js'
import { useDialogModal } from './useDialogModal'

/** Fade/scale-out duration; matches the `.modal-shell` / `.modal-panel` transitions in modal.css. */
const MODAL_EXIT_MS = 150

/** Named width rungs for the panel (see `--modal-w-*` in theme-base.css). */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'
/** Where the panel sits within the viewport when open. */
export type ModalPlacement = 'center' | 'top'

export type ModalProps = {
  open: boolean
  /** Fired on a genuine user dismissal (Escape, backdrop click) — not on the
   *  programmatic close that follows the parent flipping `open` to false. */
  onClose: () => void
  /** Width rung. Defaults to `md`. */
  size?: ModalSize
  /** Vertical placement. Defaults to `center`. */
  placement?: ModalPlacement
  /** Whether backdrop click / Escape dismiss the modal. Defaults to `true`. */
  dismissable?: boolean
  /** Extra class names applied to the panel element (e.g. `modal-panel--prompt`). */
  panelClass?: string
  /** Ref callback for the panel element — e.g. to position content relative to it. */
  panelRef?: (el: HTMLDivElement) => void
  /** Accessible label for the dialog when it has no titled header. */
  'aria-label'?: string
  /** Runs right after the dialog opens — e.g. to seed and focus an input. */
  onOpen?: () => void
  /**
   * Content rendered inside the `<dialog>` but *outside* the panel — so it sits in
   * the top layer above the backdrop yet escapes the panel's `overflow: hidden`.
   * For cursor-positioned hover tooltips/previews that must not be clipped.
   */
  overlay?: JSX.Element
  children: JSX.Element
}

/**
 * The shared modal primitive: a native `<dialog>` shell (`.modal-shell`) that
 * dims via `::backdrop` and centres a panel (`.modal-panel`). It owns the chrome
 * every modal shares — open/close lifecycle, Escape and backdrop dismissal, the
 * top-layer stacking, and the entrance/exit fade — leaving each dialog to supply
 * only its content. Drive it from a reactive `open`; close is reported through
 * `onClose` exactly once per user dismissal.
 */
export const Modal: Component<ModalProps> = (props) => {
  const dialog = useDialogModal(() => props.open, {
    onOpen: () => props.onOpen?.(),
    onDismiss: () => props.onClose(),
    exitMs: MODAL_EXIT_MS,
  })

  const size = (): ModalSize => props.size ?? 'md'
  const placement = (): ModalPlacement => props.placement ?? 'center'
  const dismissable = (): boolean => props.dismissable ?? true

  return (
    <dialog
      ref={dialog.setDialog}
      class={`modal-shell modal-shell--${placement()}`}
      classList={{ 'is-closing': dialog.exiting() }}
      aria-label={props['aria-label']}
      onCancel={(e) => {
        // Escape would close the element outright, skipping the exit animation —
        // always block it and route the dismissal through the owner instead.
        e.preventDefault()
        if (dismissable()) dialog.requestClose()
      }}
      onClick={(e) => {
        if (dismissable()) dialog.onBackdropClick(e)
      }}
    >
      <div
        ref={(el) => {
          dialog.setPanel(el)
          props.panelRef?.(el)
        }}
        class={`modal-panel modal-panel--${size()}${props.panelClass ? ` ${props.panelClass}` : ''}`}
      >
        {/* Render content while open plus the closing animation, so a closed and
            settled dialog leaves no queryable/focusable DOM behind, and its shared
            class names (e.g. `.view-toggle`, `.btn-danger`) don't leak into
            page-wide queries. */}
        <Show when={dialog.mounted()}>{props.children}</Show>
      </div>
      {props.overlay}
    </dialog>
  )
}
