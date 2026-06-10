// Single source of truth for the app's candle-flame icon (app.svg).
//
// The geometry lives here so every surface that draws the flame stays in
// lockstep:
//   - the static `app.svg` favicon/asset is generated from `buildFlameSvg`
//     (a unit test asserts the committed file matches — see
//     `test/unit/flame.test.ts`),
//   - the in-app header logo renders the same paths as an inline,
//     theme-reactive SVG that reads its colors from `--flame-*` CSS vars
//     (`src/site/FlameIcon.tsx`),
//   - the browser-tab favicon is re-tinted per theme from the resolved
//     `--flame-*` values (`src/site/useFavicon.ts`).
//
// Browser-safe: no Node-only APIs.

// The six gradient stop colors that paint the flame: a dark outer body
// (bright → mid → near-black edge) and a glowing inner core (hot white →
// mid → saturated base). Each is any valid CSS color string.
export type FlameStops = {
  outer1: string
  outer2: string
  outer3: string
  inner1: string
  inner2: string
  inner3: string
}

// Maps each stop to the theme CSS variable that drives it. The authoritative
// list of flame vars: `themes.ts` derives its `FlameCssVars` type from these
// values, so adding a stop here flows through to the palette type. `as const`
// keeps the values as string literals for that derivation.
export const flameStopVars = {
  outer1: '--flame-outer-1',
  outer2: '--flame-outer-2',
  outer3: '--flame-outer-3',
  inner1: '--flame-inner-1',
  inner2: '--flame-inner-2',
  inner3: '--flame-inner-3',
} as const satisfies Record<keyof FlameStops, `--flame-${string}`>

// Default violet stops, matching the `default` theme's accent (hue ~290).
// Used as the static `app.svg` palette and as render-time fallbacks when a
// `--flame-*` var is somehow absent.
export const defaultFlameStops: FlameStops = {
  outer1: '#6d28d9',
  outer2: '#4c1d95',
  outer3: '#2e1065',
  inner1: '#f3e8ff',
  inner2: '#c084fc',
  inner3: '#7c3aed',
}

// Group transform: the slight horizontal widen-about-center applied to the
// candle flame (see the icon's design history).
export const flameTransform = 'translate(256 0) scale(1.07 1) translate(-256 0)'

// Outer (dark body) and inner (bright core) path data. Identical across every
// themed variant — only the fill colors change.
export const flameOuterPath =
  'M286,56 C276,104 286,140 300,184 C322,244 340,288 332,342 C326,400 298,446 256,446 C214,446 182,400 180,342 C176,296 198,250 216,206 C240,150 272,114 286,56 Z'

export const flameInnerPath =
  'M272,196 C264,242 282,276 294,318 C304,356 292,408 256,408 C220,408 206,366 210,330 C214,296 234,272 246,234 C258,196 266,222 272,196 Z'

// Gradient placement (object-bounding-box fractions), kept here so the inline
// component and the generated SVG can't drift apart.
export const flameOuterGradient = { cx: '0.49', cy: '0.66', r: '0.55' } as const
export const flameInnerGradient = { cx: '0.5', cy: '0.66', r: '0.6' } as const

// Stop offsets for each gradient, in `[stop1, stop2, stop3]` order. Shared so
// the inline component and the generated SVG use the same ramp — note the
// outer body's non-round 0.55 mid-stop, which must not drift to 0.5.
export const flameOuterStopOffsets = ['0', '0.55', '1'] as const
export const flameInnerStopOffsets = ['0', '0.5', '1'] as const

// Serializes the flame to a standalone SVG string with the given stop colors.
// Output is stable and formatted so the committed `app.svg` can be generated
// from it byte-for-byte.
export function buildFlameSvg(stops: FlameStops): string {
  const og = flameOuterGradient
  const ig = flameInnerGradient
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <radialGradient id="ritual-flame-outer" cx="${og.cx}" cy="${og.cy}" r="${og.r}">
      <stop offset="${flameOuterStopOffsets[0]}" stop-color="${stops.outer1}"/>
      <stop offset="${flameOuterStopOffsets[1]}" stop-color="${stops.outer2}"/>
      <stop offset="${flameOuterStopOffsets[2]}" stop-color="${stops.outer3}"/>
    </radialGradient>
    <radialGradient id="ritual-flame-inner" cx="${ig.cx}" cy="${ig.cy}" r="${ig.r}">
      <stop offset="${flameInnerStopOffsets[0]}" stop-color="${stops.inner1}"/>
      <stop offset="${flameInnerStopOffsets[1]}" stop-color="${stops.inner2}"/>
      <stop offset="${flameInnerStopOffsets[2]}" stop-color="${stops.inner3}"/>
    </radialGradient>
  </defs>
  <g transform="${flameTransform}">
    <path d="${flameOuterPath}" fill="url(#ritual-flame-outer)"/>
    <path d="${flameInnerPath}" fill="url(#ritual-flame-inner)"/>
  </g>
</svg>
`
}

// Builds a `data:` URI for use as a favicon `href` from the given stops.
export function buildFlameDataUri(stops: FlameStops): string {
  return `data:image/svg+xml,${encodeURIComponent(buildFlameSvg(stops))}`
}
