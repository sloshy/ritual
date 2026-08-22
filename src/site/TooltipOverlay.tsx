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
  /** Called when the preview image fails to load (a stale trade URL's art). */
  onImageError?: () => void
}

/** Classes the preview box wears for the current tooltip. */
function boxClass(props: TooltipOverlayProps): string {
  const classes = ['list-tooltip']
  if (props.class) classes.push(props.class)
  if (props.tooltip) classes.push('visible')
  if (props.tooltip?.sideways) classes.push('list-tooltip-sideways')
  // A preview with no image keeps the card's footprint and draws the
  // "no printing" placeholder instead of art.
  if (props.tooltip && !props.tooltip.src) classes.push('list-tooltip-missing')
  return classes.join(' ')
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
    class={boxClass(props)}
    style={`left:${props.pos.left}px;top:${props.pos.top}px;`}
  >
    <Show when={props.tooltip}>
      {(t) => (
        <Show
          when={t().src}
          fallback={
            <span class="list-tooltip-missing-mark" aria-hidden="true">
              ?
            </span>
          }
        >
          {(src) => (
            <img
              src={src()}
              alt=""
              class={t().sideways ? 'tooltip-rotated' : ''}
              onError={() => props.onImageError?.()}
            />
          )}
        </Show>
      )}
    </Show>
  </div>
)
