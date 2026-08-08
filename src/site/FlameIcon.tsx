// The app's candle-flame logo, rendered inline so its gradient stops read
// from the active theme's `--flame-*` CSS variables and recolor instantly
// when the theme changes. Geometry is shared with the static `app.svg`
// favicon via `src/flame.ts`. The `var(--flame-*, …)` fallbacks keep the
// flame visible even if a theme omits the vars.

import { createUniqueId, type JSX } from 'solid-js'
import { useT } from '../ui/i18n'
import {
  defaultFlameStops,
  flameInnerGradient,
  flameInnerPath,
  flameInnerStopOffsets,
  flameOuterGradient,
  flameOuterPath,
  flameOuterStopOffsets,
  flameStopVars,
  flameTransform,
} from '../flame'

type FlameIconProps = {
  class?: string
}

function stop(stopKey: keyof typeof flameStopVars): string {
  return `var(${flameStopVars[stopKey]}, ${defaultFlameStops[stopKey]})`
}

export function FlameIcon(props: FlameIconProps): JSX.Element {
  const t = useT()
  // Unique per instance so multiple flames on one page can't collide on a
  // shared gradient id (referencing `url(#…)` would otherwise resolve to the
  // first definition for every instance).
  const outerId = createUniqueId()
  const innerId = createUniqueId()
  return (
    <svg
      class={props.class}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      role="img"
      aria-label={t('site.brand.logoAlt')}
    >
      <defs>
        <radialGradient
          id={outerId}
          cx={flameOuterGradient.cx}
          cy={flameOuterGradient.cy}
          r={flameOuterGradient.r}
        >
          <stop offset={flameOuterStopOffsets[0]} stop-color={stop('outer1')} />
          <stop offset={flameOuterStopOffsets[1]} stop-color={stop('outer2')} />
          <stop offset={flameOuterStopOffsets[2]} stop-color={stop('outer3')} />
        </radialGradient>
        <radialGradient
          id={innerId}
          cx={flameInnerGradient.cx}
          cy={flameInnerGradient.cy}
          r={flameInnerGradient.r}
        >
          <stop offset={flameInnerStopOffsets[0]} stop-color={stop('inner1')} />
          <stop offset={flameInnerStopOffsets[1]} stop-color={stop('inner2')} />
          <stop offset={flameInnerStopOffsets[2]} stop-color={stop('inner3')} />
        </radialGradient>
      </defs>
      <g transform={flameTransform}>
        <path d={flameOuterPath} fill={`url(#${outerId})`} />
        <path d={flameInnerPath} fill={`url(#${innerId})`} />
      </g>
    </svg>
  )
}
