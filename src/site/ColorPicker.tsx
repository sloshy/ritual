import { Show, createMemo, type Component } from 'solid-js'
import { formatOklch, parseColor, type OklchColor } from './oklch-color'

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
              Raw value
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
            <div class="theme-color-picker-hint">
              Couldn't parse as a color — edit the raw CSS value.
            </div>
          </div>
        }
      >
        {(color) => (
          <>
            <div
              class="theme-color-picker-swatch swatch-checkerboard"
              aria-label="Current color preview"
            >
              <span
                class="theme-color-picker-swatch-fill"
                style={{ background: formatOklch(color()) }}
              />
            </div>
            <label class="theme-color-picker-slider">
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
}

// Currently only px lengths are themed (--card-radius). If more units arrive
// later, extend this picker with a unit dropdown.
export const LengthPicker: Component<LengthPickerProps> = (props) => {
  const numeric = createMemo(() => {
    const match = props.value.match(/^(-?\d*\.?\d+)/)
    return match ? parseFloat(match[1]!) : 0
  })

  return (
    <div class="theme-length-picker">
      <input
        type="number"
        min="0"
        max="64"
        step="0.5"
        value={numeric()}
        onInput={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) props.onInput(`${v}px`)
        }}
      />
      <span class="theme-length-picker-unit">px</span>
    </div>
  )
}
