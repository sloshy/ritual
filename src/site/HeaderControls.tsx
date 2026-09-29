// The site header's utility controls: the edit-mode toggle and the theme menu.
// (The price-store picker, shared with the admin header, lives in
// `list-view/PriceStoreSelect.tsx`; the language switcher in its own module.)
//
// They live inline in the header on desktop, but at phone widths the header has
// no room for them alongside the logo and quick switch — there they move into a
// collapsible second row (see `.site-header-utility` and the ⚙ toggle in
// app.tsx). Each is a standalone component so both layouts can render the same
// control without duplicating its markup.

import { type Component, createEffect, createSignal, onCleanup } from 'solid-js'
import { useT } from '../ui/i18n'
import { ThemePicker } from './ThemePicker'
import { useTheme } from './useTheme'

export type EditModeButtonProps = {
  editMode: boolean
  /** Whether a deck/collection/wanted list is open, which only affects the hint. */
  editableListInView: boolean
  onToggle: () => void
}

export const EditModeButton: Component<EditModeButtonProps> = (props) => {
  const t = useT()
  return (
    <button
      type="button"
      class="btn btn-secondary btn-edit"
      classList={{ 'btn-edit--active': props.editMode }}
      title={
        props.editMode
          ? t('site.header.editModeLeave')
          : props.editableListInView
            ? t('site.header.editModeEditList')
            : t('site.header.editModeEnter')
      }
      onClick={props.onToggle}
    >
      <span class="btn-edit-icon" aria-hidden="true">
        {props.editMode ? '✓' : '✏️'}
      </span>
      <span class="btn-edit-label">
        {props.editMode ? t('site.header.editModeDone') : t('site.header.editModeEdit')}
      </span>
    </button>
  )
}

/** The "Theme" button and the palette popover it anchors. */
export const ThemeHeaderControls: Component = () => {
  const t = useT()
  const theme = useTheme()
  const [pickerOpen, setPickerOpen] = createSignal(false)
  let wrapperRef: HTMLDivElement | undefined

  // Click-outside dismisses the popover. Use mousedown (not click) so a
  // press on the trigger's toggling its own state doesn't get followed by a
  // close fired from the bubbled click — Solid's click handler runs after
  // mousedown.
  createEffect(() => {
    if (!pickerOpen()) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef && !wrapperRef.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    onCleanup(() => document.removeEventListener('mousedown', onMouseDown))
  })

  return (
    <div ref={wrapperRef} class="theme-picker-wrapper">
      <button
        type="button"
        class="btn btn-secondary theme-customize-btn"
        classList={{ 'theme-customize-btn-active': pickerOpen() || theme.editorOpen() }}
        onClick={() => setPickerOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen()}
        title={theme.editorOpen() ? t('site.header.themeMenuEditing') : t('site.header.themeMenu')}
      >
        <span class="theme-customize-btn-icon" aria-hidden="true">
          🎨
        </span>
        <span class="theme-customize-btn-label">
          {theme.editorOpen() ? t('site.header.themeEditing') : t('site.header.theme')}
        </span>
      </button>
      <ThemePicker open={pickerOpen()} onClose={() => setPickerOpen(false)} />
    </div>
  )
}
