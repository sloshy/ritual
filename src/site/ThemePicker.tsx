// Header dropdown for quickly switching between built-in themes.
//
// Renders below the "Theme" header button. Listing each built-in palette with
// a tiny preview swatch lets the user audition themes without entering the
// full editor. A "Customize theme…" footer opens the existing ThemeEditor
// for per-variable tweaks.
//
// Behavior when the user has active customizations (`customVars()` is
// non-empty): the store's `switchBaseTheme` discards overrides as part of the
// switch, so the picker surfaces an inline confirm rather than wiping the
// user's tweaks silently.

import {
  type Component,
  For,
  Show,
  batch,
  createEffect,
  createSelector,
  createSignal,
  onCleanup,
} from 'solid-js'
import { paletteToVars, themeNames, themes, type ThemeName } from '../themes'
import { useTheme } from './useTheme'

type ThemePickerProps = {
  open: boolean
  onClose: () => void
}

type ThemeSwatch = {
  name: ThemeName
  bgBody: string
  bgPanel: string
  accent: string
}

// Pre-compute the preview-relevant variables for each built-in palette so
// each menu item can render its swatch without re-resolving CSS at click
// time. These values are static — they come from `themes` + `paletteToVars`,
// which run pure transforms over the palette table.
const THEME_SWATCHES: ThemeSwatch[] = themeNames.map((name) => {
  const vars = paletteToVars(themes[name])
  return {
    name,
    bgBody: vars['--bg-body'],
    bgPanel: vars['--bg-panel'],
    accent: vars['--accent'],
  }
})

export const ThemePicker: Component<ThemePickerProps> = (props) => {
  const theme = useTheme()
  // When set, the user clicked a theme but has customizations they'd lose.
  // Holds the target theme until they confirm or cancel.
  const [pendingTheme, setPendingTheme] = createSignal<ThemeName | null>(null)

  // `createSelector` re-runs the equality check per subscriber but only
  // notifies the two items whose state actually flipped (old active, new
  // active), instead of forcing every menu row to re-evaluate.
  const isActive = createSelector(theme.theme)

  function pickTheme(name: ThemeName): void {
    if (name === theme.theme()) return
    if (Object.keys(theme.customVars()).length > 0) {
      setPendingTheme(name)
      return
    }
    theme.setTheme(name)
  }

  function confirmSwitch(): void {
    const target = pendingTheme()
    if (!target) return
    // Fold the pending-clear into the same flush as the theme swap so the
    // confirm panel never renders one frame with the new palette already
    // applied beneath it.
    batch(() => {
      theme.switchBaseTheme(target)
      setPendingTheme(null)
    })
  }

  function cancelSwitch(): void {
    setPendingTheme(null)
  }

  // The picker is a one-shot menu — both opening *and* closing the editor
  // from here dismiss the popover. (Leaving it open over the editor toolbar
  // would just be visual clutter.)
  function toggleEditor(): void {
    theme.setEditorOpen(!theme.editorOpen())
    props.onClose()
  }

  // Escape closes the confirm step first (if present), then the popover
  // itself — so the user is never one keypress away from losing context.
  createEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (pendingTheme()) {
        setPendingTheme(null)
      } else {
        props.onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

  return (
    <Show when={props.open}>
      <div class="theme-picker" role="dialog" aria-label="Choose theme">
        <Show
          when={pendingTheme()}
          fallback={
            <>
              <div class="theme-picker-list" role="listbox" aria-label="Built-in themes">
                <For each={THEME_SWATCHES}>
                  {(s) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive(s.name)}
                      class="theme-picker-item"
                      classList={{ 'theme-picker-item-active': isActive(s.name) }}
                      onClick={() => pickTheme(s.name)}
                    >
                      <span class="theme-picker-swatch" aria-hidden="true">
                        <span class="theme-picker-swatch-band" style={{ background: s.bgBody }} />
                        <span class="theme-picker-swatch-band" style={{ background: s.bgPanel }} />
                        <span class="theme-picker-swatch-band" style={{ background: s.accent }} />
                      </span>
                      <span class="theme-picker-name">{s.name}</span>
                    </button>
                  )}
                </For>
              </div>
              <div class="theme-picker-footer">
                <Show when={Object.keys(theme.customVars()).length > 0}>
                  <span class="theme-picker-customized-tag">Customized</span>
                </Show>
                <button type="button" class="theme-picker-customize-btn" onClick={toggleEditor}>
                  {theme.editorOpen() ? 'Close theme editor' : 'Customize theme…'}
                </button>
              </div>
            </>
          }
        >
          {(target) => (
            <div
              class="theme-picker-confirm"
              role="alertdialog"
              aria-label="Discard customizations?"
            >
              <p class="theme-picker-confirm-msg">
                Switching to <strong>{target()}</strong> will discard your theme customizations.
              </p>
              <div class="theme-picker-confirm-actions">
                <button type="button" class="theme-picker-btn" onClick={cancelSwitch}>
                  Cancel
                </button>
                <button
                  type="button"
                  class="theme-picker-btn theme-picker-btn-danger"
                  onClick={confirmSwitch}
                >
                  Discard & switch
                </button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </Show>
  )
}
