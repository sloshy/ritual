import { type Accessor, createSignal, onCleanup } from 'solid-js'

/**
 * The canonical "touch device" media query: no hover capability, or a coarse
 * primary pointer. Keep this in sync with the CSS blocks that adapt hover-gated
 * controls for touch (see src/css/touch.css) so JSX branching and styling agree
 * on what counts as a touch device.
 */
export const COARSE_POINTER_QUERY = '(hover: none), (pointer: coarse)'

/**
 * The breakpoint below which the site switches to its phone layout (bottom tab
 * bar, compact toolbar). Width-based, unlike {@link COARSE_POINTER_QUERY}:
 * layout is about available space, while touch adaptations are about pointer
 * capability — a narrow desktop window gets the compact layout but keeps its
 * hover affordances.
 */
export const MOBILE_LAYOUT_QUERY = '(max-width: 767px)'

/** Reactive `window.matchMedia` wrapper. Must be called within a reactive owner. */
export function useMediaQuery(query: string): Accessor<boolean> {
  const mql = window.matchMedia(query)
  const [matches, setMatches] = createSignal(mql.matches)
  const onChange = () => setMatches(mql.matches)
  mql.addEventListener('change', onChange)
  onCleanup(() => mql.removeEventListener('change', onChange))
  return matches
}

/** Whether the device is touch-first (no hover / coarse pointer). */
export function usePointerCoarse(): Accessor<boolean> {
  return useMediaQuery(COARSE_POINTER_QUERY)
}

/** Whether the viewport is phone-sized (see {@link MOBILE_LAYOUT_QUERY}). */
export function useMobileLayout(): Accessor<boolean> {
  return useMediaQuery(MOBILE_LAYOUT_QUERY)
}
