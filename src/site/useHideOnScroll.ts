import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js'

/** Scroll distance (px) in one direction before the header changes state, so jitter never flickers it. */
const SCROLL_SLACK = 8

/** Where the last header decision was made, and what it was. */
export type HeaderScrollState = {
  hidden: boolean
  /** The scroll position the current decision was taken at. */
  lastY: number
}

/**
 * The header's next state for scroll position `y`: hidden after scrolling down,
 * shown after scrolling up, and always shown while the page is scrolled less
 * than the header's own height (where hiding would reveal nothing).
 */
export function nextHeaderScroll(
  prev: HeaderScrollState,
  y: number,
  headerHeight: number,
): HeaderScrollState {
  if (y <= headerHeight) return { hidden: false, lastY: y }
  const delta = y - prev.lastY
  if (Math.abs(delta) < SCROLL_SLACK) return prev
  return { hidden: delta > 0, lastY: y }
}

/** What {@link useHideOnScroll} watches. */
export type HideOnScrollOptions = {
  /** Hiding happens only while this holds; otherwise the header stays shown. */
  enabled: Accessor<boolean>
  headerHeight: Accessor<number>
  /** Keeps the header shown regardless — e.g. while a popover anchored to one of its buttons is open. */
  pinned: Accessor<boolean>
}

/** Hide-on-scroll-down, show-on-scroll-up for a sticky header. */
export function useHideOnScroll(options: HideOnScrollOptions): Accessor<boolean> {
  const [hidden, setHidden] = createSignal(false)
  createEffect(() => {
    if (!options.enabled()) {
      setHidden(false)
      return
    }
    let state: HeaderScrollState = { hidden: false, lastY: window.scrollY }
    const onScroll = () => {
      // While pinned, keep re-anchoring at the current position, so releasing
      // the pin takes a real scroll-down before the header hides.
      state = options.pinned()
        ? { hidden: false, lastY: window.scrollY }
        : nextHeaderScroll(state, window.scrollY, options.headerHeight())
      setHidden(state.hidden)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onCleanup(() => window.removeEventListener('scroll', onScroll))
  })
  return hidden
}
