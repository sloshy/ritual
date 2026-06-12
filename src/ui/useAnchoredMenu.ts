import { type Accessor, type JSX, createSignal, createMemo, onMount, onCleanup } from 'solid-js'

const MENU_OFFSET = 4
// Keep the menu this far from the viewport edges when it has to be clamped/scrolled.
const VIEWPORT_MARGIN = 8

export type AnchoredMenuOptions = {
  /** The triggering element's bounding rect (the menu is placed beneath/above it). */
  anchorRect: Accessor<DOMRect>
  /** Fixed menu width used for horizontal placement/clamping. */
  width: number
  /** Called on Escape or a click outside the menu. */
  onClose: () => void
  /**
   * Element whose clicks should not count as "outside" — typically the toggle
   * button that owns the menu, so its own click handler decides open/close
   * instead of the outside-click dismissal racing it.
   */
  excludeEl?: () => HTMLElement | undefined
}

export type AnchoredMenu = {
  /** Ref setter for the menu element; must be attached for measuring and outside-click detection. */
  setMenuRef: (el: HTMLDivElement) => void
  /** Reactive fixed-position style, flipping above / clamping / scrolling as the viewport requires. */
  style: Accessor<JSX.CSSProperties>
}

/**
 * Shared positioning + dismissal behaviour for anchored popup menus (the card
 * context menu and the move-destination menu). Measures the rendered menu so it
 * can flip above the anchor when there isn't room below, clamp to the viewport
 * horizontally, and scroll its overflow when taller than either gap. Closes on
 * Escape or an outside click.
 */
export function useAnchoredMenu(opts: AnchoredMenuOptions): AnchoredMenu {
  let menuRef: HTMLDivElement | undefined
  // Measured after mount so positioning uses the menu's real height (it varies with content)
  // rather than a fixed estimate that could overflow the viewport.
  const [menuHeight, setMenuHeight] = createSignal(0)

  const style = createMemo((): JSX.CSSProperties => {
    const anchor = opts.anchorRect()
    const viewportH = window.innerHeight
    const viewportW = window.innerWidth
    const height = menuHeight()
    const spaceBelow = viewportH - anchor.bottom - MENU_OFFSET
    const spaceAbove = anchor.top - MENU_OFFSET

    let top: number
    let maxHeight: number | undefined
    if (height === 0 || height <= spaceBelow) {
      // Fits below (or not yet measured — provisional, corrected on mount).
      top = anchor.bottom + MENU_OFFSET
    } else if (height <= spaceAbove) {
      // Doesn't fit below but fits above: flip up.
      top = anchor.top - height - MENU_OFFSET
    } else {
      // Taller than either gap: anchor to the roomier side and scroll the overflow so every
      // option stays reachable instead of running off-screen.
      const useBelow = spaceBelow >= spaceAbove
      maxHeight = (useBelow ? spaceBelow : spaceAbove) - VIEWPORT_MARGIN
      top = useBelow ? anchor.bottom + MENU_OFFSET : anchor.top - MENU_OFFSET - maxHeight
    }

    const left = Math.min(anchor.right - opts.width, viewportW - opts.width - VIEWPORT_MARGIN)
    const result: JSX.CSSProperties = {
      position: 'fixed',
      top: `${top}px`,
      left: `${Math.max(left, VIEWPORT_MARGIN)}px`,
    }
    if (maxHeight !== undefined) {
      result['max-height'] = `${maxHeight}px`
      result['overflow-y'] = 'auto'
    }
    return result
  })

  onMount(() => {
    if (menuRef) setMenuHeight(menuRef.getBoundingClientRect().height)

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (opts.excludeEl?.()?.contains(target)) return
      if (menuRef && !menuRef.contains(target)) opts.onClose()
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') opts.onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    })
  })

  return {
    setMenuRef: (el) => {
      menuRef = el
    },
    style,
  }
}
