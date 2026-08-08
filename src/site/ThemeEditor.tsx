// Top-of-viewport theme editor toolbar.
//
// Visible whenever the user has clicked "Customize Theme" in the site header.
// Layout:
//   - Top row: base theme picker, custom theme name, action buttons (download,
//     import, reset, exit).
//   - Tabs row: the variable groups.
//   - Variables row: every variable in the active group, each as a swatch
//     button. Clicking a swatch opens an OKLch (or length) picker popover.
//
// The toolbar lives at the document level (fixed-position) so it overlays
// pages without disturbing their layout. A small spacer in the SPA root
// pushes the page content down by the toolbar's height when active.

import {
  Show,
  For,
  createMemo,
  createSignal,
  createEffect,
  on,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js'
import {
  CUSTOM_THEME_NAME_PATTERN,
  themeNames,
  parseCustomTheme,
  type ThemeCssVars,
  type CustomTheme,
} from '../themes'
import { useTheme, readCssVar } from './useTheme'
import {
  themeVarGroups,
  themeVarsByGroup,
  type ThemeVarGroupId,
  type ThemeVarMeta,
} from './theme-vars-metadata'
import { ColorPicker, LengthPicker } from './ColorPicker'
import { useT, useTKey } from '../ui/i18n'

type ThemeOption = {
  value: string
  label: string
}

const BASE_THEME_OPTIONS: ThemeOption[] = themeNames.map((n) => ({ value: n, label: n }))

// Snapshot every editor-managed CSS variable from the active theme's
// stylesheet (i.e. ignoring any inline override the user has set). Used to
// build the self-contained JSON when the user downloads their theme.
function readBaseVars(): ThemeCssVars {
  const out: ThemeCssVars = {}
  for (const group of themeVarGroups) {
    for (const meta of themeVarsByGroup[group.id]) {
      out[meta.name] = readCssVar(meta.name)
    }
  }
  return out
}

export const ThemeEditor: Component = () => {
  const t = useT()
  const tKey = useTKey()
  const theme = useTheme()
  const [activeGroup, setActiveGroup] = createSignal<ThemeVarGroupId>('surfaces')
  const [openVar, setOpenVar] = createSignal<string | null>(null)
  const [importError, setImportError] = createSignal<string | null>(null)
  const [customName, setCustomName] = createSignal<string>('my-theme')

  // Overrides are stored in `customVars` and applied as inline styles on
  // `:root` — they layer on top of whichever base theme is active. Tweaks
  // just write through to the override dict; the base theme is unchanged.
  function applyVar(varName: string, value: string) {
    theme.setVar(varName, value)
  }

  function resetVar(varName: string) {
    theme.unsetVar(varName)
  }

  // Switching the base theme drops any in-progress overrides so the new
  // theme is seen cleanly. (Keeping overrides across a base swap would mean
  // a variable the user tweaked under one palette suddenly fights another.)
  // The editor switches silently — the picker popover wraps the same store
  // method with a confirm dialog for the no-context-yet entry point.

  function downloadJson() {
    // The exported JSON is self-contained: every editor-managed var with its
    // currently-resolved value, regardless of whether the user explicitly
    // overrode it.
    const vars: ThemeCssVars = { ...readBaseVars(), ...theme.customVars() }
    const trimmedName = customName().trim()
    const name = CUSTOM_THEME_NAME_PATTERN.test(trimmedName) ? trimmedName : 'my-theme'
    const customTheme: CustomTheme = { name, variables: vars }
    const blob = new Blob([JSON.stringify(customTheme, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  let fileInputRef: HTMLInputElement | undefined
  function pickImport() {
    fileInputRef?.click()
  }

  async function handleImport(file: File) {
    setImportError(null)
    let text: string
    try {
      text = await file.text()
    } catch {
      setImportError(t('site.theme.readError'))
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setImportError(
        t('site.theme.invalidJson', { error: e instanceof Error ? e.message : String(e) }),
      )
      return
    }
    const result = parseCustomTheme(parsed)
    if (typeof result === 'string') {
      setImportError(result)
      return
    }
    setCustomName(result.name)
    theme.replaceCustomVars(result.variables)
  }

  function exitEditor() {
    theme.setEditorOpen(false)
    setOpenVar(null)
  }

  // Drop every override so the active base theme shows through unmodified.
  function resetAll() {
    theme.clearCustomVars()
  }

  // Close any open picker when the active group changes. `defer: true` skips
  // the initial-run with the mount value — at mount `openVar` is already null,
  // so the synchronous fire would be a no-op write that nobody observes, but
  // it would also misleadingly imply this effect reacts to first mount.
  createEffect(
    on(
      activeGroup,
      () => {
        setOpenVar(null)
      },
      { defer: true },
    ),
  )

  // Click-outside / escape closes open picker.
  createEffect(() => {
    if (!openVar()) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.theme-editor-picker') && !target.closest('.theme-editor-swatch-btn')) {
        setOpenVar(null)
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenVar(null)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    onCleanup(() => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    })
  })

  const groupVars = createMemo(() => themeVarsByGroup[activeGroup()] ?? [])

  let editorRef: HTMLDivElement | undefined
  onMount(() => {
    if (!editorRef) return
    const el = editorRef
    const update = () => {
      document.documentElement.style.setProperty('--theme-editor-h', `${el.offsetHeight}px`)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    onCleanup(() => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--theme-editor-h')
    })
  })

  return (
    <div
      ref={editorRef}
      class="theme-editor"
      role="region"
      aria-label={t('site.theme.editorTitle')}
    >
      <div class="theme-editor-row theme-editor-row-top">
        <div class="theme-editor-left">
          <span class="theme-editor-title">{t('site.theme.editorTitle')}</span>
          <label class="theme-editor-base-select">
            <span class="theme-editor-base-label">{t('site.theme.baseLabel')}</span>
            <select value={theme.theme()} onChange={(e) => theme.switchBaseTheme(e.target.value)}>
              <For each={BASE_THEME_OPTIONS}>
                {(opt) => <option value={opt.value}>{opt.label}</option>}
              </For>
            </select>
          </label>
          <label class="theme-editor-name">
            <span>{t('site.theme.customNameLabel')}</span>
            <input
              type="text"
              value={customName()}
              onInput={(e) => setCustomName(e.target.value)}
              placeholder="my-theme"
            />
          </label>
        </div>
        <div class="theme-editor-right">
          <button type="button" class="theme-editor-btn" onClick={resetAll}>
            {t('site.theme.resetAll')}
          </button>
          <button type="button" class="theme-editor-btn" onClick={pickImport}>
            {t('site.theme.import')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const target = e.target
              const file = target.files?.[0]
              if (file) void handleImport(file)
              target.value = ''
            }}
          />
          <button
            type="button"
            class="theme-editor-btn theme-editor-btn-primary"
            onClick={downloadJson}
          >
            {t('site.theme.downloadJson')}
          </button>
          <button
            type="button"
            class="theme-editor-btn theme-editor-btn-exit"
            onClick={exitEditor}
            aria-label={t('site.theme.closeEditor')}
            title={t('site.theme.closeEditor')}
          >
            ✕
          </button>
        </div>
      </div>
      <Show when={importError()}>
        <div class="theme-editor-error">{importError()}</div>
      </Show>
      <div class="theme-editor-row theme-editor-tabs" role="tablist">
        <For each={themeVarGroups}>
          {(group) => (
            <button
              type="button"
              class="theme-editor-tab"
              classList={{ 'theme-editor-tab-active': activeGroup() === group.id }}
              onClick={() => setActiveGroup(group.id)}
              role="tab"
              aria-selected={activeGroup() === group.id}
              title={tKey(group.description)}
            >
              {tKey(group.label)}
            </button>
          )}
        </For>
      </div>
      <div class="theme-editor-row theme-editor-vars">
        <For each={groupVars()}>
          {(meta) => {
            // Per-swatch memo: tracks both `customVars` (so a tweak to this
            // var fires) AND `theme()` (so when the base theme changes, the
            // computed-style fallback re-evaluates against the new palette).
            const value = createMemo(() => {
              const overrides = theme.customVars()
              if (overrides[meta.name] !== undefined) return overrides[meta.name]!
              theme.theme()
              return readCssVar(meta.name)
            })
            const isOverridden = createMemo(() => meta.name in theme.customVars())
            return (
              <ThemeVarSwatch
                meta={meta}
                value={value()}
                isOverridden={isOverridden()}
                isOpen={openVar() === meta.name}
                onToggle={() => setOpenVar(openVar() === meta.name ? null : meta.name)}
                onChange={(next) => applyVar(meta.name, next)}
                onReset={() => resetVar(meta.name)}
              />
            )
          }}
        </For>
      </div>
    </div>
  )
}

type ThemeVarSwatchProps = {
  meta: ThemeVarMeta
  value: string
  isOverridden: boolean
  isOpen: boolean
  onToggle: () => void
  onChange: (next: string) => void
  onReset: () => void
}

// Approx max width of the popover, matching `.theme-editor-picker` max-width
// in styles.css. Used to keep the popover within the viewport when the swatch
// is near the right edge.
const PICKER_MAX_WIDTH = 380
const PICKER_VIEWPORT_MARGIN = 8

type PickerPos = { top: number; left: number }

const ThemeVarSwatch: Component<ThemeVarSwatchProps> = (props) => {
  const t = useT()
  const tKey = useTKey()
  let btnRef: HTMLButtonElement | undefined
  const [pos, setPos] = createSignal<PickerPos | null>(null)

  function updatePos() {
    if (!btnRef) return
    const rect = btnRef.getBoundingClientRect()
    const maxLeft = window.innerWidth - PICKER_MAX_WIDTH - PICKER_VIEWPORT_MARGIN
    const left = Math.max(PICKER_VIEWPORT_MARGIN, Math.min(rect.left, maxLeft))
    setPos({ top: rect.bottom + 4, left })
  }

  // While the popover is open, keep its viewport position in sync with the
  // anchor swatch — the toolbar itself can scroll internally (overflow-y),
  // and the window can be resized.
  createEffect(() => {
    if (!props.isOpen) {
      setPos(null)
      return
    }
    updatePos()
    const handler = () => updatePos()
    window.addEventListener('resize', handler)
    // Capture-phase so inner scroll containers (the toolbar itself) also fire.
    window.addEventListener('scroll', handler, true)
    onCleanup(() => {
      window.removeEventListener('resize', handler)
      window.removeEventListener('scroll', handler, true)
    })
  })

  return (
    <div class="theme-editor-var" classList={{ 'theme-editor-var-open': props.isOpen }}>
      <button
        ref={btnRef}
        type="button"
        class="theme-editor-swatch-btn"
        classList={{ 'theme-editor-swatch-overridden': props.isOverridden }}
        onClick={props.onToggle}
        title={tKey(props.meta.description)}
      >
        <span class="theme-editor-swatch swatch-checkerboard" aria-hidden="true">
          <Show
            when={props.meta.type === 'color'}
            fallback={<span class="theme-editor-swatch-length">{props.value}</span>}
          >
            <span class="theme-editor-swatch-fill" style={{ background: props.value }} />
          </Show>
        </span>
        <span class="theme-editor-swatch-label">{tKey(props.meta.label)}</span>
      </button>
      <Show when={props.isOpen && pos()}>
        {(p) => (
          <div
            class="theme-editor-picker"
            role="dialog"
            aria-label={t('site.theme.editVar', { name: tKey(props.meta.label) })}
            style={{ top: `${p().top}px`, left: `${p().left}px` }}
          >
            <div class="theme-editor-picker-header">
              <strong>{tKey(props.meta.label)}</strong>
              <code class="theme-editor-picker-varname">{props.meta.name}</code>
            </div>
            <p class="theme-editor-picker-desc">{tKey(props.meta.description)}</p>
            <Show
              when={props.meta.type === 'color'}
              fallback={
                <LengthPicker value={props.value} onInput={props.onChange} unit={props.meta.unit} />
              }
            >
              <ColorPicker value={props.value} onInput={props.onChange} />
            </Show>
            <Show when={props.isOverridden}>
              <button
                type="button"
                class="theme-editor-btn theme-editor-btn-link"
                onClick={props.onReset}
              >
                {t('site.theme.resetVar')}
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
