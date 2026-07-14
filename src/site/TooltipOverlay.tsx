import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import type { TooltipInfo, TooltipPos } from './useTooltip'

export interface TooltipOverlayProps {
  /** Current preview, from {@link import('./useTooltip').useTooltip}. */
  tooltip: TooltipInfo | null
  pos: TooltipPos
  tooltipRef: (el: HTMLDivElement) => void
  /** Extra class(es) on the tooltip box, e.g. a per-dialog z-index override. */
  class?: string
}

/**
 * The cursor-following card-art preview box driven by
 * {@link import('./useTooltip').useTooltip}. Rendered either at a page root
 * (list views) or inside a Modal's `overlay` slot so it escapes the panel's
 * overflow clipping; the shared markup lives here so every consumer stays in
 * sync on the sideways (landscape-card) handling.
 */
export const TooltipOverlay: Component<TooltipOverlayProps> = (props) => (
  <div
    ref={props.tooltipRef}
    class={`list-tooltip${props.class ? ` ${props.class}` : ''} ${props.tooltip ? 'visible' : ''} ${
      props.tooltip?.sideways ? 'list-tooltip-sideways' : ''
    }`}
    style={`left:${props.pos.left}px;top:${props.pos.top}px;`}
  >
    <Show when={props.tooltip}>
      {(t) => <img src={t().src} alt="" class={t().sideways ? 'tooltip-rotated' : ''} />}
    </Show>
  </div>
)
