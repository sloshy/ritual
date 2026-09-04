import { Show, createMemo, type Component } from 'solid-js'
import { formatOklch, parseColor, type OklchColor } from './oklch-color'
import type { LengthUnit } from './theme-vars-metadata'
import { useT } from '../ui/i18n'

type ColorPickerProps = {
  value: string
  onInput: (next: string) => void
  /** Called only when a non-color value (e.g. raw text) is needed instead. */
  onRawInput?: (next: string) => void
  /** Whether to show the alpha slider. Defaults to true when the parsed value has alpha < 1. */
  showAlpha?: boolean
}

const L_STOPS = [0, 25, 50, 75, 100]
const H_STOPS = [0, 60, 120, 180, 240, 300, 360]

function lightnessGradient(c: number, h: number): string {
  const stops = L_STOPS.map((l) => `oklch(${l}% ${c} ${h})`).join(', ')
  return `linear-gradient(to right, ${stops})`
}

function chromaGradient(l: number, h: number): string {
  return `linear-gradient(to right, oklch(${l}% 0 ${h}), oklch(${l}% 0.4 ${h}))`
}

function hueGradient(l: number, c: number): string {
  const stops = H_STOPS.map((h) => `oklch(${l}% ${c} ${h})`).join(', ')
  return `linear-gradient(to right, ${stops})`
}

function alphaGradient(l: number, c: number, h: number): string {
  return `linear-gradient(to right, oklch(${l}% ${c} ${h} / 0), oklch(${l}% ${c} ${h} / 1))`
}

export const ColorPicker: Component<ColorPickerProps> = (props) => {
  const t = useT()
  const parsed = createMemo<OklchColor | null>(() => parseColor(props.value))

  const update = (patch: Partial<OklchColor>): void => {
    const current = parsed() ?? { l: 50, c: 0, h: 0, a: 1 }
    const next: OklchColor = { ...current, ...patch }
    props.onInput(formatOklch(next))
  }

  const showAlphaSlider = createMemo(() => {
    if (props.showAlpha !== undefined) return props.showAlpha
    return (parsed()?.a ?? 1) < 1
  })

  return (
    <div class="theme-color-picker">
      <Show
        when={parsed()}
        fallback={
          <div class="theme-color-picker-raw">
            <label>
              {t('site.theme.rawValue')}
              <input
                type="text"
                value={props.value}
                onInput={(e) => {
                  const v = e.target.value
                  if (props.onRawInput) props.onRawInput(v)
                  else props.onInput(v)
                }}
              />
            </label>
            <div class="theme-color-picker-hint">{t('site.theme.rawHint')}</div>
          </div>
        }
      >
        {(color) => (
          <>
            <div
              class="theme-color-picker-swatch swatch-checkerboard"
              aria-label={t('site.theme.colorPreview')}
            >
              <span
                class="theme-color-picker-swatch-fill"
                style={{ background: formatOklch(color()) }}
              />
            </div>
            <label class="theme-color-picker-slider">
              {/* i18n-exempt: OKLch axis abbreviation (lightness), not prose */}
              <span>L</span>
              <input
                type="range"
                min="0"
                max="100"
                step="0.5"
                value={color().l}
                onInput={(e) => update({ l: parseFloat(e.target.value) })}
                style={{ '--track': lightnessGradient(color().c, color().h) }}
              />
              <output>{color().l.toFixed(1)}%</output>
            </label>
            <label class="theme-color-picker-slider">
              {/* i18n-exempt: OKLch axis abbreviation (chroma), not prose */}
              <span>C</span>
              <input
                type="range"
                min="0"
                max="0.4"
                step="0.001"
                value={color().c}
                onInput={(e) => update({ c: parseFloat(e.target.value) })}
                style={{ '--track': chromaGradient(color().l, color().h) }}
              />
              <output>{color().c.toFixed(3)}</output>
            </label>
            <label class="theme-color-picker-slider">
              {/* i18n-exempt: OKLch axis abbreviation (hue), not prose */}
              <span>H</span>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={color().h}
                onInput={(e) => update({ h: parseFloat(e.target.value) })}
                style={{ '--track': hueGradient(color().l, color().c) }}
              />
              <output>{Math.round(color().h)}°</output>
            </label>
            <Show when={showAlphaSlider()}>
              <label class="theme-color-picker-slider">
                {/* i18n-exempt: OKLch axis abbreviation (alpha), not prose */}
                <span>A</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={color().a}
                  onInput={(e) => update({ a: parseFloat(e.target.value) })}
                  style={{ '--track': alphaGradient(color().l, color().c, color().h) }}
                />
                <output>{color().a.toFixed(2)}</output>
              </label>
            </Show>
            <label class="theme-color-picker-text">
              {/* i18n-exempt: format name */}
              <span>CSS</span>
              <input
                type="text"
                value={props.value}
                onInput={(e) => props.onInput(e.target.value)}
              />
            </label>
          </>
        )}
      </Show>
    </div>
  )
}

