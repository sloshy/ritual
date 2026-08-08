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

type LengthBounds = { max: number; step: number }

// Per-unit input bounds. Percentage lengths (e.g. --card-radius, a fraction of
// the card width) need a much smaller range than pixel lengths.
const LENGTH_BOUNDS: Record<LengthUnit, LengthBounds> = {
  px: { max: 64, step: 0.5 },
  '%': { max: 20, step: 0.25 },
}

export const LengthPicker: Component<LengthPickerProps> = (props) => {
  const unit = (): LengthUnit => props.unit ?? 'px'
  const bounds = () => LENGTH_BOUNDS[unit()]
  const numeric = createMemo(() => {
    const match = props.value.match(/^(-?\d*\.?\d+)/)
    return match ? parseFloat(match[1]!) : 0
  })

  return (
    <div class="theme-length-picker">
      <input
        type="number"
        min="0"
        max={bounds().max}
        step={bounds().step}
        value={numeric()}
        onInput={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) props.onInput(`${v}${unit()}`)
        }}
      />
      <span class="theme-length-picker-unit">{unit()}</span>
    </div>
  )
}
