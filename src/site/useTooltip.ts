import { useState, useRef, useEffect, useCallback } from 'preact/hooks'
import type { RefObject } from 'preact'

type TooltipInfo = { src: string; sideways: boolean }
type TooltipPos = { left: number; top: number }

export type UseTooltipResult = {
  tooltip: TooltipInfo | null
  tooltipPos: TooltipPos
  tooltipRef: RefObject<HTMLDivElement>
  setTooltip: (info: TooltipInfo | null) => void
}

export function useTooltip(): UseTooltipResult {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null)
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>({ left: 0, top: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!tooltip) return
      const tooltipW = tooltip.sideways ? 358 : 240
      const tooltipH = tooltipRef.current?.offsetHeight ?? (tooltip.sideways ? 256 : 340)
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
    },
    [tooltip],
  )

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove)
    return () => document.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])

  return { tooltip, tooltipPos, tooltipRef, setTooltip }
}
