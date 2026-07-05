import { type Accessor, type Component, type JSX, Show } from 'solid-js'
import { useAnchoredMenu } from './useAnchoredMenu'
import type { AnchoredToggle } from './useAnchoredToggle'
import { usePointerCoarse } from './useMediaQuery'
import { BottomSheet } from './BottomSheet'

/** The `role` attribute values a menu panel can take (matches Solid's JSX typing). */
type PanelRole = JSX.HTMLAttributes<HTMLDivElement>['role']

export type AdaptiveMenuProps = {
  /** The trigger button's toggle state (see {@link AnchoredToggle}). */
  toggle: AnchoredToggle
  /** Fixed popover width used for anchored placement on fine-pointer devices. */
  width: number
  /** Class of the panel box; inside a sheet its floating-box chrome is stripped (see modal.css). */
  panelClass: string
  /** Sheet header title on touch devices. */
  title: string
  role?: PanelRole
  'aria-label'?: string
  children: JSX.Element
}

/**
 * Presentation switch for toolbar dropdown menus: on fine-pointer devices the
 * content renders as an anchored popover panel (positioned by
 * {@link useAnchoredMenu}); on touch devices it renders inside a
 * {@link BottomSheet}, where a phone has no room to anchor a dropdown. The
 * trigger button and the panel content stay identical — only the surface
 * changes.
 */
export const AdaptiveMenu: Component<AdaptiveMenuProps> = (props) => {
  const coarse = usePointerCoarse()

  return (
    <Show
      when={coarse()}
      fallback={
        <Show when={props.toggle.open() ? props.toggle.anchorRect() : null}>
          {(rect) => (
            <AnchoredPanel
              rect={rect}
              width={props.width}
              panelClass={props.panelClass}
              role={props.role}
              aria-label={props['aria-label']}
              onClose={props.toggle.close}
              anchorEl={props.toggle.buttonEl}
            >
              {props.children}
            </AnchoredPanel>
          )}
        </Show>
      }
    >
      <BottomSheet open={props.toggle.open()} onClose={props.toggle.close} title={props.title}>
        <div class={props.panelClass} role={props.role} aria-label={props['aria-label']}>
          {props.children}
        </div>
      </BottomSheet>
    </Show>
  )
}

type AnchoredPanelProps = {
  rect: Accessor<DOMRect>
  width: number
  panelClass: string
  role?: PanelRole
  'aria-label'?: string
  onClose: () => void
  /** The trigger button, excluded from outside-click dismissal so it can toggle the panel itself. */
  anchorEl: () => HTMLElement | undefined
  children: JSX.Element
}

const AnchoredPanel: Component<AnchoredPanelProps> = (props) => {
  const menu = useAnchoredMenu({
    anchorRect: props.rect,
    width: props.width,
    onClose: props.onClose,
    excludeEl: props.anchorEl,
  })

  return (
    <div
      ref={menu.setMenuRef}
      class={props.panelClass}
      style={menu.style()}
      role={props.role}
      aria-label={props['aria-label']}
    >
      {props.children}
    </div>
  )
}
