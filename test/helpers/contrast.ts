// WCAG 2.x contrast for the colour strings the theme generator emits, so a
// theme test can pin a text/background pair to the AA ratio (4.5:1 for body
// text) without a browser. Understands `oklch(L% C H)` (optionally `/ A`) and
// `rgba(r, g, b, a)` — the two forms `src/theme/themes.ts` and
// `src/css/theme-base.css` use.
//
// An oklch() colour outside sRGB is measured as clipped to sRGB, as it renders
// on an sRGB display. A wide-gamut display shows it more saturated, but at the
// same OKLab lightness, so its luminance (and the ratio) barely moves.

/** A colour in linear-light sRGB channels (0–1) plus alpha. */
export type LinearRgba = { r: number; g: number; b: number; a: number }

const OKLCH = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/
const RGBA = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

// OKLab → linear sRGB (Björn Ottosson's reference matrices). An out-of-gamut
// channel is clamped; the transfer curve fixes 0 and 1, so clamping the linear
// value matches a renderer clamping the encoded one.
function oklchToLinear(L: number, C: number, H: number): LinearRgba {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  }
}

const channel = (c: string): number => srgbToLinear(Number(c) / 255)

/** Parses an `oklch()` or `rgb()/rgba()` colour string. Throws on anything else. */
export function parseColor(value: string): LinearRgba {
  const ok = OKLCH.exec(value.trim())
  if (ok) {
    const color = oklchToLinear(Number(ok[1]) / 100, Number(ok[2]), Number(ok[3]))
    return { ...color, a: ok[4] === undefined ? 1 : Number(ok[4]) }
  }
  const rgb = RGBA.exec(value.trim())
  if (rgb) {
    return {
      r: channel(rgb[1]!),
      g: channel(rgb[2]!),
      b: channel(rgb[3]!),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    }
  }
  throw new Error(`unsupported colour: ${value}`)
}

/** `top` composited over an opaque `bottom` (source-over, in sRGB gamma space as browsers blend). */
export function composite(top: LinearRgba, bottom: LinearRgba): LinearRgba {
  if (bottom.a !== 1) throw new Error('composite needs an opaque bottom colour')
  const mix = (t: number, u: number): number =>
    srgbToLinear(linearToSrgb(t) * top.a + linearToSrgb(u) * (1 - top.a))
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 }
}

function luminance(c: LinearRgba): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/** WCAG contrast ratio between two opaque colours, 1–21. */
export function contrastRatio(fg: LinearRgba, bg: LinearRgba): number {
  if (fg.a !== 1 || bg.a !== 1)
    throw new Error('contrastRatio needs opaque colours; composite first')
  const [a, b] = [luminance(fg), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Pure white and pure black: the extremes of the card art a scrim can sit on. */
export const WHITE: LinearRgba = { r: 1, g: 1, b: 1, a: 1 }
export const BLACK: LinearRgba = { r: 0, g: 0, b: 0, a: 1 }

/** A linear channel back in 0–255 sRGB, for comparing against a known colour. */
export function toSrgb255(c: number): number {
  return linearToSrgb(c) * 255
}
