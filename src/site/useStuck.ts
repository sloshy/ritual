import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js'

type StuckHandle = {
  stuck: Accessor<boolean>
  sentinelRef: (el: HTMLDivElement) => void
}

/**
 * Detects when a `position: sticky` element becomes pinned to its sticky top.
 *
 * The consumer renders the returned `sentinelRef` element immediately before
 * the sticky element. The sentinel is visually offset upward by
 * `--site-header-h` (the same value the sticky element uses for `top`), so it
 * crosses the viewport's top edge at exactly the moment the sticky element
 * begins to stick. An IntersectionObserver with the viewport as root then
 * flips `stuck` without needing to recompute rootMargin when the header
 * height changes.
 */
export function useStuck(): StuckHandle {
  const [stuck, setStuck] = createSignal(false)
  let sentinelEl: HTMLDivElement | undefined
  let observer: IntersectionObserver | undefined

  const sentinelRef = (el: HTMLDivElement) => {
    sentinelEl = el
  }

  onMount(() => {
    if (!sentinelEl) return
    observer = new IntersectionObserver(([entry]) => {
      if (!entry) return
      setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    })
    observer.observe(sentinelEl)
    onCleanup(() => observer?.disconnect())
  })

  return { stuck, sentinelRef }
}
