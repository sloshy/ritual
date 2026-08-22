import { createSignal, onMount, onCleanup } from 'solid-js'
import type { Accessor, Setter } from 'solid-js'

/**
 * A hover preview. `src` is the card image; it is absent for an entry whose
 * printing has no image (or none at all), which the overlay draws as the
 * card-shaped "no printing" placeholder rather than dropping the preview.
 */
export type TooltipInfo = { src: string | null; sideways: boolean }
export type TooltipPos = { left: number; top: number }

export type UseTooltipResult = {
  tooltip: Accessor<TooltipInfo | null>
  tooltipPos: Accessor<TooltipPos>
  tooltipRef: (el: HTMLDivElement) => void
  setTooltip: Setter<TooltipInfo | null>
}

export function useTooltip(): UseTooltipResult {
  const [tooltip, setTooltip] = createSignal<TooltipInfo | null>(null)
  const [tooltipPos, setTooltipPos] = createSignal<TooltipPos>({ left: 0, top: 0 })
  let tooltipEl: HTMLDivElement | undefined

  const handleMouseMove = (e: MouseEvent): void => {
    const t = tooltip()
    if (!t) return
    const tooltipW = t.sideways ? 358 : 240
    const tooltipH = tooltipEl?.offsetHeight ?? (t.sideways ? 256 : 340)
    const margin = 16
    const x = e.clientX
    const y = e.clientY
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = x + margin
    let top = y - tooltipH / 2

    if (left + tooltipW > vw) left = x - tooltipW - margin
    if (top < margin) top = margin
    if (top + tooltipH > vh - margin) top = vh - tooltipH - margin

    setTooltipPos({ left, top })
  }

  onMount(() => {
    document.addEventListener('mousemove', handleMouseMove)
  })

  onCleanup(() => {
    document.removeEventListener('mousemove', handleMouseMove)
  })

  return {
    tooltip,
    tooltipPos,
    tooltipRef: (el: HTMLDivElement) => {
      tooltipEl = el
    },
    setTooltip,
  }
}
