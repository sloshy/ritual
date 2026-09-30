import { type JSX, For } from 'solid-js'
import { AdaptiveMenu } from './AdaptiveMenu'
import { useAnchoredToggle } from './useAnchoredToggle'

/** One action in a {@link MenuButton}'s menu. */
export type MenuButtonItem<A extends string = string> = {
  /** Stable id of the action, rendered as `data-action` so a test or style can address it. */
  action?: A
  label: JSX.Element
  onSelect: () => void
  disabled?: boolean
}

type MenuButtonProps<A extends string> = {
  items: readonly MenuButtonItem<A>[]
  buttonClass: string
  /** Visible trigger content, given whether the menu is open. */
  trigger: (open: boolean) => JSX.Element
  /** The menu's accessible name, and its title as a bottom sheet. */
  title: string
  /** Accessible name and tooltip of the trigger, when its content is not text (e.g. "⋯"). */
  ariaLabel?: string
  /** Popover width on fine pointers. */
  width?: number
}

/**
 * A button opening a flat menu of actions — an anchored popover on fine
 * pointers, a bottom sheet on touch (see {@link AdaptiveMenu}). Picking an
 * item closes the menu, then runs it.
 */
export function MenuButton<A extends string>(props: MenuButtonProps<A>): JSX.Element {
  const toggle = useAnchoredToggle()
  const select = (item: MenuButtonItem<A>) => {
    if (item.disabled) return
    toggle.close()
    item.onSelect()
  }
  return (
    <>
      <button
        type="button"
        ref={toggle.setButtonRef}
        class={props.buttonClass}
        aria-haspopup="menu"
        aria-expanded={toggle.open()}
        aria-label={props.ariaLabel}
        title={props.ariaLabel}
        onClick={toggle.toggleOpen}
      >
        {props.trigger(toggle.open())}
      </button>
      <AdaptiveMenu
        toggle={toggle}
        width={props.width ?? 220}
        panelClass="selection-menu-panel"
        title={props.title}
        role="menu"
        aria-label={props.title}
      >
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              role="menuitem"
              data-action={item.action}
              class="selection-menu-item"
              aria-disabled={item.disabled ? 'true' : undefined}
              onClick={() => select(item)}
            >
              {item.label}
            </button>
          )}
        </For>
      </AdaptiveMenu>
    </>
  )
}