type LengthPickerProps = {
  value: string
  onInput: (next: string) => void
  /** CSS unit the value is authored in. Defaults to `px`. */
  unit?: LengthUnit
}

/** Input bounds for one numeric theme control. */
type NumericBounds = { max: number; step: number }

// Per-unit input bounds. Percentage lengths (e.g. --card-radius, a fraction of
// the card width) need a much smaller range than pixel lengths.
const LENGTH_BOUNDS: Record<LengthUnit, NumericBounds> = {
  px: { max: 64, step: 0.5 },
  '%': { max: 20, step: 0.25 },
}

/** The leading number of a CSS value (`12px`, `0.72`), or 0 when there is none. */
function leadingNumber(value: string): number {
  const match = value.match(/^(-?\d*\.?\d+)/)
  return match ? parseFloat(match[1]!) : 0
}

type NumericPickerProps = {
  value: string
  onInput: (next: string) => void
  bounds: NumericBounds
  /** Appended to the emitted value and shown beside the input. Absent ⇒ unitless. */
  suffix?: string
  class?: string
}

/**
 * The one numeric theme control: a bounded number input, optionally suffixed
 * with a CSS unit. Both the length and the opacity picker are thin wrappers, so
 * the value parsing and clamping live in exactly one place.
 */
const NumericPicker: Component<NumericPickerProps> = (props) => {
  const numeric = createMemo(() => leadingNumber(props.value))

  return (
    <div class={props.class ? `theme-length-picker ${props.class}` : 'theme-length-picker'}>
      <input
        type="number"
        min="0"
        max={props.bounds.max}
        step={props.bounds.step}
        value={numeric()}
        onInput={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) props.onInput(`${v}${props.suffix ?? ''}`)
        }}
      />
      <Show when={props.suffix}>
        {(suffix) => <span class="theme-length-picker-unit">{suffix()}</span>}
      </Show>
    </div>
  )
}

export const LengthPicker: Component<LengthPickerProps> = (props) => {
  const unit = (): LengthUnit => props.unit ?? 'px'
  return (
    <NumericPicker
      value={props.value}
      onInput={props.onInput}
      bounds={LENGTH_BOUNDS[unit()]}
      suffix={unit()}
    />
  )
}

type OpacityPickerProps = { value: string; onInput: (next: string) => void }

/** Bounds for every `opacity` theme variable: a unitless 0–1 fraction. */
const OPACITY_BOUNDS = { max: 1, step: 0.05 } as const satisfies NumericBounds

/**
 * The {@link NumericPicker} for a unitless number. `parseCustomTheme` stores every
 * variable as a plain non-empty string, so a bare `0.4` round-trips unchanged.
 */
export const OpacityPicker: Component<OpacityPickerProps> = (props) => (
  <NumericPicker
    value={props.value}
    onInput={props.onInput}
    bounds={OPACITY_BOUNDS}
    class="theme-opacity-picker"
  />
)
