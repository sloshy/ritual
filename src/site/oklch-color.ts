// OKLch parsing, formatting, and sRGB conversion.
//
// The theme editor works exclusively in OKLch internally because:
//   1. Every theme variable that comes out of the palette generator is OKLch.
//   2. OKLch is perceptually uniform — sliders feel right.
//   3. Any sRGB / hex / named color can be losslessly normalized into OKLch.
//
// Conversion math follows the Oklab spec (Björn Ottosson, 2020) which is
// also implemented in CSS Color Level 4.

export type OklchColor = {
  /** Lightness, 0–100. */
  l: number
  /** Chroma, 0–~0.4 typically (OKLch has no upper bound; sRGB tops out around 0.37). */
  c: number
  /** Hue in degrees, 0–360. */
  h: number
  /** Alpha 0–1. Defaults to 1 when omitted. */
  a: number
}

const OKLCH_RE = /^oklch\(\s*([^\s]+)%?\s+([^\s]+)\s+([^\s/]+)(?:\s*\/\s*([^)]+))?\s*\)$/i
const RGB_RE =
  /^rgba?\(\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*,?\s*([0-9.]+)(?:\s*[,/]\s*([0-9.%]+))?\s*\)$/i
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function parseAlpha(raw: string | undefined): number {
  if (!raw) return 1
  const trimmed = raw.trim()
  if (trimmed.endsWith('%')) return Math.max(0, Math.min(1, parseFloat(trimmed) / 100))
  return Math.max(0, Math.min(1, parseFloat(trimmed)))
}

// Parse a CSS color string into OKLch components. Returns null when the
// input is not a recognized color (e.g. a length or arbitrary keyword).
export function parseColor(input: string): OklchColor | null {
  const value = input.trim()
  const oklch = value.match(OKLCH_RE)
  if (oklch) {
    const lightnessRaw = oklch[1]!
    const l = lightnessRaw.endsWith('%') ? parseFloat(lightnessRaw) : parseFloat(lightnessRaw) * 100
    return {
      l,
      c: parseFloat(oklch[2]!),
      h: parseFloat(oklch[3]!),
      a: parseAlpha(oklch[4]),
    }
  }
  const hex = value.match(HEX_RE)
  if (hex) {
    const rgb = hexToRgb(hex[1]!)
    return rgbToOklch(rgb.r, rgb.g, rgb.b, rgb.a)
  }
  const rgb = value.match(RGB_RE)
  if (rgb) {
    return rgbToOklch(
      parseFloat(rgb[1]!) / 255,
      parseFloat(rgb[2]!) / 255,
      parseFloat(rgb[3]!) / 255,
      parseAlpha(rgb[4]),
    )
  }
  return null
}

// Render an OKLch value as a CSS color string. Output is always
// `oklch(L% C H)` or `oklch(L% C H / A)` — alpha is omitted when 1.
export function formatOklch(color: OklchColor): string {
  const trim = (n: number, max: number): string => {
    const fixed = n.toFixed(max)
    return fixed.replace(/\.?0+$/, '')
  }
  const l = trim(color.l, 4)
  const c = trim(color.c, 4)
  const h = trim(((color.h % 360) + 360) % 360, 2)
  if (color.a >= 1) return `oklch(${l}% ${c} ${h})`
  return `oklch(${l}% ${c} ${h} / ${trim(color.a, 4)})`
}

// ---------------------------------------------------------------------------
// sRGB conversion
// ---------------------------------------------------------------------------

type RgbColor = { r: number; g: number; b: number; a: number }

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function hexToRgb(hex: string): RgbColor {
  const expand = (s: string): string =>
    s.length === 3 || s.length === 4
      ? s
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : s
  const expanded = expand(hex)
  const r = parseInt(expanded.slice(0, 2), 16) / 255
  const g = parseInt(expanded.slice(2, 4), 16) / 255
  const b = parseInt(expanded.slice(4, 6), 16) / 255
  const a = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1
  return { r, g, b, a }
}

// sRGB (0-1) → OKLch. The full pipeline is sRGB → linear → LMS → LMS' → Oklab → OKLch.
function rgbToOklch(r: number, g: number, b: number, alpha: number): OklchColor {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb

  const lp = Math.cbrt(l)
  const mp = Math.cbrt(m)
  const sp = Math.cbrt(s)

  const labL = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp
  const labA = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp
  const labB = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp

  const c = Math.sqrt(labA * labA + labB * labB)
  const hRad = Math.atan2(labB, labA)
  const h = ((hRad * 180) / Math.PI + 360) % 360

  return { l: labL * 100, c, h, a: alpha }
}
